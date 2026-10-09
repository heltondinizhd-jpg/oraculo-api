const express = require('express');
const axios = require('axios');
let Telegraf, Markup;
try{ const t=require('telegraf'); Telegraf=t.Telegraf; Markup=t.Markup; }catch(e){}

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = '/telegraf/'+BOT_TOKEN;

const app = express();
app.use(express.json());
let cache={dados:null,hora:0};
let cacheMat={dados:null,hora:0};
let estado={};

async function lerMateriais(){
  if(cacheMat.dados && Date.now()-cacheMat.hora<120000) return cacheMat.dados;
  const urls=[
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv&sheet=BD_MAT',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1'
  ];
  for(let url of urls){
    try{
      const r=await axios.get(url,{responseType:'text',timeout:15000});
      if(r.data.includes('<html')) continue;
      const cab=r.data.split('\n')[0].toUpperCase();
      if(cab.includes('SETOR') && cab.includes('GRUPO')) continue;
      if(cab.includes('MATERIAL')||cab.includes('QTD')){
        const linhas=r.data.split(/\r?\n/).filter(l=>l.trim());
        const porOS={}, porOSPend={}; let total=0, totalPend=0;
        for(let i=1;i<linhas.length;i++){
          let line=linhas[i], cols=[], cur='', inQ=false;
          for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ;} else if(c==','&&!inQ){cols.push(cur);cur='';} else cur+=c; }
          cols.push(cur);
          const cl=cols.map(s=>s.replace(/^"|"$/g,'').trim());
          const os=(cl[0]||'').replace(/\D/g,''); if(!os) continue;
          const isPend =!cl[6] || cl[6]==='0' || cl[6]==='0,000' || cl[6]==='0,00' || parseFloat(cl[6].replace(',','.'))===0;
          if(!porOS[os]) porOS[os]=[];
          porOS[os].push({material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]});
          if(isPend){ if(!porOSPend[os]) porOSPend[os]=[]; porOSPend[os].push({material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]}); totalPend++; }
          total++;
        }
        const res={porOS,porOSPend,total,totalPend};
        cacheMat={dados:res,hora:Date.now()}; return res;
      }
    }catch(e){}
  }
  return {porOS:{},porOSPend:{},total:0,totalPend:0};
}

async function lerPlanilha(){
  if(cache.dados && Date.now()-cache.hora<120000) return cache.dados;
  try{
    const r=await axios.get('https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv',{responseType:'text',timeout:20000});
    const linhas=r.data.split(/\r?\n/).filter(l=>l.trim());
    const cabOriginal=linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const cabU=cabOriginal.map(h=>h.toUpperCase());
    let idxOS=cabU.indexOf('OS'); if(idxOS<0) idxOS=cabU.findIndex(h=>h.includes('ORDEM'));
    let idxSetor=cabU.findIndex(h=>h.includes('SETOR'));
    let idxFam=cabU.findIndex(h=>h.includes('FAMILIA'));
    let idxGrupo=cabU.findIndex(h=>h.includes('GRUPO'));
    const mapaOrdens={}, mapaMina={}, mapaUsina={}, porSetor={}, porSetorMina={}, porSetorUsina={}, porFamilia={}, dadosFull=[];
    for(let i=1;i<linhas.length;i++){
      let line=linhas[i], cols=[], cur='', inQ=false;
      for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ;} else if(c==','&&!inQ){cols.push(cur);cur='';} else cur+=c; }
      cols.push(cur);
      const get=(idx)=> idx>=0?(cols[idx]||'').replace(/^"|"$/g,'').trim():'';
      const os=get(idxOS).replace(/\D/g,''); if(!os) continue;
      const setor=(get(idxSetor)||'SEM').toUpperCase(); const fam=(get(idxFam)||'SEM').toUpperCase(); const grupo=(get(idxGrupo)||'').toUpperCase();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; else if(grupo.startsWith('U')) macro='USINA';
      const row={}; cabOriginal.forEach((n,idx)=>{row[n]=get(idx);}); row['_MACRO']=macro;
      dadosFull.push({_os:os,_setor:setor,_familia:fam,_macro:macro,_row:row,_busca:line.toLowerCase()});
      if(!mapaOrdens[os]){ mapaOrdens[os]=1; porSetor[setor]=(porSetor[setor]||0)+1; porFamilia[fam]=(porFamilia[fam]||0)+1; }
      if(macro==='MINA' &&!mapaMina[os]){ mapaMina[os]=1; porSetorMina[setor]=(porSetorMina[setor]||0)+1; }
      if(macro==='USINA' &&!mapaUsina[os]){ mapaUsina[os]=1; porSetorUsina[setor]=(porSetorUsina[setor]||0)+1; }
    }
    const result={totalOrdens:Object.keys(mapaOrdens).length,totalMina:Object.keys(mapaMina).length,totalUsina:Object.keys(mapaUsina).length,porMacro:{MINA:Object.keys(mapaMina).length,USINA:Object.keys(mapaUsina).length},porSetor, porSetorMina, porSetorUsina, porFamilia, dadosFull};
    cache={dados:result,hora:Date.now()}; return result;
  }catch(e){ return cache.dados; }
}

