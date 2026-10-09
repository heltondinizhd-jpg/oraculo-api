const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) { console.log('FALTA BOT_TOKEN'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const app = express();

let cachePlanilha = { dados: null, hora: 0 };

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
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
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
  const idxQtd = upper.findIndex(h => h.includes('QTD') && h.includes('RETIRADA'));

  const mapaOS = {};
  allRows.forEach(cols => {
    const get = (idx) => (idx>=0? (cols[idx]||'').replace(/^"|"$/g,'').trim() : '');
    const os = get(idxOS); if (!os) return;
    if (!mapaOS[os]) mapaOS[os] = { _os: os, _setor: get(idxSetor)||'SEM SETOR', _familia: get(idxFam)||'SEM FAMILIA' };
  });
  const unicas = Object.values(mapaOS);
  const porSetor = {}; unicas.forEach(d => { porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
  const porFamilia = {}; unicas.forEach(d => { porFamilia[d._familia]=(porFamilia[d._familia]||0)+1; });
  const result = { totalLinhas: allRows.length, osUnicas: unicas.length, porSetor, porFamilia };
  cachePlanilha = { dados: result, hora: Date.now() };
  console.log('LIDO ' + result.totalLinhas + ' linhas | ' + result.osUnicas + ' OS');
  return result;
}

// --- BOT ---
const menu = Markup.keyboard([['OS','CÓDIGO','FAMÍLIA'],['SETOR','STATUS','/resumo'],['/alertas','/dashboard']]).resize();

bot.start((ctx) => ctx.reply('Bot ZROF - Online ✅\nUse /dashboard', menu));
bot.command('limpar', (ctx) => { cachePlanilha={dados:null,hora:0}; return ctx.reply('Cache limpo!', menu); });
bot.command('dashboard', (ctx) => {
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('Dashboard: '+url, menu);
});
bot.command('resumo', async (ctx) => {
  try {
    const d = await lerPlanilha();
    return ctx.reply(`OS Unicas: ${d.osUnicas}\nTotal linhas: ${d.totalLinhas}`, menu);
  } catch(e){ return ctx.reply('Erro ao ler planilha'); }
});
bot.hears(['OS','CÓDIGO','FAMÍLIA','SETOR','STATUS'], (ctx) => ctx.reply('Digite o valor para '+ctx.message.text+':'));
bot.on('text', async (ctx) => {
  const txt = ctx.message.text.trim();
  if (txt.startsWith('/')) return;
  if (['OS','CÓDIGO','FAMÍLIA','SETOR','STATUS'].includes(txt)) return;
  return ctx.reply(`Recebi: ${txt}\nTotal OS: ${(await lerPlanilha()).osUnicas}`, menu);
});

bot.catch((err) => console.log('Erro bot:', err.message));

// --- EXPRESS - ORDEM CORRETA PARA WEBHOOK ---
app.get('/', (req,res)=>res.send('Bot ZROF online - <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{
  try { res.json(await lerPlanilha()); } catch(e){ res.json({osUnicas:0, porSetor:{}, porFamilia:{}}); }
});
app.get('/dashboard', (req,res)=>{
  const html = [
'<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:16px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style></head><body>',
'<h2 id="titulo">Carregando...</h2><div class="grid"><div class="card"><h3>N de Ordens por Setor</h3><canvas id="c1"></canvas></div><div class="card"><h3>N de Ordens por Familia</h3><canvas id="c2"></canvas></div></div>',
'<script>fetch("/api/resumo").then(r=>r.json()).then(d=>{document.getElementById("titulo").innerText="ZROF - "+d.osUnicas+" OS / "+d.totalLinhas+" linhas";new Chart(document.getElementById("c1"),{type:"bar",data:{labels:Object.keys(d.porSetor),[STRIPPED]
'new Chart(document.getElementById("c2"),{type:"bar",data:{labels:Object.keys(d.porFamilia),[STRIPPED]
'</script></body></html>'
  ].join(''); res.send(html);
});

// IMPORTANTE: webhook SEM express.json() antes
app.use(bot.webhookCallback('/telegram'));

app.listen(PORT, async () => {
  console.log('Porta '+PORT);
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (domain) {
    const webhookUrl = 'https://'+domain+'/telegram';
    try {
      await bot.telegram.setWebhook(webhookUrl);
      console.log('Webhook SETADO: '+webhookUrl);
      const info = await bot.telegram.getWebhookInfo();
      console.log('Webhook info:', info.url, ' pendentes:', info.pending_update_count);
    } catch(e){ console.log('Erro webhook:', e.message); }
  } else {
    console.log('Sem RENDER_EXTERNAL_HOSTNAME - usando polling');
    bot.launch();
  }
});