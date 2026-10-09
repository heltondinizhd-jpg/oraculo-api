const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.log('BOT_TOKEN nao definido');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

let cachePlanilha = { dados: null, hora: 0 };
let esperandoFiltro = {};

async function parseCSV(text) {
  const rows = [];
  let cur = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i+1];
    if (c === '"') {
      if (inQ && n === '"') { cur += '"'; i++; }
      else inQ =!inQ;
    } else if (c === ',' &&!inQ) {
      row.push(cur); cur = '';
    } else if ((c === '\n' || c === '\r') &&!inQ) {
      if (cur || row.length) { row.push(cur); rows.push(row); row=[]; cur=''; }
      if (c === '\r' && n === '\n') i++;
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.join('').trim()!== '');
}

async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
  let allRows = [];
  let cab = null;
  let offset = 0;
  while (true) {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&tq=' + encodeURIComponent('SELECT * LIMIT 1000 OFFSET ' + offset);
    try {
      const r = await axios.get(url, { responseType: 'text', timeout: 15000 });
      const rows = await parseCSV(r.data);
      if (!rows.length) break;
      if (!cab) { cab = rows[0].map(h=>h.replace(/"/g,'').trim()); allRows.push(...rows.slice(1)); }
      else allRows.push(...rows);
      if (rows.length < 1000) break;
      offset += 1000;
      if (offset > 15000) break;
    } catch (e) { break; }
  }
  const upper = cab.map(h=>h.toUpperCase());
  const idxOS = upper.findIndex(h=>h==='OS');
  const idxSetor = upper.findIndex(h=>h.includes('SETOR'));
  const idxFamilia = upper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));
  const idxQtd = upper.findIndex(h=>h.includes('QTD') && h.includes('RETIRADA'));
  const idxLead = upper.findIndex(h=>h.includes('LEAD'));
  const dados = allRows.map(cols=>{
    let o={}; cab.forEach((h,i)=>o[h]=(cols[i]||'').replace(/^"|"$/g,'').trim());
    o._os = o[cab[idxOS]]||'';
    o._setor = idxSetor>=0? (o[cab[idxSetor]]||'SEM SETOR') : 'SEM SETOR';
    o._familia = idxFamilia>=0? (o[cab[idxFamilia]]||'SEM FAMILIA') : 'SEM FAMILIA';
    o._qtd = idxQtd>=0? (parseFloat(String(o[cab[idxQtd]]||'0').replace(',','.'))||0) : 0;
    o._lead = idxLead>=0? (parseInt(o[cab[idxLead]])||0) : 0;
    o._busca = Object.values(o).join(' ').toLowerCase();
    return o;
  }).filter(o=>o._os);
  const ret = { cabecalho: cab, dados };
  cachePlanilha = { dados: ret, hora: Date.now() };
  console.log('LIDO ' + dados.length + ' linhas');
  return ret;
}

const menu = Markup.keyboard([['OS','CÓDIGO','FAMÍLIA'],['SETOR','STATUS','/resumo'],['/alertas','/dashboard']]).resize();
bot.start((ctx) => ctx.reply('Bot ZROF - Online', menu));
bot.command('dashboard', (ctx) => {
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('Dashboard: '+url, menu);
});
bot.command('limpar', (ctx) => { cachePlanilha={dados:null,hora:0}; return ctx.reply('Cache limpo!', menu); });

app.get('/api/dados', async (req,res)=>{
  try{
    const data = await lerPlanilhaCompleta();
    res.json({ cabecalho: data.cabecalho, dados: data.dados.slice(0,8000) });
  }catch(e){ res.json({cabecalho:[], dados:[]}); }
});

app.get('/dashboard', (req,res)=>{
  const parts = [
'<!DOCTYPE html>',
'<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
'<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
'<style>',
'body{font-family:system-ui;background:#0f172a;color:#fff;padding:12px}',
'.tabs{display:flex;gap:8px;margin-bottom:12px}',
'.tab{padding:10px 16px;background:#1e293b;border-radius:12px;cursor:pointer}',
'.tab.active{background:#38bdf8;color:#000;font-weight:bold}',
'.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:12px}',
'.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}',
'@media(max-width:900px){.grid{grid-template-columns:1fr}}',
'table{width:100%;border-collapse:collapse;margin-top:12px}',
'th,td{border:1px solid #334155;padding:6px;font-size:11px}',
'.pend{background:#7f1d1d;color:#fecaca;font-weight:bold}',
'input,button{padding:10px;border-radius:8px;border:none}',
'button{background:#38bdf8;font-weight:bold;margin-left:6px}',
'input{width:180px}',
'</style></head><body>',
'<h2 id="titulo">Carregando...</h2>',
'<div class="tabs">',
'<div class="tab active" id="t1" onclick="showTab(1)">N Ordens por Setor e Familia</div>',
'<div class="tab" id="t2" onclick="showTab(2)">Material Pendente</div>',
'</div>',
'<div id="tab1">',
'<div class="grid">',
'<div class="card"><h3>N de Ordens por Setor</h3><canvas id="cSetor"></canvas></div>',
'<div class="card"><h3>N de Ordens por Familia</h3><canvas id="cFamilia"></canvas></div>',
'</div>',
'<div class="card" id="resumo"></div>',
'</div>',
'<div id="tab2" style="display:none">',
'<div class="card"><h3>Consulta OS</h3>',
'<input id="buscaOS" placeholder="Digite a OS">',
'<button onclick="buscar()">Buscar</button>',
'<button onclick="buscarPend()">So Pendentes</button>',
'<div id="resultado"></div>',
'</div></div>',
'<script>',
'let dadosGlobais=[]; let cabGlobais=[];',
'function showTab(n){',
'document.getElementById("tab1").style.display=n==1?"block":"none";',
'document.getElementById("tab2").style.display=n==2?"block":"none";',
'document.getElementById("t1").className=n==1?"tab active":"tab";',
'document.getElementById("t2").className=n==2?"tab active":"tab";',
'}',
'function render(lista){',
'if(!lista.length){document.getElementById("resultado").innerHTML="<p>Nada</p>";return;}',
'let h="<p>"+lista.length+" linhas | Pend: "+lista.filter(function(d){return d._qtd==0}).length+"</p><div style=overflow:auto><table><tr>";',
'cabGlobais.forEach(function(c){h+="<th>"+c+"</th>"});',
'h+="</tr>";',
'lista.forEach(function(d){',
'let cls=d._qtd==0?"pend":"";',
'h+="<tr class="+cls+">";',
'cabGlobais.forEach(function(c){h+="<td>"+(d[c]||"")+"</td>"});',
'h+="</tr>";',
'});',
'h+="</table></div>";',
'document.getElementById("resultado").innerHTML=h;',
'}',
'function buscar(){',
'let os=document.getElementById("buscaOS").value.trim().toLowerCase();',
'if(!os)return;',
'render(dadosGlobais.filter(function(d){return String(d._os).toLowerCase().includes(os)}));',
'}',
'function buscarPend(){',
'let os=document.getElementById("buscaOS").value.trim().toLowerCase();',
'if(!os)return;',
'render(dadosGlobais.filter(function(d){return String(d._os).toLowerCase().includes(os) && d._qtd==0}));',
'}',
'