app.get('/',(req,res)=>res.send('OK V13.2 '+new Date().toISOString()+' <a href="/dashboard">Dashboard</a>'));
app.get('/ping',(req,res)=>res.send('pong'));
app.get('/api/resumo', async (req,res)=>{ const d=await lerPlanilha(); const m=await lerMateriais(); res.json({d,m}); });

app.get('/dashboard', async (req,res)=>{
  res.send(`
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}
.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.big{font-size:26px;font-weight:800}
.label{opacity:.7;font-size:12px}
@media(max-width:800px){.grid,.kpis{grid-template-columns:1fr}}
</style></head><body>
<h2>ZROF Dashboard V13.2</h2>
<div class="kpis">
<div class="card"><div class="label">Total de ordens</div><div class="big" id="tOrd">-</div></div>
<div class="card"><div class="label">Ordens Mina</div><div class="big" id="tMina">-</div></div>
<div class="card"><div class="label">Ordens Usina</div><div class="big" id="tUsina">-</div></div>
<div class="card"><div class="label">Materiais pendentes</div><div class="big" id="tPend">-</div></div>
</div>
<div class="grid">
<div class="card"><h3>Macro Mina x Usina</h3><canvas id="cMacro"></canvas></div>
<div class="card"><h3>Setor Geral</h3><canvas id="cSetor"></canvas></div>
</div>
<div class="grid">
<div class="card"><h3>Setor MINA</h3><canvas id="cSetorMina"></canvas></div>
<div class="card"><h3>Setor USINA</h3><canvas id="cSetorUsina"></canvas></div>
</div>
<div class="card"><h3>Familia Top</h3><canvas id="cFam"></canvas></div>
<script>
async function load(){
  const r = await fetch('/api/resumo');
  const j = await r.json();
  const d = j.d;
  const m = j.m;
  document.getElementById('tOrd').innerText = d.totalOrdens;
  document.getElementById('tMina').innerText = d.totalMina;
  document.getElementById('tUsina').innerText = d.totalUsina;
  document.getElementById('tPend').innerText = m.totalPend + '/' + m.total;
  function sortE(o){ return Object.entries(o||{}).sort((a,b)=>b[1]-a[1]); }
  new Chart(document.getElementById('cMacro'),{type:'doughnut',data:{labels:Object.keys(d.porMacro),datasets:[{data:Object.values(d.porMacro),backgroundColor:['#38bdf8','#fbbf24']}]}});
  function makeBar(id,obj,color){
    const e = sortE(obj).slice(0,12);
    new Chart(document.getElementById(id),{type:'bar',data:{labels:e.map(x=>x[0]),datasets:[{data:e.map(x=>x[1]),backgroundColor:color}]},options:{indexAxis:'y'}});
  }
  makeBar('cSetor', d.porSetor, '#a78bfa');
  makeBar('cSetorMina', d.porSetorMina, '#38bdf8');
  makeBar('cSetorUsina', d.porSetorUsina, '#fbbf24');
  makeBar('cFam', d.porFamilia, '#34d399');
}
load();
</script>
</body></html>
`);
});

