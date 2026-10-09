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

    let idxOS = cabUpper.indexOf('OS'); if (idxOS===-1) idxOS=cabUpper.findIndex(h=>h.includes('ORDEM'));
    let idxSetor = cabUpper.findIndex(h=>h.includes('SETOR'));
    let idxFam = cabUpper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));
    let idxGrupo = cabUpper.findIndex(h=>h==='GRUPO' || h.includes('GRUPO'));

    const mapaOrdens = {};
    const mapaMina = {}; // OS que tem grupo M
    const mapaUsina = {}; // OS que tem grupo U
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
      const os = get(idxOS).replace(/\D/g,''); if(!os || os.length < 3) continue;
      const setor = (get(idxSetor)||'SEM SETOR').toUpperCase().trim();
      const fam = (get(idxFam)||'SEM FAMILIA').toUpperCase().trim();
      const grupo = (get(idxGrupo)||'').toUpperCase().trim();

      let macro = 'OUTROS';
      if (grupo.startsWith('M')) macro = 'MINA';
      else if (grupo.startsWith('U')) macro = 'USINA';

      const rowCompleta = {}; cabOriginal.forEach((n,idx)=>{ rowCompleta[n]=get(idx); });
      rowCompleta['_MACRO']=macro;

      dadosFull.push({ _os: os, _setor: setor, _familia: fam, _grupo: grupo, _macro: macro, _row: rowCompleta, _busca: linha.toLowerCase() });

      if (!mapaOrdens[os]) mapaOrdens[os] = { setor, familia: fam, macro };
      if (macro==='MINA') mapaMina[os]= { setor, familia: fam };
      if (macro==='USINA') mapaUsina[os]= { setor, familia: fam };
    }

    const totalOrdens = Object.keys(mapaOrdens).length;
    const totalMina = Object.keys(mapaMina).length;
    const totalUsina = Object.keys(mapaUsina).length;

    const porSetor = {}; Object.values(mapaOrdens).forEach(d=>{ porSetor[d.setor]=(porSetor[d.setor]||0)+1; });
    const porFamilia = {}; Object.values(mapaOrdens).forEach(d=>{ porFamilia[d.familia]=(porFamilia[d.familia]||0)+1; });

    // SEPARADOS POR MACRO
    const porSetorMina = {}; Object.values(mapaMina).forEach(d=>{ porSetorMina[d.setor]=(porSetorMina[d.setor]||0)+1; });
    const porSetorUsina = {}; Object.values(mapaUsina).forEach(d=>{ porSetorUsina[d.setor]=(porSetorUsina[d.setor]||0)+1; });
    const porFamiliaMina = {}; Object.values(mapaMina).forEach(d=>{ porFamiliaMina[d.familia]=(porFamiliaMina[d.familia]||0)+1; });
    const porFamiliaUsina = {}; Object.values(mapaUsina).forEach(d=>{ porFamiliaUsina[d.familia]=(porFamiliaUsina[d.familia]||0)+1; });
    const porMacro = { MINA: totalMina, USINA: totalUsina };

    const result = { totalOrdens, totalMina, totalUsina, porMacro, porSetor, porFamilia, porSetorMina, porSetorUsina, porFamiliaMina, porFamiliaUsina, dadosFull };
    cache = { dados: result, hora: Date.now() };
    console.log(`LIDO: ${totalOrdens} Ordens | Mina:${totalMina} Usina:${totalUsina}`);
    return result;
  } catch (e) {
    console.log('ERRO:', e.message);
    return cache.dados || { totalOrdens:0, totalMina:0, totalUsina:0, porMacro:{}, porSetor:{}, porFamilia:{}, porSetorMina:{}, porSetorUsina:{}, porFamiliaMina:{}, porFamiliaUsina:{}, dadosFull:[], erro:e.message };
  }
}

lerPlanilha();
const menu = Markup.keyboard([['🔍 Buscar OS','📊 Resumo'],['📈 Dashboard','♻️ Limpar']]).resize();
bot.start((ctx)=>ctx.reply('🤖 Bot ZROF - Macro Mina/Usina Online!', menu));
bot.hears('📊 Resumo', async (ctx)=>{ ctx.message.text='/resumo'; return bot.handleUpdate({message: ctx.message}); });
bot.hears('📈 Dashboard', async (ctx)=>{ const domain=process.env.RENDER_EXTERNAL_HOSTNAME; const url=domain? 'https://'+domain+'/dashboard':'/dashboard'; return ctx.reply('📈 Dashboard: '+url, menu); });
bot.hears('♻️ Limpar', async (ctx)=>{ cache={dados:null,hora:0}; await ctx.reply('♻️ Recarregando...', menu); const d=await lerPlanilha(); return ctx.reply(`Pronto! Mina:${d.totalMina} Usina:${d.totalUsina} Total:${d.totalOrdens}`, menu); });
bot.hears('🔍 Buscar OS', (ctx)=>ctx.reply('Digite a OS:', menu));

bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  let txt = `📊 RESUMO ZROF - MACRO GRUPOS\n\n`;
  txt += `Total de Ordens: ${d.totalOrdens}\n`;
  txt += `⛏️ Macro MINA (M): ${d.totalMina}\n`;
  txt += `🏭 Macro USINA (U): ${d.totalUsina}\n\n`;

  txt += `📍 SETOR - GERAL:\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  txt += `\n⛏️ SETOR - MINA:\n`;
  Object.entries(d.porSetorMina).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  txt += `\n🏭 SETOR - USINA:\n`;
  Object.entries(d.porSetorUsina).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  txt += `\n👨‍👩‍👧‍👦 FAMILIA - GERAL:\n`;
  Object.entries(d.porFamilia).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  txt += `\n⛏️ FAMILIA - MINA:\n`;
  Object.entries(d.porFamiliaMina).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  txt += `\n🏭 FAMILIA - USINA:\n`;
  Object.entries(d.porFamiliaUsina).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  // Divide em mensagens de 4000
  for (let i=0;i<txt.length;i+=4000){ await ctx.reply(txt.substring(i,i+4000), menu); }
});

bot.command('dashboard', (ctx)=>{ const domain=process.env.RENDER_EXTERNAL_HOSTNAME; const url=domain? 'https://'+domain+'/dashboard':'/dashboard'; return ctx.reply('📈 Dashboard: '+url, menu); });
bot.command('limpar', async (ctx)=>{ cache={dados:null,hora:0}; const d=await lerPlanilha(); return ctx.reply(`Pronto! Total:${d.totalOrdens} Mina:${d.totalMina} Usina:${d.totalUsina}`, menu); });

bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/') || ['🔍 Buscar OS','📊 Resumo','📈 Dashboard','♻️ Limpar'].includes(texto)) return;
  try {
    const busca = texto.toLowerCase(); const { dadosFull } = await lerPlanilha();
    const achadas = dadosFull.filter(d=>d._busca.includes(busca));
    if (!achadas.length) return ctx.reply(`❌ Nada para "${texto}"`, menu);
    for (const item of achadas.slice(0,5)){
      let detalhe = `📋 OS: ${item._os} | Macro: ${item._macro}\n--------------------------\n`;
      for (const [col, val] of Object.entries(item._row)){ if (val && val.trim()) detalhe += `${col}: ${val}\n`; }
      await ctx.reply(detalhe.substring(0,4000), menu);
    }
    if (achadas.length>5) await ctx.reply(`Total: ${achadas.length} materiais (mostrando 5)`, menu);
  } catch(e){}
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{ res.json(await lerPlanilha()); });
app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));

const dashHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.grid{grid-template-columns:1fr}}h3{margin:0 0 8px}</style>
</head><body>
<h2 id="titulo">Carregando...</h2>
<div class="grid">
<div class="card"><h3>Macro Grupo (Mina x Usina)</h3><canvas id="cMacro"></canvas></div>
<div class="card"><h3>Ordens por Setor - GERAL</h3><canvas id="cSetor"></canvas></div>
</div>
<div class="grid">
<div class="card"><h3>⛏️ Setor - MINA (M)</h3><canvas id="cSetorMina"></canvas></div>
<div class="card"><h3>🏭 Setor - USINA (U)</h3><canvas id="cSetorUsina"></canvas></div>
</div>
<div class="grid">
<div class="card"><h3>⛏️ Familia - MINA</h3><canvas id="cFamMina"></canvas></div>
<div class="card"><h3>🏭 Familia - USINA</h3><canvas id="cFamUsina"></canvas></div>
</div>
<script>
async function load(){
  const d = await fetch('/api/resumo').then(r=>r.json());
  document.getElementById('titulo').innerText = 'ZROF - Total:'+d.totalOrdens+' | Mina:'+d.totalMina+' | Usina:'+d.totalUsina;

  const sortEntries = (obj)=>Object.entries(obj).sort((a,b)=>b[1]-a[1]);

  new Chart(document.getElementById('cMacro'), {type:'doughnut', data:{labels:Object.keys(d.porMacro), datasets:[{data:Object.values(d.porMacro), backgroundColor:['#38bdf8','#fbbf24']}]}, options:{responsive:true, plugins:{legend:{labels:{color:'#fff'}}}}});

  const makeBar = (id, obj, color)=>{
    const e = sortEntries(obj);
    new Chart(document.getElementById(id), {type:'bar', data:{labels:e.map(x=>x[0]), datasets:[{label:'Ordens', data:e.map(x=>x[1]), backgroundColor:color}]}, options:{responsive:true, plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#fff', maxRotation:45}}, y:{ticks:{color:'#fff'}}}}});
  };
  makeBar('cSetor', d.porSetor, '#a78bfa');
  makeBar('cSetorMina', d.porSetorMina, '#38bdf8');
  makeBar('cSetorUsina', d.porSetorUsina, '#fbbf24');
  makeBar('cFamMina', d.porFamiliaMina, '#34d399');
  makeBar('cFamUsina', d.porFamiliaUsina, '#fb7185');
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