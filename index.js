const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
if(!BOT_TOKEN) process.exit(1);
const bot = new Telegraf(BOT_TOKEN);
let cache = null;
async function getData(){
 if(cache) return cache;
 const url = 'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv';
 const r = await axios.get(url,{responseType:'text'});
 const lines = r.data.split('\n').filter(l=>l.trim());
 cache = lines;
 return lines;
}
app.get('/api/resumo', async (req,res)=>{
 try{
  const lines = await getData();
  res.json({total: lines.length});
 }catch(e){ res.json({total:0}); }
});
app.get('/dashboard', (req,res)=>{
 res.send('<html><head><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body style="background:#0f172a;color:#fff;font-family:system-ui;padding:20px"><h2 id="t">ZROF - Carregando...</h2><div style="background:#1e293b;padding:15px;border-radius:12px;margin:10px 0"><h3>N Ordens por Setor</h3><canvas id="a"></canvas></div><div style="background:#1e293b;padding:15px;border-radius:12px"><h3>N Ordens por Familia</h3><canvas id="b"></canvas></div><script>fetch("/api/resumo").then(r=>r.json()).then(d=>{document.getElementById("t").innerText="ZROF - "+d.total+" linhas";new Chart(document.getElementById("a"),{type:"bar",data:{labels:["A","B","C"],datasets:[{label:"Ordens",data:[3,5,2]}]}});new Chart(document.getElementById("b"),{type:"bar",data:{labels:["F1","F2"],datasets:[{label:"Ordens",data:[4,6]}]}});});</script></body></html>');
});
app.get('/',(req,res)=>res.send('OK <a href="/dashboard">dashboard</a>'));
app.use(bot.webhookCallback('/telegram'));
app.listen(PORT, async ()=>{
 console.log('Porta '+PORT);
 const dom = process.env.RENDER_EXTERNAL_HOSTNAME;
 if(dom){ try{ await bot.telegram.setWebhook('https://'+dom+'/telegram'); }catch(e){} } else { bot.launch(); }
});