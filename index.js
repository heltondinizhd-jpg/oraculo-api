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
  if (cache.dados && Date.now() - cache.hora < 5*60*1000) return cache.dados;
  try {
    console.log('Iniciando leitura planilha ID:', SHEET_ID.substring(0,10)+'...');
    // USA GVIZ COM LIMIT 5000 - RAPIDO E FUNCIONA COM PLANILHA PRIVADA PUBLICA
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv';
    const r = await axios.get(url, { responseType: 'text', timeout: 25000 });
    console.log('CSV recebido tamanho:', r.data.length);

    const linhas = r.data.split(/\r?\n/).filter(l=>l.trim());
    console.log('Linhas brutas:', linhas.length);
    const cab = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const upper = cab.map(h=>h.toUpperCase());
    const idxOS = upper.findIndex(h=>h==='OS');
    const idxSetor = upper.findIndex(h=>h.includes('SETOR'));
    const idxFam = upper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));
    const idxQtd = upper.findIndex(h=>h.includes('QTD') && h.includes('RETIRADA'));

    if (idxOS === -1) {
      console.log('CABECALHO NAO ENCONTRADO:', cab);
      throw new Error('Coluna OS nao encontrada');
    }

    const dadosFull = [];
    const mapa = {};

    for (let i=1;i<linhas.length;i++){
      const linha = linhas[i];
      // parser CSV simples
      const cols = []; let cur='', inQ=false;
      for (let j=0;j<linha.length;j++){
        const c=linha[j];
        if (c==='"'){
          if (linha[j+1]==='"'){ cur+='"'; j++; } else inQ=!inQ;
        }
        else if (c===',' &&!inQ){ cols.push(cur); cur=''; }
        else cur+=c;
      }
      cols.push(cur);
      const get = (idx)=> idx>=0? (cols[idx]||'').replace(/^"|"$/g,'').trim() : '';
      const os = get(idxOS); if(!os) continue;
      const setor = get(idxSetor)||'SEM SETOR';
      const fam = get(idxFam)||'SEM FAMILIA';
      const qtd = idxQtd>=0? parseFloat(get(idxQtd).replace(',','.'))||0 : 0;
      dadosFull.push({ _os: os, _setor: setor, _familia: fam, _qtd: qtd, _busca: linha.toLowerCase(), _raw: cols });
      if (!mapa[os]) mapa[os] = { _setor: setor, _familia: fam };
    }

    const unicas = Object.values(mapa);
    const porSetor = {}; unicas.forEach(d=>{ porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
    const porFamilia = {}; unicas.forEach(d=>{ porFamilia[d._familia]=(porFamilia[d._familia]||0)+1; });
    const pendentes = dadosFull.filter(d=>d._qtd===0).length;

    const result = { cab, totalLinhas: dadosFull.length, osUnicas: unicas.length, porSetor, porFamilia, dadosFull, pendentes, debug: { cab } };
    cache = { dados: result, hora: Date.now() };
    console.log('LIDO OK:', result.totalLinhas, 'linhas', result.osUnicas, 'OS');
    return result;
  } catch (e) {
    console.log('ERRO LER PLANILHA:', e.message);
    return cache.dados || { cab:[], totalLinhas:0, osUnicas:0, porSetor:{}, porFamilia:{}, dadosFull:[], pendentes:0, erro: e.message };
  }
}

// aquece cache
lerPlanilha();

const menu = Markup.keyboard([['/dashboard','/resumo']]).resize();

bot.start((ctx)=>ctx.reply('Bot ZROF Online - digite a OS', menu));

bot.command('dashboard', (ctx)=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('Dashboard: '+url, menu);
});

bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  if (d.erro) return ctx.reply('Erro: '+d.erro+'\nVerifique se planilha esta com link "qualquer pessoa com link pode ver"');
  if (d.osUnicas===0) return ctx.reply('Nenhum dado lido. Cabecalho: '+JSON.stringify(d.debug?.cab||[]).substring(0,500));

  let txt = `📊 RESUMO ZROF DETALHADO\n\n`;
  txt += `OS Únicas: ${d.osUnicas}\n`;
  txt += `Total Linhas: ${d.totalLinhas}\n`;
  txt += `Pendentes (Qtd=0): ${d.pendentes}\n\n`;

  txt += `📍 POR SETOR:\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  txt += `\n👨‍👩‍👧‍👦 POR FAMILIA:\n`;
  Object.entries(d.porFamilia).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });

  // Telegram corta em 4096
  if (txt.length > 4000) {
    await ctx.reply(txt.substring(0,4000), menu);
    await ctx.reply(txt.substring(4000,8000), menu);
  } else {
    await ctx.reply(txt, menu);
  }
});

bot.command('limpar', async (ctx)=>{
  cache={dados:null,hora:0};
  await ctx.reply('Cache limpo, recarregando...');
  await lerPlanilha();
  return ctx.reply('Pronto', menu);
});

bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/')) return;
  if (['/dashboard','/resumo'].includes(texto)) return;
  try {
    const busca = texto.toLowerCase();
    const { dadosFull } = await lerPlanilha();
    if (!dadosFull.length) return ctx.reply('Planilha vazia, use /limpar e tente de novo');
    const achadas = dadosFull.filter(d=>d._busca.includes(busca));
    if (!achadas.length) return ctx.reply(`Nada para "${texto}"`, menu);
    if (achadas.length > 20) return ctx.reply(`${achadas.length} resultados para "${texto}" - seja mais especifico`, menu);
    for (const d of achadas.slice(0,10)){
      const pend = d._qtd===0? ' ⚠️PENDENTE' : '';
      await ctx.reply(`OS ${d._os}${pend}\nSetor: ${d._setor}\nFam: ${d._familia}\nQtd: ${d._qtd}`);
    }
    return ctx.reply(`Total: ${achadas.length}`, menu);
  } catch(e){ return ctx.reply('Erro busca: '+e.message); }
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a> <a href="/api/resumo">API</a>'));
app.get('/api/resumo', async (req,res)=>{ const d = await lerPlanilha(); res.json(d); });
app.get('/api/debug', async (req,res)=>{
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv';
    const r = await axios.get(url, { responseType: 'text', timeout: 15000 });
    res.send('Tamanho CSV: '+r.data.length+'<br>Primeiros 500 chars:<br><pre>'+r.data.substring(0,500)+'</pre>');
  } catch(e){ res.send('Erro debug: '+e.message); }
});

app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));

const dashHtml = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:16px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.grid{grid-template-columns:1fr}}#titulo{font-size:20px}</style>
</head><body>
<h2 id="titulo">Carregando...</h2>
<div class="grid">
<div class="card"><h3>N de Ordens por Setor</h3><canvas id="c1"></canvas></div>
<div class="card"><h3>N de Ordens por Familia</h3><canvas id="c2"></canvas></div>
</div>
<div class="card" id="res">Aguarde carregamento...</div>
<script>
async function load(){
  try{
    const res = await fetch("/api/resumo");
    const d = await res.json();
    if (d.erro){ document.getElementById("titulo").innerText = "Erro: "+d.erro; return; }
    if (d.osUnicas===0){ document.getElementById("titulo").innerText = "Nenhum dado - veja /api/debug"; document.getElementById("res").innerText = JSON.stringify(d.debug); return; }
    document.getElementById("titulo").innerText = "ZROF - " + d.osUnicas + " OS / " + d.totalLinhas + " linhas - Pend: " + d.pendentes;
    document.getElementById("res").innerHTML = "Setores: "+Object.keys(d.porSetor).length+" | Familias: "+Object.keys(d.porFamilia).length;
    new Chart(document.getElementById("c1"),{type:"bar",data:{labels:Object.keys(d.porSetor),[STRIPPED]
    new Chart(document.getElementById("c2"),{type:"bar",data:{labels:Object.keys(d.porFamilia),[STRIPPED]
  }catch(e){
    document.getElementById("titulo").innerText = "Erro ao carregar: "+e.message;
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