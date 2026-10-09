const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) { console.log('FALTA BOT_TOKEN'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const app = express();

let cache = { dados: null, hora: 0 };

async function parseCSV(text) {
  const rows = []; let cur = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const n = text[i+1];
    if (c === '"') { if (inQ && n === '"') { cur += '"'; i++; } else inQ =!inQ; }
    else if (c === ',' &&!inQ) { row.push(cur); cur = ''; }
    else if ((c === '\n' || c === '\r') &&!inQ) {
      if (cur || row.length) { row.push(cur); rows.push(row); row=[]; cur=''; }
      if (c === '\r' && n === '\n') i++;
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.join('').trim()!== '');
}

async function lerPlanilha() {
  if (cache.dados && Date.now() - cache.hora < 300000) return cache.dados;
  let allRows = []; let cab = null; let offset = 0;
  while (true) {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&tq=' + encodeURIComponent('SELECT * LIMIT 1000 OFFSET ' + offset);
    try {
      const r = await axios.get(url, { responseType: 'text', timeout: 15000 });
      const rows = await parseCSV(r.data);
      if (!rows.length) break;
      if (!cab) { cab = rows[0].map(h => h.replace(/"/g, '').trim()); allRows.push(...rows.slice(1)); }
      else allRows.push(...rows);
      if (rows.length < 1000) break;
      offset += 1000; if (offset > 15000) break;
    } catch (e) { break; }
  }
  const upper = cab.map(h => h.toUpperCase());
  const idxOS = upper.findIndex(h => h === 'OS');
  const idxSetor = upper.findIndex(h => h.includes('SETOR'));
  const idxFam = upper.findIndex(h => h.includes('FAMILIA') || h.includes('FAMÍLIA'));
  const mapa = {};
  allRows.forEach(cols => {
    const get = (i) => (i>=0? (cols[i]||'').replace(/^"|"$/g,'').trim() : '');
    const os = get(idxOS); if (!os) return;
    if (!mapa[os]) mapa[os] = { _setor: get(idxSetor)||'SEM SETOR', _familia: get(idxFam)||'SEM FAMILIA' };
  });
  const unicas = Object.values(mapa);
  const porSetor = {}; unicas.forEach(d => { porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
  const porFamilia = {}; unicas.forEach(d => { porFamilia[d._familia]=(porFamilia[d._familia]||0)+1; });
  const res = { totalLinhas: allRows.length, osUnicas: unicas.length, porSetor, porFamilia };
  cache = { dados: res, hora: Date.now() };
  console.log('LIDO '+res.totalLinhas+' linhas');
  return res;
}

const menu = Markup.keyboard([['/dashboard']]).resize();
bot.start((ctx) => ctx.reply('Bot ZROF Online', menu));
bot.command('dashboard', (ctx) => {
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('Dashboard: '+url, menu);
});
bot.command('limpar', (ctx) => { cache={dados:null,hora:0}; return ctx.reply('Cache limpo'); });

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{
  try { const d = await lerPlanilha(); res.json(d); } catch(e){ res.json({osUnicas:0,totalLinhas:0,porSetor:{},porFamilia:{}}); }
});

app.get('/dashboard', (req,res)=>{
  res.sendFile(__dirname + '/dash.html');
});

const dashHtml = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:16px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style>
</head><body>
<h2 id="titulo">Carregando ZROF...</h2>
<div class="grid">
<div class="card"><h3>N de Ordens por Setor</h3><canvas id="c1"></canvas></div>
<div class="card"><h3>N de Ordens por Familia</h3><canvas id="c2"></canvas></div>
</div>
<div class="card" id="res"></div>
<script>
fetch("/api/resumo").then(r=>r.json()).then(d=>{
  document.getElementById("titulo").innerText = "ZROF - " + d.osUnicas + " OS / " + d.totalLinhas + " linhas";
  document.getElementById("res").innerText = "Dados carregados";
  new Chart(document.getElementById("c1"),{type:"bar",data:{labels:Object.keys(d.porSetor),datasets:[{label:"Ordens",data:Object.values(d.porSetor),backgroundColor:"#38bdf8"}]}});
  new Chart(document.getElementById("c2"),{type:"bar",data:{labels:Object.keys(d.porFamilia),datasets:[{label:"Ordens",data:Object.values(d.porFamilia),backgroundColor:"#a78bfa"}]}});
});
</script>
</body></html>
`;
fs.writeFileSync(__dirname + '/dash.html', dashHtml);

app.use(bot.webhookCallback('/telegram'));

app.listen(PORT, async () => {
  console.log('Porta '+PORT);
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (domain) {
    try { await bot.telegram.setWebhook('https://'+domain+'/telegram'); console.log('webhook ok'); } catch(e){ console.log(e.message); }
  } else { bot.launch(); console.log('polling'); }
});