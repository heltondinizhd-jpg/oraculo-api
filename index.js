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

async function parseCSV(text) {
  const rows = []; let cur = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const n = text[i+1];
    if (c === '"') { if (inQ && n === '"') { cur += '"'; i++; } else inQ=!inQ; }
    else if (c === ',' &&!inQ) { row.push(cur); cur = ''; }
    else if ((c === '\n' || c === '\r') &&!inQ) {
      if (cur || row.length) { row.push(cur); rows.push(row); row=[]; cur=''; }
      if (c === '\r' && n === '\n') i++;
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.join('').trim()!=='');
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
      if (!cab) { cab = rows[0].map(h=>h.replace(/"/g,'').trim()); allRows.push(...rows.slice(1)); }
      else allRows.push(...rows);
      if (rows.length < 1000) break;
      offset += 1000; if (offset > 15000) break;
    } catch(e){ break; }
  }
  const upper = cab.map(h=>h.toUpperCase());
  const idxOS = upper.findIndex(h=>h==='OS');
  const idxSetor = upper.findIndex(h=>h.includes('SETOR'));
  const idxFam = upper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));
  const idxQtd = upper.findIndex(h=>h.includes('QTD') && h.includes('RETIRADA'));
  const idxLead = upper.findIndex(h=>h.includes('LEAD'));

  const dadosFull = allRows.map(cols=>{
    const get = (i)=> i>=0? (cols[i]||'').replace(/^"|"$/g,'').trim() : '';
    return {
      _os: get(idxOS),
      _setor: get(idxSetor)||'SEM SETOR',
      _familia: get(idxFam)||'SEM FAMILIA',
      _qtd: idxQtd>=0? parseFloat(get(idxQtd).replace(',','.'))||0 : 0,
      _lead: idxLead>=0? parseInt(get(idxLead))||0 : 0,
      _linha: cab.reduce((o,h,i)=>{ o[h]=get(i); return o; },{}),
      _busca: cols.join(' ').toLowerCase()
    };
  }).filter(d=>d._os);

  const mapa = {}; dadosFull.forEach(d=>{ if(!mapa[d._os]) mapa[d._os]=d; });
  const unicas = Object.values(mapa);
  const porSetor = {}; unicas.forEach(d=>{ porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
  const porFamilia = {}; unicas.forEach(d=>{ porFamilia[d._familia]=(porFamilia[d._familia]||0)+1; });

  const result = { cab, totalLinhas: allRows.length, osUnicas: unicas.length, porSetor, porFamilia, dadosFull, unicas };
  cache = { dados: result, hora: Date.now() };
  console.log('LIDO '+result.totalLinhas+' linhas | '+result.osUnicas+' OS');
  return result;
}

// --- BOT ---
const menu = Markup.keyboard([['OS','CÓDIGO'],['/dashboard','/resumo']]).resize();

bot.start((ctx)=>ctx.reply('Bot ZROF Online - digite a OS', menu));
bot.command('dashboard', (ctx)=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('Dashboard: '+url, menu);
});
bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  let txt = `RESUMO\nOS unicas: ${d.osUnicas}\nLinhas: ${d.totalLinhas}\n\nPor Setor:\n`;
  Object.entries(d.porSetor).forEach(([k,v])=> txt+= `${k}: ${v}\n`);
  return ctx.reply(txt.substring(0,4000), menu);
});
bot.command('limpar', (ctx)=>{ cache={dados:null,hora:0}; return ctx.reply('Cache limpo'); });

// BUSCA DE OS - ESSA PARTE QUE FALTAVA
bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/')) return;
  if (['OS','CÓDIGO','/dashboard','/resumo'].includes(texto)) {
    return ctx.reply('Digite o numero da OS:');
  }
  try {
    const busca = texto.toLowerCase();
    const { dadosFull, cab } = await lerPlanilha();
    const achadas = dadosFull.filter(d=> d._busca.includes(busca) );

    if (!achadas.length) return ctx.reply(`Nada encontrado para "${texto}"`, menu);

    if (achadas.length > 20) {
      return ctx.reply(`${achadas.length} linhas encontradas para "${texto}". Refine a busca ou veja no /dashboard`, menu);
    }

    for (let i=0;i<achadas.length;i++){
      const d = achadas[i];
      const pend = d._qtd==0? ' (PENDENTE)' : '';
      let r = `OS ${d._os} | SETOR ${d._setor} | FAM ${d._familia} | QTD ${d._qtd}${pend} | LEAD ${d._lead}d\n`;
      // manda as 8 primeiras colunas da planilha
      const chaves = cab.slice(0,8);
      chaves.forEach(c=>{ r+= `${c}: ${d._linha[c]||'-'}\n`; });
      await ctx.reply(r.substring(0,4000));
    }
    return ctx.reply(`Total: ${achadas.length} materiais`, menu);
  } catch(e){
    console.log('Erro busca', e.message);
    return ctx.reply('Erro ao buscar na planilha');
  }
});

// --- WEB ---
app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{
  try { const d = await lerPlanilha(); res.json(d); } catch(e){ res.json({osUnicas:0,totalLinhas:0,porSetor:{},porFamilia:{}}); }
});
app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));

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
  document.getElementById("res").innerText = "Total OS unicas: " + d.osUnicas;
  new Chart(document.getElementById("c1"),{type:"bar",data:{labels:Object.keys(d.porSetor),[STRIPPED]
  new Chart(document.getElementById("c2"),{type:"bar",data:{labels:Object.keys(d.porFamilia),[STRIPPED]
});
</script>
</body></html>
`;
fs.writeFileSync(__dirname + '/dash.html', dashHtml);

app.use(bot.webhookCallback('/telegram'));

app.listen(PORT, async ()=>{
  console.log('Porta '+PORT);
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (domain) {
    try { await bot.telegram.setWebhook('https://'+domain+'/telegram'); console.log('webhook ok'); } catch(e){ console.log(e.message); }
  } else { bot.launch(); console.log('polling'); }
});