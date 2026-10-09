const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) {
  console.error('Falta BOT_TOKEN');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

let cachePlanilha = { dados: null, hora: 0 };
let esperandoFiltro = {};

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

async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
  let allRows = []; let cab = null; let offset = 0;
  while (true) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&tq=${encodeURIComponent('SELECT * LIMIT 1000 OFFSET '+offset)}`;
    try {
      const r = await axios.get(url, { responseType: 'text', timeout: 15000 });
      const rows = await parseCSV(r.data);
      if (!rows.length) break;
      if (!cab) { cab = rows[0].map(h=>h.replace(/"/g,'').trim()); allRows.push(...rows.slice(1)); }
      else allRows.push(...rows);
      if (rows.length < 1000) break;
      offset += 1000; if (offset > 15000) break;
    } catch(e) { break; }
  }
  const upper = cab.map(h=>h.toUpperCase());
  const idxOS = upper.findIndex(h=>h==='OS');
  const idxSetor = upper.findIndex(h=>h.includes('SETOR'));
  const idxFamilia = upper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));
  const idxQtd = upper.findIndex(h=>h.includes('QTD') && h.includes('RETIRADA'));
  const idxLead = upper.findIndex(h=>h.includes('LEAD'));
  const idxStatus = upper.findIndex(h=>h.includes('STATUS'));

  const dados = allRows.map(cols=>{
    let o={}; cab.forEach((h,i)=>o[h]=(cols[i]||'').replace(/^"|"$/g,'').trim());
    o._os = o[cab[idxOS]]||'';
    o._setor = idxSetor>=0? (o[cab[idxSetor]]||'SEM SETOR') : 'SEM SETOR';
    o._familia = idxFamilia>=0? (o[cab[idxFamilia]]||'SEM FAMILIA') : 'SEM FAMILIA';
    o._status = idxStatus>=0? (o[cab[idxStatus]]||'') : '';
    o._qtd = idxQtd>=0? (parseFloat(String(o[cab[idxQtd]]||'0').replace(',','.'))||0) : 0;
    o._lead = idxLead>=0? (parseInt(o[cab[idxLead]])||0) : 0;
    o._busca = Object.values(o).join(' ').toLowerCase();
    return o;
  }).filter(o=>o._os);

  const ret = { cabecalho: cab, dados };
  cachePlanilha = { dados: ret, hora: Date.now() };
  console.log(`LIDO: ${dados.length} linhas materiais | ${new Set(dados.map(d=>d._os)).size} OS unicas`);
  return ret;
}

const menu = Markup.keyboard([['OS','CÓDIGO','FAMÍLIA'],['SETOR','STATUS','/resumo'],['/alertas','/dashboard']]).resize();

bot.start(ctx=>ctx.reply('Bot ZROF Oráculo - Online', menu));
bot.command('limpar', ctx=>{ cachePlanilha={dados:null,hora:0}; return ctx.reply('Cache limpo!', menu); });
bot.command('dashboard', ctx=>{
  const dom = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = dom? `https://${dom}/dashboard` : '/dashboard';
  return ctx.reply(`Dashboard: ${url}`, menu);
});
bot.command('resumo', async ctx=>{
  const { dados } = await lerPlanilhaCompleta();
  const unicas = [...new Map(dados.map(d=>[d._os,d])).values()];
  let txt=`RESUMO: ${unicas.length} OS únicas / ${dados.length} linhas materiais\n`;
  const porSetor={}; unicas.forEach(d=>{ porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
  Object.entries(porSetor).forEach(([k,v])=> txt+=`${k}: ${v}\n`);
  return ctx.reply(txt.slice(0,4096), menu);
});
bot.command('alertas', async ctx=>{
  const { dados } = await lerPlanilhaCompleta();
  const