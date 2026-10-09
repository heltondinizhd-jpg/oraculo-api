const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) process.exit(1);

const bot = new Telegraf(BOT_TOKEN);
const app = express();
let cache = null;
let cacheHora = 0;

async function getCSV(gid) {
  const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + gid;
  const r = await axios.get(url, { responseType: 'text', timeout: 20000 });
  return r.data;
}

function parse(txt) {
  const linhas = txt.split(/\r?\n/).filter(l => l.trim()!== '');
  const cab = linhas[0].split(',').map(s => s.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < linhas.length; i++) {
    let linha = linhas[i];
    let cols = [];
    let cur = '';
    let inQ = false;
    for (let j = 0; j < linha.length; j++) {
      let c = linha[j];
      if (c === '"') {
        if (linha[j + 1] === '"') { cur += '"'; j++; } else { inQ =!inQ; }
      } else if (c === ',' &&!inQ) { cols.push(cur); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur);
    rows.push(cols.map(v => v.replace(/^"|"$/g, '').trim()));
  }
  return { cab, rows };
}

async function ler() {
  if (cache && Date.now() - cacheHora < 120000) return cache;
  const csv1 = await getCSV('0');
  let csv2 = null;
  try { csv2 = await getCSV('1'); } catch(e) {}
  const p1 = parse(csv1);
  const up1 = p1.cab.map(h => h.toUpperCase());
  let iOS = up1.indexOf('OS');
  if (iOS < 0) iOS = up1.findIndex(h => h.includes('ORDEM'));
  let iSet = up1.findIndex(h => h.includes('SETOR'));
  let iFam = up1.findIndex(h => h.includes('FAMILIA') || h.includes('FAMÍLIA'));
  let iGru = up1.findIndex(h => h.includes('GRUPO'));

  let mapa = {};
  let mapaMina = {};
  let mapaUsina = {};
  let dados = [];

  p1.rows.forEach(cols => {
    const os = (cols[iOS] || '').replace(/\D/g, '');
    if (!os) return;
    const setor = (cols[iSet] || 'SEM SETOR').toUpperCase();
    const fam = (cols[iFam] || 'SEM FAMILIA').toUpperCase();
    const grupo = (cols[iGru] || '').toUpperCase();
    let macro = 'OUTROS';
    if (grupo.startsWith('M')) macro = 'MINA';
    if (grupo.startsWith('U')) macro = 'USINA';
    let row = {};
    p1.cab.forEach((n, idx) => { row[n] = cols[idx] || ''; });
    dados.push({ os, setor, fam, grupo, macro, row, busca: cols.join(' ').toLowerCase(), pend: [] });
    if (!mapa[os]) mapa[os] = { setor, fam, macro };
    if (macro === 'MINA') mapaMina[os] = true;
    if (macro === 'USINA') mapaUsina[os] = true;
  });

  let pendPorOS = {};
  let totPend = 0;
  if (csv2) {
    const p2 = parse(csv2);
    const up2 = p2.cab.map(h => h.toUpperCase());
    let iOS2 = up2.indexOf('OS');
    if (iOS2 < 0) iOS2 = up2.findIndex(h => h.includes('ORDEM'));
    let iQtd = up2.findIndex(h => h.includes('RETIRADA'));
    p2.rows.forEach(cols => {
      const os = (cols[iOS2] || '').replace(/\D/g, '');
      if (!os) return;
      const qtd = (cols[iQtd] || '').trim();
      if (qtd === '' || qtd === '0' || qtd === '0,0') {
        if (!pendPorOS[os]) pendPorOS[os] = [];
        let m = {};
        p2.cab.forEach((n, idx) => { m[n] = cols[idx] || ''; });
        pendPorOS[os].push(m);
        totPend++;
      }
    });
    dados.forEach(d => { if (pendPorOS[d.os]) d.pend = pendPorOS[d.os]; });
  }

  const porSetor = {};
  const porSetorMina = {};
  const porSetorUsina = {};
  const porFamMina = {};
  const porFamUsina = {};

  Object.values(mapa).forEach(v => {
    porSetor[v.setor] = (porSetor[v.setor] || 0) + 1;
  });
  Object.keys(mapaMina).forEach(os => {
    const s = mapa[os].setor;
    porSetorMina[s] = (porSetorMina[s] || 0) + 1;
    porFamMina[mapa[os].fam] = (porFamMina[mapa[os].fam] || 0) + 1;
  });
  Object.keys(mapaUsina).forEach(os => {
    const s = mapa[os].setor;
    porSetorUsina[s] = (porSetorUsina[s] || 0) + 1;
    porFamUsina[mapa[os].fam] = (porFamUsina[mapa[os].fam] || 0) + 1;
  });

  const res = {
    total: Object.keys(mapa).length,
    tMina: Object.keys(mapaMina).length,
    tUsina: Object.keys(mapaUsina).length,
    totPend,
    porSetor,
    porSetorMina,
    porSetorUsina,
    porFamMina,
    porFamUsina
  };
  res.dadosFull = dados;
  res.porMacro = { MINA: res.tMina, USINA: res.tUsina };
  cache = res;
  cacheHora = Date.now();
  console.log('LIDO', res.total, res.tMina, res.tUsina, res.totPend);
  return res;
}

ler();

const menu = Markup.keyboard([['Buscar OS', 'Resumo'], ['Dashboard', 'Limpar']]).resize();
bot.start((ctx) => ctx.reply('ZROF Online', menu));
bot.hears('Resumo', (ctx) => { ctx.message.text = '/resumo'; bot.handleUpdate({ message: ctx.message }); });
bot.hears('Dashboard', (ctx) => {
  const d = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = d? 'https://' + d + '/dashboard' : '/dashboard';
  ctx.reply(url, menu);
});
bot.hears('Limpar', async (ctx) => {
  cache = null;
  const r = await ler();
  ctx.reply('OK Total:' + r.total + ' Pend:' + r.totPend, menu);
});
bot.hears('Buscar OS', (ctx) => ctx.reply('Digite a OS', menu));

bot.command('resumo', async (ctx) => {
  const d = await ler();
  let txt = 'RESUMO\nTotal:' + d.total + ' Mina:' + d.tMina + ' Usina:' + d.tUsina + ' Pend:' + d.totPend + '\n';
  txt += '\nSETOR GERAL:\n';
  Object.entries(d.porSetor).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => { txt += k + ': ' + v + '\n'; });
  await ctx.reply(txt.substring(0, 4000), menu);
});

