const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN não definido!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

let cachePlanilha = { dados: null, hora: 0 };
let esperandoFiltro = {};

async function parseCSV(text) {
  const rows = []; let cur = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const next = text[i+1];
    if (c === '"') { if (inQuotes && next === '"') { cur += '"'; i++; } else inQuotes =!inQuotes; }
    else if (c === ',' &&!inQuotes) { row.push(cur); cur = ''; }
    else if ((c === '\n' || c === '\r') &&!inQuotes) {
      if (cur || row.length) { row.push(cur); rows.push(row); row=[]; cur=''; }
      if (c === '\r' && next === '\n') i++;
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.join('').trim()!== '');
}

async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
  let allDataRows = []; let cabecalho = null; let offset = 0;
  while (true) {
    const tq = `SELECT * LIMIT 1000 OFFSET ${offset}`;
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&tq=${encodeURIComponent(tq)}`;
    try {
      const r = await axios.get(url, { responseType: 'text', timeout: 15000 });
      const rows = await parseCSV(r.data);
      if (rows.length === 0) break;
      if (!cabecalho) { cabecalho = rows[0].map(h => h.replace(/"/g,'').trim().toUpperCase()); allDataRows.push(...rows.slice(1)); }
      else { const isHeader = rows[0].join(',').toUpperCase().includes('OS'); allDataRows.push(...(isHeader? rows.slice(1) : rows)); }
      if (rows.length < 1000) break;
      offset += 1000; if (offset > 15000) break;
    } catch (e) {
      console.error('Erro planilha:', e.message);
      break;
    }
  }
  const idxEmissao = cabecalho? cabecalho.findIndex(h => h.includes('EMISS')) : -1;
  const idxLead = cabecalho? cabecalho.findIndex(h => h.includes('LEAD')) : -1;

  const dados = allDataRows.map(cols => {
    let obj = {}; cabecalho.forEach((h, idx) => obj[h] = (cols[idx] || '').replace(/^"|"$/g,'').trim());
    const emissaoStr = idxEmissao >=0? (cols[idxEmissao]||'') : '';

    let lead = 0;
    if (idxLead >= 0) {
      const rawLead = (cols[idxLead] || '').replace(/^"|"$/g,'').trim();
      const num = parseInt(String(rawLead).replace(/[^0-9\-]/g,''));
      if (!isNaN(num)) lead = num;
    }

    obj._leadTime=lead;
    obj._emissaoRaw=emissaoStr;
    obj._textoBusca=Object.values(obj).join(' ').toLowerCase();
    return obj;
  }).filter(o=>o['OS']);

  const res = { cabecalho, dados };
  cachePlanilha={ dados: res, hora: Date.now() };
  console.log(`TOTAL LIDO: ${dados.length} OS | LEAD da planilha`);
  return res;
}

const menu = Markup.keyboard([['OS','CÓDIGO','FAMÍLIA'],['SETOR','STATUS','/resumo'],['/alertas','/dashboard']]).resize();

bot.start((ctx) => ctx.reply('🤖 Bot de Ordens - Dashboard com gráfico', menu));
bot.command('limpar', (ctx) => { cachePlanilha={dados:null,hora:0}; return ctx.reply('Cache limpo!', menu); });
bot.command('resumo', async (ctx) => {
  try {
    const { dados } = await lerPlanilhaCompleta();
    let txt = `📊 RESUMO GERAL: ${dados.length} OS\n`;
    const porSetor = {}; dados.forEach(d=>{ const s=d['SETOR']||'SEM SETOR'; porSetor[s]=(porSetor[s]||0)+1; });
    Object.entries(porSetor).forEach(([k,v])=> txt+= `${k}: ${v}\n`);
    return ctx.reply(txt.substring(0,4096), menu);
  } catch(e){ return ctx.reply('Erro no resumo', menu); }
});
bot.command('dashboard', (ctx) => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
  return ctx.reply(`📈 Dashboard com gráficos: https://${host}/dashboard`, menu);
});

bot.command('alertas', async (ctx) => {
  try {
    const { dados } = await lerPlanilhaCompleta();