const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express();

let cachePlanilha = { dados: null, hora: 0 };
let esperandoFiltro = {};

async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
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
    return rows.filter(r => r.join('').trim()!=='');
  }

  let allDataRows = []; let cabecalho = null; let offset = 0;
  while (true) {
    const tq = `SELECT * LIMIT 1000 OFFSET ${offset}`;
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&tq=${encodeURIComponent(tq)}`;
    try {
      const { data } = await axios.get(url, { responseType: 'text' });
      const rows = await parseCSV(data);
      if (rows.length === 0) break;
      if (!cabecalho) { cabecalho = rows[0].map(h => h.replace(/"/g,'').trim().toUpperCase()); allDataRows.push(...rows.slice(1)); }
      else { const isHeader = rows[0].join(',').toUpperCase().includes('OS'); allDataRows.push(...(isHeader? rows.slice(1): rows)); }
      if (rows.length < 1000) break;
      offset += 1000; if (offset > 15000) break;
    } catch (e) { break; }
  }

  const idxEmissao = cabecalho.findIndex(h => h.includes('EMISS'));
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dados = allDataRows.map(cols => {
    let obj = {}; cabecalho.forEach((h, idx) => obj[h] = (cols[idx] || '').replace(/^"|"$/g,'').trim());
    const emissaoStr = idxEmissao >=0? (cols[idxEmissao]||'') : '';
    let lead = 0; const m = emissaoStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) { let d=parseInt(m[1]), mo=parseInt(m[2])-1, a=parseInt(m[3]); if(a<100) a+=2000; const dt=new Date(a,mo,d); dt.setHours(0,0,0,0); if(!isNaN(dt)) lead=Math.floor((hoje-dt)/(1000*60*60*24)); }
    obj._leadTime=lead; obj._emissaoRaw=emissaoStr; obj._textoBusca=Object.values(obj).join(' ').toLowerCase();
    return obj;
  }).filter(o=>o['OS']);

  const res = { cabecalho, dados }; cachePlanilha={ dados: res, hora: Date.now() };
  console.log(`TOTAL LIDO: ${dados.length} OS`); return res;
}

const menuFiltros = Markup.keyboard([['OS','CÓDIGO','FAMÍLIA'],['SETOR','STATUS','/resumo'],['/alertas','/dashboard']]).resize();

bot.start(async (ctx) => { await ctx.reply('🤖 Bot de Ordens - Dashboard Ativo', menuFiltros); });
bot.command('limpar', async (ctx) => { cachePlanilha={dados:null,hora:0}; await ctx.reply('Cache limpo!'); });
bot.command('resumo', async (ctx) => {
  const { dados } = await lerPlanilhaCompleta();
  let txt = `📊 *RESUMO GERAL: ${dados.length} OS*\n`;
  const porSetor = {}; dados.forEach(d=>{ porSetor[d['SETOR']]=(porSetor[d['SETOR']]||0)+1; });
  Object.entries(porSetor).forEach(([k,v])=> txt+= `${k}: ${v}\n`);
  await ctx.reply(txt, { parse_mode: 'Markdown',...menuFiltros });
});
bot.command('alertas', async (ctx) => {
  const { dados } = await lerPlanilhaCompleta();
  const criticas = dados.filter(d=>d._leadTime>30);
  await ctx.reply(`🚨 *${criticas.length} OS com LEAD > 30 dias*`, { parse_mode: 'Markdown' });
});
bot.command('dashboard', async (ctx) => {
  await ctx.reply(`📈 Dashboard: https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'seu-app.onrender.com'}/dashboard`);
});
bot.hears(['OS','CÓDIGO','FAMÍLIA','SETOR','STATUS'], async (ctx) => {
  const mapa = { 'OS':'OS','CÓDIGO':'CODIGO','FAMÍLIA':'FAMILIA','SETOR':'SETOR','STATUS':'STATUS' };
  esperandoFiltro[ctx.from.id]=mapa[ctx.message.text];
  await ctx.reply(`Digite o valor para ${ctx.message.text}:`);
});

bot.on('text', async (ctx) => {
  const textoOriginal = ctx.message.text.trim(); if (textoOriginal.startsWith('/')) return;
  const id = ctx.from.id; const texto = textoOriginal.toLowerCase();
  const { cabecalho, dados } = await lerPlanilhaCompleta();
  const filtroAtivo = esperandoFiltro[id];
  let encontradas = filtroAtivo? dados.filter(d=>(d[filtroAtivo]||'').toLowerCase().includes(texto)) : dados.filter(d=>d._textoBusca.includes(texto));
  delete esperandoFiltro[id];
  if (encontradas.length===0) { await ctx.reply(`❌ Nada para "${textoOriginal}"`, {...menuFiltros}); return; }

  if (encontradas.length===1) {
    const os = encontradas[0];
    let r = `🔍 *FICHA COMPLETA OS ${os['OS']}*\n━━━━━━━━━━━━\n`;
    cabecalho.forEach(col=>{ if(!col.startsWith('_')) r+=`*${col}:* ${os[col]||'-'}\n`; });
    await ctx.reply(r.substring(0,4096), { parse_mode: 'Markdown',...menuFiltros });
    return;
  }

  await ctx.reply(`✅ *${encontradas.length} OS encontradas para "${textoOriginal}" - 1 linha por OS:*`, { parse_mode: 'Markdown' });
  for (let i=0; i<encontradas.length; i+=10) {
    const lote = encontradas.slice(i,i+10); let msg='';
    lote.forEach(o=>{ msg+=`• OS *${o['OS']}* | COD ${o['CODIGO']} | ${o._emissaoRaw} | ${o['SETOR']} | LEAD ${o._leadTime}d\n`; });
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  }
  await ctx.reply(`Total: ${encontradas.length} OS`, menuFiltros);
});

app.get('/dashboard', async (req,res) => {
  const { dados } = await lerPlanilhaCompleta();
  let html = `<h1>Dashboard - ${dados.length} OS</h1><table border=1><tr><th>OS</th><th>CODIGO</th><th>EMISSÃO</th><th>SETOR</th><th>STATUS</th><th>LEAD</th></tr>`;
  dados.slice(0,500).forEach(o=>{ html+=`<tr><td>${o['OS']}</td><td>${o['CODIGO']}</td><td>${o._emissaoRaw}</td><td>${o['SETOR']}</td><td>${o['STATUS']}</td><td>${o._leadTime}</td></tr>`; });
  html+=`</table>`; res.send(html);
});

app.get('/', (req,res)=>res.send('Bot online'));
app.listen(PORT, ()=>console.log('Web ok'));
bot.launch(); console.log('Bot ok');