bot.command('limpar', async (ctx) => {
  cache = null;
  const r = await ler();
  ctx.reply('Limpou ' + r.total, menu);
});

bot.on('text', async (ctx) => {
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/') || ['Buscar OS', 'Resumo', 'Dashboard', 'Limpar'].includes(texto)) return;
  const d = await ler();
  const dig = texto.replace(/\D/g, '');
  const busca = texto.toLowerCase();
  const ach = d.dadosFull.filter(x => x.busca.includes(busca) || (dig && x.os.includes(dig)));
  if (!ach.length) return ctx.reply('Nada para ' + texto, menu);
  for (const it of ach.slice(0, 2)) {
    let det = 'OS: ' + it.os + ' Macro:' + it.macro + '\nSetor:' + it.setor + '\nGrupo:' + it.grupo + '\n---\n';
    for (const k in it.row) { if (it.row[k]) det += k + ': ' + it.row[k] + '\n'; }
    if (it.pend.length > 0) {
      det += '\nPENDENTES (Qtd.retirada=0): ' + it.pend.length + '\n';
      it.pend.slice(0, 5).forEach((m, i) => {
        det += (i + 1) + '. ' + JSON.stringify(m).substring(0, 100) + '\n';
      });
    }
    await ctx.reply(det.substring(0, 4000), menu);
  }
});

app.get('/', (req, res) => res.send('OK <a href="/dashboard">dashboard</a>'));
app.get('/api/resumo', async (req, res) => res.json(await ler()));
app.get('/dashboard', (req, res) => res.sendFile(__dirname + '/dash.html'));

const html = '<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><script src=https://cdn.jsdelivr.net/npm/chart.js></script><style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding:12px;border-radius:12px;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style></head><body><h2 id=tit>Loading</h2><div class=grid><div class=card><canvas id=c1></canvas></div><div class=card><canvas id=c2></canvas></div></div><div class=grid><div class=card><canvas id=c3></canvas></div><div class=card><canvas id=c4></canvas></div></div><script>async function L(){const d=await fetch("/api/resumo").then(r=>r.json());document.getElementById("tit").innerText="Total:"+d.total+" Mina:"+d.tMina+" Usina:"+d.tUsina+" Pend:"+d.totPend;function s(o){return Object.entries(o).sort((a,b)=>b[1]-a[1])}function bar(id,obj){const e=s(obj);new Chart(document.getElementById(id),{type:"bar",data:{labels:e.map(x=>x[0]),datasets:[{data:e.map(x=>x[1])}]},options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#fff"}},y:{ticks:{color:"#fff"}}}}})}new Chart(document.getElementById("c1"),{type:"doughnut",data:{labels:["MINA","USINA"],datasets:[{data:[d.tMina,d.tUsina]}]}});bar("c2",d.porSetor);bar("c3",d.porSetorMina);bar("c4",d.porSetorUsina)}L();</script></body></html>';
fs.writeFileSync(__dirname + '/dash.html', html);

app.use(bot.webhookCallback('/telegram'));
app.listen(PORT, async () => {
  const dom = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (dom) { try { await bot.telegram.setWebhook('https://' + dom + '/telegram'); } catch(e) {} }
  else { bot.launch(); }
});