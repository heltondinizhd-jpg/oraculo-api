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
  // cache 2 minutos - conta ordens sempre que expirar
  if (cache.dados && Date.now() - cache.hora < 2*60*1000) return cache.dados;
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv';
    const r = await axios.get(url, { responseType: 'text', timeout: 25000 });
    const linhas = r.data.split(/\r?\n/).filter(l=>l.trim());
    const cab = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const upper = cab.map(h=>h.toUpperCase());
    const idxOS = upper.findIndex(h=>h==='OS');
    const idxSetor = upper.findIndex(h=>h.includes('SETOR'));
    const idxFam = upper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));
    const idxQtd = upper.findIndex(h=>h.includes('QTD') && h.includes('RETIRADA'));

    const dadosFull = [];
    const mapaOrdens = {};

    for (let i=1;i<linhas.length;i++){
      const linha = linhas[i];
      const cols = []; let cur='', inQ=false;
      for (let j=0;j<linha.length;j++){
        const c=linha[j];
        if (c==='"'){ if (linha[j+1]==='"'){ cur+='"'; j++; } else inQ=!inQ; }
        else if (c===',' &&!inQ){ cols.push(cur); cur=''; }
        else cur+=c;
      }
      cols.push(cur);
      const get = (idx)=> idx>=0? (cols[idx]||'').replace(/^"|"$/g,'').trim() : '';
      const os = get(idxOS); if(!os) continue;
      const setor = get(idxSetor)||'SEM SETOR';
      const fam = get(idxFam)||'SEM FAMILIA';
      const qtd = idxQtd>=0? parseFloat(get(idxQtd).replace(',','.'))||0 : 0;
      dadosFull.push({ _os: os, _setor: setor, _familia: fam, _qtd: qtd, _busca: linha.toLowerCase() });
      if (!mapaOrdens[os]) mapaOrdens[os] = { _setor: setor, _familia: fam };
    }

    const ordensUnicas = Object.keys(mapaOrdens).length;
    const porSetor = {}; Object.values(mapaOrdens).forEach(d=>{ porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
    const porFamilia = {}; Object.values(mapaOrdens).forEach(d=>{ porFamilia[d._familia]=(porFamilia[d._familia]||0)+1; });
    const pendentes = dadosFull.filter(d=>d._qtd===0).length;

    const result = { cab, totalLinhas: dadosFull.length, totalOrdens: ordensUnicas, osUnicas: ordensUnicas, porSetor, porFamilia, dadosFull, pendentes };
    cache = { dados: result, hora: Date.now() };
    console.log(`LIDO: ${result.totalOrdens} Ordens | ${result.totalLinhas} linhas`);
    return result;
  } catch (e) {
    console.log('ERRO:', e.message);
    return cache.dados || { cab:[], totalLinhas:0, totalOrdens:0, osUnicas:0, porSetor:{}, porFamilia:{}, dadosFull:[], pendentes:0, erro: e.message };
  }
}

lerPlanilha();

const menu = Markup.keyboard([['/dashboard','/resumo']]).resize();

bot.start((ctx)=>ctx.reply('Bot ZROF Online ✅\nDigite a OS ou use /resumo', menu));

bot.command('dashboard', (ctx)=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('Dashboard: '+url, menu);
});

bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  if (d.erro) return ctx.reply('Erro: '+d.erro);

  let txt = `📊 RESUMO ZROF\n\n`;
  txt += `Total de Ordens: ${d.totalOrdens}\n`;
  txt += `Total de Materiais: ${d.totalLinhas}\n`;
  txt += `Pendentes (Qtd=0): ${d.pendentes}\n\n`;

  txt += `📍 POR SETOR:\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  txt += `\n👨‍👩‍👧‍👦 POR FAMILIA:\n`;
  Object.entries(d.porFamilia).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  if (txt.length > 4000) {
    await ctx.reply(txt.substring(0,4000), menu);
    await ctx.reply(txt.substring(4000,8000), menu);
  } else {
    await ctx.reply(txt, menu);
  }
});

bot.command('limpar', async (ctx)=>{
  cache={dados:null,hora:0};
  await ctx.reply('♻️ Recarregando planilha...');
  const d = await lerPlanilha();
  return ctx.reply(`Pronto! Total de Ordens: ${d.totalOrdens}`, menu);
});

bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/')) return;
  if (['/dashboard','/resumo'].includes(texto)) return;
  try {
    const busca = texto.toLowerCase();
    const { dadosFull } = await lerPlanilha();
    if (!dadosFull.length) return ctx.reply('Planilha vazia');
    const achadas = dadosFull.filter(d=>d._busca.includes(busca));
    if (!achadas.length) return ctx.reply(`Nada para "${texto}"`, menu);
    if (achadas.length > 20) return ctx.reply(`${achadas.length} resultados para "${texto}" - seja mais especifico`, menu);
    for (const d of achadas.slice(0,10)){
      const pend = d._qtd===0? ' ⚠️PENDENTE' : '';
      await ctx.reply(`OS ${d._os}${pend}\nSetor: ${d._setor}\nFam: ${d._familia}\nQtd: ${d._qtd}`);
    }
    return ctx.reply(`Total: ${achadas.length} materiais`, menu);
  } catch(e){ return ctx.reply('Erro busca'); }
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a> <a href="/api/resumo">API</a>'));
app.get('/api/resumo', async (req,res)=>{ const d = await lerPlanilha(); res.json(d); });

app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));

const dashHtml = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:16px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style>
</head><body>
<h2 id="titulo">Carregando...</h2>
<div class="grid">
<div class="card"><h3>N de Ordens por Setor</h3><canvas id="c1"></canvas></div>
<div class="card"><h3>N de Ordens por Familia</h3><canvas id="c2"></canvas></div>
</div>
<div class="card" id="res"></div>
<script>
async function load(){
  const r = await fetch("/api/resumo");
  const d = await r.json();
  document.getElementById("titulo").innerText = "ZROF - " + d.totalOrdens + " Ordens / " + d.totalLinhas + " materiais";
  document.getElementById("res").innerText = "Pendentes: " + d.pendentes + " | Atualizado: " + new Date().toLocaleString();
  new Chart(document.getElementById("c1"),{type:"bar",data:{labels:Object.keys(d.porSetor),[STRIPPED]
  new Chart(document.getElementById("c2"),{type:"bar",data:{labels:Object.keys(d.porFamilia),[STRIPPED]
}
load();
</script>
</body></html>
`;
fs.writeFileSync(__dirname + '/dash.html', dashHtml);

app.use(bot.webhookCallback('/telegram'));

app.listen(PORT, async ()=>{
  console.log('Porta '+PORT);
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (domain) { try { await bot.telegram.setWebhook('https://'+domain+'/telegram'); console.log('webhook ok'); } catch(e){ console.log(e.message); } }
  else { bot.launch(); }
});