app.listen(PORT, function(){ console.log('WEB ON '+PORT); });

let bot=null;
if(BOT_TOKEN && Telegraf){
  bot=new Telegraf(BOT_TOKEN);
  const menu=Markup.keyboard([['Buscar OS','Materiais OS'],['Resumo','Dashboard'],['Limpar']]).resize();
  bot.catch((err,ctx)=>{ console.log('BOT ERRO',err.message); });
  bot.start((ctx)=>ctx.reply('ZROF V13.2 Online',menu));
  bot.hears('Resumo', async (ctx)=>{
    try{
      const d=await lerPlanilha(); const mm=await lerMateriais();
      const agora = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
      const retirados = mm.total - mm.totalPend;
      const percMina = d.totalOrdens? Math.round(d.totalMina/d.totalOrdens*100) : 0;
      const percUsina = d.totalOrdens? Math.round(d.totalUsina/d.totalOrdens*100) : 0;
      const percRet = mm.total? Math.round(retirados/mm.total*100) : 0;
      let txt='📊 RESUMO ZROF\n🕒 '+agora+'\n━━━━━━━━━━━━━━━━━━━━\n\n📋 ORDENS\nTotal de ordens: '+d.totalOrdens+'\nOrdens Mina: '+d.totalMina+' ('+percMina+'%)\nOrdens Usina: '+d.totalUsina+' ('+percUsina+'%)\n\n📦 MATERIAIS BD_MAT\nMateriais pendentes: '+mm.totalPend+'/'+mm.total+'\nMateriais retirados: '+retirados+'/'+mm.total+' ('+percRet+'% concluido)\n\n🔗 Dashboard: https://'+(process.env.RENDER_EXTERNAL_HOSTNAME||'seu-app')+'/dashboard';
      await ctx.reply(txt, menu);
    }catch(e){ ctx.reply('Erro '+e.message, menu); }
  });
  bot.hears('Dashboard', async (ctx)=>{ const dom=process.env.RENDER_EXTERNAL_HOSTNAME; const url=dom?'https://'+dom+'/dashboard':'/dashboard'; ctx.reply('Dashboard: '+url,menu); });
  bot.hears('Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; await ctx.reply('♻️ Limpando...',menu); const d=await lerPlanilha(); const mm=await lerMateriais(); ctx.reply('✅ Pronto!\nTotal de ordens: '+d.totalOrdens+'\nOrdens Mina: '+d.totalMina+'\nOrdens Usina: '+d.totalUsina+'\nMateriais pendentes: '+mm.totalPend+'/'+mm.total,menu); });
  bot.hears('Buscar OS',(ctx)=>{ estado[ctx.from.id]='BUSCA'; ctx.reply('🔎 Digite OS:',menu); });
  bot.hears('Materiais OS',(ctx)=>{ estado[ctx.from.id]='MAT'; ctx.reply('📦 Digite OS pendentes ex 25291524:',menu); });
  bot.on('text', async (ctx)=>{
    try{
      const t=ctx.message.text.trim(); if(['Buscar OS','Materiais OS','Resumo','Dashboard','Limpar'].includes(t)||t.startsWith('/')) return;
      const d=await lerPlanilha(); const m=await lerMateriais();
      if(estado[ctx.from.id]==='MAT'){
        estado[ctx.from.id]=null;
        const os=t.replace(/\D/g,''); const todos=m.porOS[os]