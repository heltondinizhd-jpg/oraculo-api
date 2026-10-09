const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) process.exit(1);

const bot = new Telegraf(BOT_TOKEN);
const app = express();
let cache = { dados: null, hora: 0 };

async function lerPlanilha() {
  if (cache.dados && Date.now() - cache.hora < 2*60*1000) return cache.dados;
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv';
    const r = await axios.get(url, { responseType: 'text', timeout: 25000 });
    const linhas = r.data.split(/\r?\n/).filter(l=>l.trim());
    const cabOriginal = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const cabUpper = cabOriginal.map(h=>h.toUpperCase().trim());

    let idxOS = cabUpper.indexOf('OS');
    if (idxOS === -1) idxOS = cabUpper.findIndex(h=>h.includes('ORDEM'));
    let idxSetor = cabUpper.findIndex(h=>h.includes('SETOR'));
    let idxFam = cabUpper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));

    const mapaOrdens = {};
    const dadosFull = [];

    for (let i=1;i<linhas.length;i++){
      const linha = linhas[i]; if (!linha.trim()) continue;
      const cols = []; let cur='', inQ=false;
      for (let j=0;j<linha.length;j++){
        const c=linha[j];
        if (c==='"'){ if (linha[j+1]==='"'){ cur+='"'; j++; } else inQ=!inQ; }
        else if (c===',' &&!inQ){ cols.push(cur); cur=''; }
        else cur+=c;
      }
      cols.push(cur);
      const get = (idx)=> idx>=0? (cols[idx]||'').replace(/^"|"$/g,'').trim() : '';
      const osRaw = get(idxOS);
      const os = osRaw.replace(/\D/g,''); if(!os || os.length < 3) continue;

      // Guarda linha completa para detalhe
      const rowCompleta = {};
      cabOriginal.forEach((nome, idx)=>{
        rowCompleta[nome] = get(idx);
      });

      const setor = (get(idxSetor)||'SEM SETOR').toUpperCase().trim();
      const fam = (get(idxFam)||'SEM FAMILIA').toUpperCase().trim();

      dadosFull.push({ _os: os, _setor: setor, _familia: fam, _row: rowCompleta, _busca: linha.toLowerCase() });
      if (!mapaOrdens[os]) mapaOrdens[os] = { setor, familia: fam };
    }

    const totalOrdens = Object.keys(mapaOrdens).length;
    const porSetor = {}; Object.values(mapaOrdens).forEach(d=>{ porSetor[d.setor]=(porSetor[d.setor]||0)+1; });
    const porFamilia = {}; Object.values(mapaOrdens).forEach(d=>{ porFamilia[d.familia]=(porFamilia[d.familia]||0)+1; });
    const result = { totalOrdens, porSetor, porFamilia, dadosFull, cab: cabOriginal };
    cache = { dados: result, hora: Date.now() };
    console.log(`LIDO: ${totalOrdens} Ordens`);
    return result;
  } catch (e) {
    console.log('ERRO:', e.message);
    return cache.dados || { totalOrdens:0, porSetor:{}, porFamilia:{}, dadosFull:[], cab:[], erro: e.message };
  }
}

lerPlanilha();

// BOTÕES ATIVOS
const menu = Markup.keyboard([
  ['🔍 Buscar OS', '📊 Resumo'],
  ['📈 Dashboard', '♻️ Limpar']
]).resize();

bot.start((ctx)=>ctx.reply('🤖 Bot ZROF Online!\n\nClique em uma opção abaixo ou digite a OS:', menu));

bot.hears('📊 Resumo', async (ctx)=>{ ctx.message.text='/resumo'; return bot.handleUpdate({message: ctx.message}); });
bot.hears('📈 Dashboard', async (ctx)=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('📈 Dashboard: '+url, menu);
});
bot.hears('♻️ Limpar', async (ctx)=>{ cache={dados:null,hora:0}; await ctx.reply('♻️ Recarregando...', menu); const d=await lerPlanilha(); return ctx.reply(`Pronto! Total: ${d.totalOrdens} Ordens`, menu); });
bot.hears('🔍 Buscar OS', (ctx)=>ctx.reply('Digite o número da OS:', menu));

bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  let txt = `📊 RESUMO ZROF\n\nTotal de Ordens: ${d.totalOrdens}\n\n`;
  txt += `📍 POR SETOR:\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });
  txt += `\n👨‍👩‍👧‍👦 POR FAMILIA:\n`;
  Object.entries(d.porFamilia).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });
  await ctx.reply(txt.substring(0,4000), menu);
  if (txt.length > 4000) await ctx.reply(txt.substring(4000,8000), menu);
});

bot.command('dashboard', (ctx)=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('📈 Dashboard: '+url, menu);
});

bot.command('limpar', async (ctx)=>{ cache={dados:null,hora:0}; const d=await lerPlanilha(); return ctx.reply(`Pronto! Total: ${d.totalOrdens}`, menu); });

// BUSCA INDIVIDUAL COMPLETA
bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/') || ['🔍 Buscar OS','📊 Resumo','📈 Dashboard','♻️ Limpar'].includes(texto)) return;
  try {
    const busca = texto.toLowerCase();
    const { dadosFull } = await lerPlanilha();
    const achadas = dadosFull.filter(d=>d._busca.includes(busca));
    if (!achadas.length) return ctx.reply(`❌ Nada encontrado para "${texto}"`, menu);

    if (achadas.length > 10) {
      await ctx.reply(`🔎 Encontrei ${achadas.length} materiais para "${texto}". Mostrando os 10 primeiros:`, menu);
    }

    for (const item of achadas.slice(0,10)){
      let detalhe = `📋 OS: ${item._os}\n`;
      detalhe += `--------------------------\n`;
      // Mostra TODAS as colunas da planilha
      for (const [coluna, valor] of Object.entries(item._row)){
        if (valor && valor.trim()) detalhe += `${coluna}: ${valor}\n`;
      }
      await ctx.reply(detalhe.substring(0,4000), menu);
    }
    if (achadas.length > 1) await ctx.reply(`Total: ${achadas.length} materiais encontrados`, menu);
  } catch(e){ console.log(e); }
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{ res.json(await lerPlanilha()); });
app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));

const dashHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:16px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}h2{margin:0 0 16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.grid{grid-template-columns:1fr}}</style>
</head><body>
<h2 id="titulo">Carregando ZROF...</h2>
<div class="grid">
<div class="card"><h3>Ordens por Setor (decrescente)</h3><canvas id="cSetor"></canvas></div>
<div class="card"><h3>Ordens por Familia (decrescente)</h3><canvas id="cFam"></canvas></div>
</div>
<script>
async function load(){
  const d = await fetch('/api/resumo').then(r=>r.json());
  document.getElementById('titulo').innerText = 'ZROF - ' + d.totalOrdens + ' Ordens';
  const setorEntries = Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]);
  const famEntries = Object.entries(d.porFamilia).sort((a,b)=>b[1]-a[1]);
  new Chart(document.getElementById('cSetor'), {type:'bar', data:{labels:setorEntries.map(e=>e[0]), datasets:[{label:'Ordens', data:setorEntries.map(e=>e[1]), backgroundColor:'#38bdf8'}]}, options:{responsive:true, plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#fff', maxRotation:45}}, y:{ticks:{color:'#fff'}}}}});
  new Chart(document.getElementById('cFam'), {type:'bar', data:{labels:famEntries.map(e=>e[0]), datasets:[{label:'Ordens', data:famEntries.map(e=>e[1]), backgroundColor:'#fbbf24'}]}, options:{responsive:true, plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#fff', maxRotation:45}}, y:{ticks:{color:'#fff'}}}}});
}
load();
</script>
</body></html>
`;
fs.writeFileSync(__dirname + '/dash.html', dashHtml);
app.use(bot.webhookCallback('/telegram'));
app.listen(PORT, async ()=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (domain) { try { await bot.telegram.setWebhook('https://'+domain+'/telegram'); } catch(e){} }
  else { bot.launch(); }
});