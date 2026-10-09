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

let cache = { dados: null, hora: 0, carregando: false };

// CSV DIRETO - MUITO MAIS RAPIDO QUE GVIZ
async function lerPlanilha() {
  if (cache.dados && Date.now() - cache.hora < 5*60*1000) return cache.dados;
  if (cache.carregando) {
    // se já está carregando, espera o cache ficar pronto
    await new Promise(r=>setTimeout(r,2000));
    if (cache.dados) return cache.dados;
  }
  cache.carregando = true;
  try {
    // TENTA EXPORT DIRETO (1 requisicao só)
    let csvText = '';
    try {
      const urlExport = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv';
      const r = await axios.get(urlExport, { responseType: 'text', timeout: 20000 });
      csvText = r.data;
    } catch (e) {
      // fallback gviz se export estiver bloqueado
      const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&tq=' + encodeURIComponent('SELECT *');
      const r = await axios.get(url, { responseType: 'text', timeout: 20000 });
      csvText = r.data;
    }

    const linhas = csvText.split(/\r?\n/).filter(l=>l.trim());
    const cab = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const upper = cab.map(h=>h.toUpperCase());
    const idxOS = upper.findIndex(h=>h==='OS');
    const idxSetor = upper.findIndex(h=>h.includes('SETOR'));
    const idxFam = upper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));

    const dadosFull = [];
    const mapa = {};

    for (let i=1;i<linhas.length;i++){
      const linha = linhas[i];
      // parse simples respeitando aspas
      const cols = []; let cur='', inQ=false;
      for (let j=0;j<linha.length;j++){
        const c = linha[j];
        if (c==='"'){ inQ=!inQ; }
        else if (c===',' &&!inQ){ cols.push(cur); cur=''; }
        else cur+=c;
      }
      cols.push(cur);
      const get = (idx)=> idx>=0? (cols[idx]||'').replace(/^"|"$/g,'').trim() : '';
      const os = get(idxOS); if(!os) continue;
      const setor = get(idxSetor)||'SEM SETOR';
      const fam = get(idxFam)||'SEM FAMILIA';
      dadosFull.push({ _os: os, _setor: setor, _familia: fam, _busca: linha.toLowerCase(), _linha: cab.reduce((o,h,k)=>{o[h]=get(k); return o;},{}) });
      if (!mapa[os]) mapa[os] = { _setor: setor, _familia: fam };
    }

    const unicas = Object.values(mapa);
    const porSetor = {}; unicas.forEach(d=>{ porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
    const porFamilia = {}; unicas.forEach(d=>{ porFamilia[d._familia]=(porFamilia[d._familia]||0)+1; });

    const result = { cab, totalLinhas: dadosFull.length, osUnicas: unicas.length, porSetor, porFamilia, dadosFull };
    cache = { dados: result, hora: Date.now(), carregando: false };
    console.log('LIDO TURBO '+result.totalLinhas+' linhas em '+(Date.now()-cache.hora)+'ms');
    return result;
  } catch (e) {
    console.log('Erro ler', e.message);
    cache.carregando = false;
    return cache.dados || { cab:[], totalLinhas:0, osUnicas:0, porSetor:{}, porFamilia:{}, dadosFull:[] };
  }
}

// PRE-AQUECE O CACHE QUANDO SOBE
lerPlanilha().then(()=>console.log('Cache aquecido'));

const menu = Markup.keyboard([['/dashboard','/resumo']]).resize();
bot.start((ctx)=>ctx.reply('Bot ZROF Online - digite a OS', menu));
bot.command('dashboard', (ctx)=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('Dashboard: '+url, menu);
});
bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  return ctx.reply(`OS: ${d.osUnicas} | Linhas: ${d.totalLinhas}`, menu);
});
bot.command('limpar', (ctx)=>{ cache={dados:null,hora:0,carregando:false}; lerPlanilha(); return ctx.reply('Cache limpo, recarregando...'); });

bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/')) return;
  if (texto.length < 2) return;
  try {
    const busca = texto.toLowerCase();
    const { dadosFull } = await lerPlanilha();
    const achadas = dadosFull.filter(d=>d._busca.includes(busca));
    if (!achadas.length) return ctx.reply(`Nada para "${texto}"`, menu);
    if (achadas.length > 15) return ctx.reply(`${achadas.length} linhas para "${texto}" - seja mais especifico ou use /dashboard`, menu);
    for (const d of achadas.slice(0,10)){
      await ctx.reply(`OS ${d._os} | SETOR ${d._setor} | FAM ${d._familia}`);
    }
    return ctx.reply(`Total: ${achadas.length}`, menu);
  } catch(e){ return ctx.reply('Erro busca'); }
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{
  const d = await lerPlanilha();
  res.json(d);
});
app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));

const dashHtml = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:16px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.grid{grid-template-columns:1fr}}#loading{color:#38bdf8}</style>
</head><body>
<h2 id="titulo">ZROF - <span id="loading">Carregando...</span></h2>
<div class="grid">
<div class="card"><h3>N de Ordens por Setor</h3><canvas id="c1"></canvas></div>
<div class="card"><h3>N de Ordens por Familia</h3><canvas id="c2"></canvas></div>
</div>
<div class="card" id="res">Aguarde...</div>
<script>
async function load(){
  try{
    const r = await fetch("/api/resumo");
    const d = await r.json();
    document.getElementById("titulo").innerText = "ZROF - " + d.osUnicas + " OS / " + d.totalLinhas + " linhas";
    document.getElementById("res").innerText = "Atualizado - " + new Date().toLocaleString();
    document.getElementById("loading").innerText = "";
    new Chart(document.getElementById("c1"),{type:"bar",data:{labels:Object.keys(d.porSetor),[STRIPPED]
    new Chart(document.getElementById("c2"),{type:"bar",data:{labels:Object.keys(d.porFamilia),[STRIPPED]
  }catch(e){
    document.getElementById("titulo").innerText = "Erro ao carregar, recarregue a pagina";
  }
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