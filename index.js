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
  if (cache.dados && Date.now() - cache.hora < 2*60*1000) return cache.dados;
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv';
    const r = await axios.get(url, { responseType: 'text', timeout: 25000 });
    const linhas = r.data.split(/\r?\n/).filter(l=>l.trim());
    const cab = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const upper = cab.map(h=>h.toUpperCase().trim());
    let idxOS = upper.indexOf('OS');
    if (idxOS === -1) idxOS = upper.findIndex(h=>h.includes('ORDEM'));
    let idxSetor = upper.findIndex(h=>h.includes('SETOR'));
    let idxFam = upper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));
    const mapaOrdens = {}; const dadosFull = [];
    for (let i=1;i<linhas.length;i++){
      const linha = linhas[i]; if (!linha.trim()) continue;
      const cols = []; let cur='', inQ=false;
      for (let j=0;j<linha.length;j++){
        const c=linha[j];
        if (c==='"'){ if (linha[j+1]==='"'){ cur+='"'; j++; } else inQ=!inQ; }
        else if (c===',' &&!inQ){ cols.push(cur); cur=''; }
        else cur+=c;
      }
      cols.push(cur);
      const get = (idx)=> idx>=0? (cols[idx]||'').replace(/^"|"$/g,'').trim() : '';
      const os = get(idxOS).replace(/\D/g,''); if(!os || os.length < 3) continue;
      const setor = (get(idxSetor)||'SEM SETOR').toUpperCase().trim();
      const fam = (get(idxFam)||'SEM FAMILIA').toUpperCase().trim();
      dadosFull.push({ _os: os, _setor: setor, _familia: fam, _busca: linha.toLowerCase() });
      if (!mapaOrdens[os]) mapaOrdens[os] = { setor, familia: fam };
    }
    const totalOrdens = Object.keys(mapaOrdens).length;
    const porSetor = {}; Object.values(mapaOrdens).forEach(d=>{ porSetor[d.setor]=(porSetor[d.setor]||0)+1; });
    const porFamilia = {}; Object.values(mapaOrdens).forEach(d=>{ porFamilia[d.familia]=(porFamilia[d.familia]||0)+1; });
    const result = { totalOrdens, porSetor, porFamilia, dadosFull };
    cache = { dados: result, hora: Date.now() };
    console.log(`LIDO: ${totalOrdens} Ordens`);
    return result;
  } catch (e) {
    console.log('ERRO:', e.message);
    return cache.dados || { totalOrdens:0, porSetor:{}, porFamilia:{}, dadosFull:[], erro: e.message };
  }
}

lerPlanilha();
const menu = Markup.keyboard([['/dashboard','/resumo']]).resize();
bot.start((ctx)=>ctx.reply('Bot ZROF Online ✅', menu));
bot.command('dashboard', (ctx)=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? 'https://'+domain+'/dashboard' : '/dashboard';
  return ctx.reply('Dashboard: '+url, menu);
});
bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  let txt = `📊 RESUMO ZROF\n\nTotal de Ordens: ${d.totalOrdens}\n\n`;
  txt += `📍 POR SETOR:\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });
  txt += `\n👨‍👩‍👧‍👦 POR FAMILIA:\n`;
  Object.entries(d.porFamilia).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });
  await ctx.reply(txt.substring(0,4000), menu);
  if (txt.length > 4000) await ctx.reply(txt.substring(4000,8000), menu);
});
bot.command('limpar', async (ctx)=>{ cache={dados:null,hora:0}; const d=await lerPlanilha(); return ctx.reply(`Pronto! Total: ${d.totalOrdens}`, menu); });
bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim(); if (texto.startsWith('/')) return;
  try {
    const busca = texto.toLowerCase(); const { dadosFull } = await lerPlanilha();
    const achadas = dadosFull.filter(d=>d._busca.includes(busca));
    if (!achadas.length) return ctx.reply(`Nada para "${texto}"`, menu);
    for (const d of achadas.slice(0,10)){ await ctx.reply(`OS ${d._os}\nSetor: ${d._setor}\nFam: ${d._familia}`); }
  } catch(e){}
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{ res.json(await lerPlanilha()); });
app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));

const dashHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:16px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}h2{margin:0 0 16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.grid{grid-template-columns:1fr}}</style>
</head><body>
<h2 id="titulo">Carregando ZROF...</h2>
<div class="grid">
<div class="card"><h3>Ordens por Setor</h3><canvas id="cSetor"></canvas></div>
<div class="card"><h3>Ordens por Familia</h3><canvas id="cFam"></canvas></div>
</div>
<script>
async function load(){
  try{
    const d = await fetch('/api/resumo').then(r=>r.json());
    document.getElementById('titulo').innerText = 'ZROF - ' + d.totalOrdens + ' Ordens';

    const ctx1 = document.getElementById('cSetor');
    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: Object.keys(d.porSetor),
        datasets: [{ label: 'Ordens', data: Object.values(d.porSetor), backgroundColor: '#38bdf8' }]
      },
      options: { responsive:true, plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#fff'}}, y:{ticks:{color:'#fff'}}} }
    });

    const ctx2 = document.getElementById('cFam');
    new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: Object.keys(d.porFamilia),
        datasets: [{ label: 'Ordens', data: Object.values(d.porFamilia), backgroundColor: '#fbbf24' }]
      },
      options: { responsive:true, plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#fff'}}, y:{ticks:{color:'#fff'}}} }
    });

  }catch(e){
    document.getElementById('titulo').innerText = 'Erro: ' + e.message;
  }
}
load();
</script>
</body></html>
`;
fs.writeFileSync(__dirname + '/dash.html', dashHtml);
app.use(bot.webhookCallback('/telegram'));
app.listen(PORT, async ()=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (domain) { try { await bot.telegram.setWebhook('https://'+domain+'/telegram'); console.log('webhook ok'); } catch(e){ console.log(e.message); } }
  else { bot.launch(); console.log('polling'); }
});