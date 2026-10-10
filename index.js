const express = require('express');
const axios = require('axios');
let Telegraf, Markup;
try{ const t=require('telegraf'); Telegraf=t.Telegraf; Markup=t.Markup; }catch(e){ console.log('telegraf falta'); }

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
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=2'
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
          porOS[os].push({txtOrdem:cl[1],item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]});
          if(isPend){ if(!porOSPend[os]) porOSPend[os]=[]; porOSPend[os].push({txtOrdem:cl[1],item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]}); totalPend++; }
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
      const setor=(get(idxSetor)||'SEM').toUpperCase().trim();
      const fam=(get(idxFam)||'SEM').toUpperCase().trim();
      const grupo=(get(idxGrupo)||'').toUpperCase().trim();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; else if(grupo.startsWith('U')) macro='USINA';
      const row={}; cabOriginal.forEach((n,idx)=>{row[n]=get(idx);}); row['_MACRO']=macro;
      dadosFull.push({_os:os,_setor:setor,_familia:fam,_grupo:grupo,_macro:macro,_row:row,_busca:line.toLowerCase()});
      if(!mapaOrdens[os]){ mapaOrdens[os]=1; porSetor[setor]=(porSetor[setor]||0)+1; porFamilia[fam]=(porFamilia[fam]||0)+1; }
      if(macro==='MINA' &&!mapaMina[os]){ mapaMina[os]=1; porSetorMina[setor]=(porSetorMina[setor]||0)+1; }
      if(macro==='USINA' &&!mapaUsina[os]){ mapaUsina[os]=1; porSetorUsina[setor]=(porSetorUsina[setor]||0)+1; }
    }
    const result={totalOrdens:Object.keys(mapaOrdens).length,totalMina:Object.keys(mapaMina).length,totalUsina:Object.keys(mapaUsina).length,porMacro:{MINA:Object.keys(mapaMina).length,USINA:Object.keys(mapaUsina).length},porSetor, porSetorMina, porSetorUsina, porFamilia, dadosFull};
    cache={dados:result,hora:Date.now()}; return result;
  }catch(e){ return cache.dados; }
}

app.get('/',(req,res)=>res.send('OK V13.6.2 <a href="/dashboard">Dashboard</a> <a href="/api/resumo">API</a> <a href="/api/check">CHECK</a>'));
app.get('/ping',(req,res)=>res.send('pong '+Date.now()));
app.get('/api/resumo', async (req,res)=>{ const d=await lerPlanilha(); const m=await lerMateriais(); res.json({d,m}); });
app.get('/api/check', async (req,res)=>{
  try{
    const d=await lerPlanilha();
    const sumSetor=Object.values(d.porSetor).reduce((a,b)=>a+b,0);
    const sumMina=Object.values(d.porSetorMina).reduce((a,b)=>a+b,0);
    const sumUsina=Object.values(d.porSetorUsina).reduce((a,b)=>a+b,0);
    res.json({totalOrdens:d.totalOrdens,somaSetor:sumSetor,totalMina:d.totalMina,somaSetorMina:sumMina,totalUsina:d.totalUsina,somaSetorUsina:sumUsina,porMacro:d.porMacro,ok:sumSetor===d.totalOrdens,porSetor:d.porSetor,porSetorMina:d.porSetorMina,porSetorUsina:d.porSetorUsina});
  }catch(e){ res.json({erro:e.message}); }
});
app.get('/dashboard', async (req,res)=>{
  try{
    const d=await lerPlanilha(); const m=await lerMateriais();
    const dd=d||{totalOrdens:0,totalMina:0,totalUsina:0,porMacro:{MINA:0,USINA:0},porSetor:{},porSetorMina:{},porSetorUsina:{},porFamilia:{}}; const mm=m||{total:0,totalPend:0};
    let html=''; html+='<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'; html+='<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'; html+='<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.big{font-size:22px;font-weight:800}.label{opacity:.7;font-size:12px}@media(max-width:700px){.grid,.kpis{grid-template-columns:1fr}}</style>'; html+='</head><body>'; html+='<h2>ZROF Dashboard V13.6.2</h2>'; html+='<div class="kpis">'; html+='<div class="card"><div class="label">Total Ordens</div><div class="big">'+dd.totalOrdens+'</div></div>'; html+='<div class="card"><div class="label">MINA</div><div class="big">'+dd.totalMina+'</div></div>'; html+='<div class="card"><div class="label">USINA</div><div class="big">'+dd.totalUsina+'</div></div>'; html+='<div class="card"><div class="label">Pendentes BD_MAT</div><div class="big">'+mm.totalPend+'/'+mm.total+'</div></div>'; html+='</div>'; html+='<div class="grid"><div class="card"><h3>Macro Mina x Usina</h3><canvas id="cMacro"></canvas></div><div class="card"><h3>Setor Geral</h3><canvas id="cSetor"></canvas></div></div>'; html+='<div class="grid"><div class="card"><h3>Setor MINA</h3><canvas id="cSetorMina"></canvas></div><div class="card"><h3>Setor USINA</h3><canvas id="cSetorUsina"></canvas></div></div>'; html+='<div class="card"><h3>Familia Top</h3><canvas id="cFam"></canvas></div>'; html+='<p><a href="/api/check" style="color:#38bdf8">Ver /api/check</a></p>'; html+='<script>'; html+='var d='+JSON.stringify(dd)+';'; html+='function sortE(o){return Object.entries(o||{}).sort(function(a,b){return b[1]-a[1]}) }'; html+='new Chart(document.getElementById("cMacro"),{type:"doughnut",data:{labels:Object.keys(d.porMacro),[STRIPPED]
    html+='function makeBar(id,obj,color){ var e=sortE(obj).slice(0,12); new Chart(document.getElementById(id),{type:"bar",data:{labels:e.map(function(x){return x[0]}),datasets:[{data:e.map(function(x){return x[1]}),backgroundColor:color}]},options:{indexAxis:"y"}})};'; html+='makeBar("cSetor",d.porSetor,"#a78bfa");'; html+='makeBar("cSetorMina",d.porSetorMina,"#38bdf8");'; html+='makeBar("cSetorUsina",d.porSetorUsina,"#fbbf24");'; html+='makeBar("cFam",d.porFamilia,"#34d399");'; html+='</script></body></html>'; res.send(html);
  }catch(e){ res.send('Erro dashboard '+e.message); }
});

let bot=null;
if(BOT_TOKEN && Telegraf){
  bot=new Telegraf(BOT_TOKEN);
  app.use(bot.webhookCallback(WEBHOOK_PATH));
}

app.listen(PORT,function(){
  console.log('WEB ON '+PORT+' V13.6.2');
  if(bot){
    const domain=process.env.RENDER_EXTERNAL_HOSTNAME;
    if(domain){
      const webhookUrl='https://'+domain+WEBHOOK_PATH;
      bot.telegram.setWebhook(webhookUrl).then(function(){ console.log('WEBHOOK SET '+webhookUrl); }).catch(function(e){ console.log('webhook erro '+e.message); });
    }else{
      bot.telegram.deleteWebhook({drop_pending_updates:true}).then(function(){ bot.launch().then(function(){ console.log('BOT ON polling'); }); });
    }
    setInterval(function(){ const url=process.env.RENDER_EXTERNAL_URL || (domain?'https://'+domain:''); if(url){ axios.get(url+'/ping').catch(function(){}); } }, 9*60*1000);
  }
});

if(bot){
  const menu=Markup.keyboard([['Buscar OS','Materiais OS'],['Resumo','Dashboard'],['Limpar']]).resize();
  bot.catch((err)=>console.log('BOT ERRO',err.message));
  bot.start((ctx)=>ctx.reply('ZROF V13.6.2 Online',menu));
  bot.hears('Resumo', async (ctx)=>{
    const d=await lerPlanilha(); const mm=await lerMateriais();
    const percMina = d.totalOrdens? Math.round(d.totalMina/d.totalOrdens*100) : 0;
    const percUsina = d.totalOrdens? Math.round(d.totalUsina/d.totalOrdens*100) : 0;
    const retirados = mm.total - mm.totalPend;
    const percRet = mm.total? Math.round(retirados/mm.total*100) : 0;
    let txt='';
    txt+='RESUMO ZROF\n';
    txt+='Total: '+d.totalOrdens+' Mina: '+d.totalMina+' ('+percMina+'%) Usina: '+d.totalUsina+' ('+percUsina+'%)\n';
    txt+='BD_MAT Pend: '+mm.totalPend+'/'+mm.total+' Retirados: '+retirados+' ('+percRet+'%)\n\n';
    txt+='SETOR GERAL:\n';
    Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(function(p){ txt+=p[0]+': '+p[1]+'\n'; });
    txt+='\nMINA:\n'; Object.entries(d.porSetorMina).sort((a,b)=>b[1]-a[1]).forEach(function(p){ txt+=p[0]+': '+p[1]+'\n'; });
    txt+='\nUSINA:\n'; Object.entries(d.porSetorUsina).sort((a,b)=>b[1]-a[1]).forEach(function(p){ txt+=p[0]+': '+p[1]+'\n'; });
    for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu);
  });
  bot.hears('Dashboard', async (ctx)=>{ const dom=process.env.RENDER_EXTERNAL_HOSTNAME; const url=dom?'https://'+dom+'/dashboard':'/dashboard'; ctx.reply('Dashboard: '+url+'\nCheck: https://'+dom+'/api/check',menu); });
  bot.hears('Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; await ctx.reply('Limpando...',menu); const d=await lerPlanilha(); const mm=await lerMateriais(); ctx.reply('Ordens:'+d.totalOrdens+' Pend:'+mm.totalPend,menu); });
  bot.hears('Buscar OS',(ctx)=>{ estado[ctx.from.id]='BUSCA'; ctx.reply('Digite OS ou texto:',menu); });
  bot.hears('Materiais OS',(ctx)=>{ estado[ctx.from.id]='MAT'; ctx.reply('Digite OS pendentes ex 25291524:',menu); });
  bot.on('text', async (ctx)=>{ const t=ctx.message.text.trim(); if(['Buscar OS','Materiais OS','Resumo','Dashboard','Limpar'].includes(t)||t.startsWith('/')) return; const d=await lerPlanilha(); const m=await lerMateriais(); if(estado[ctx.from.id]==='MAT'){ estado[ctx.from.id]=null; const os=t.replace(/\D/g,''); const todos=m.porOS[os]||[]; const pend=m.porOSPend[os]||[]; if(!todos.length) return ctx.reply('Nada BD_MAT para '+os,menu); if(!pend.length) return ctx.reply('OS '+os+' SEM PENDENCIAS! '+todos.length+' ja retirados.',menu); let txt='PENDENTES OS '+os+' ('+pend.length+' de '+todos.length+')\n\n'; pend.forEach(function(x,i){ txt+=(i+1)+') Mat:'+x.material+' '+x.txt+'\nNec:'+x.nec+' Ret:'+x.ret+' PO:'+x.po+'\n\n'; }); for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu); return; } const ach=d.dadosFull.filter(function(x){ return x._busca.includes(t.toLowerCase()); }); if(!ach.length) return ctx.reply('Nada para '+t,menu); for(const it of ach.slice(0,3)){ let det='OS:'+it._os+' Macro:'+it._macro+'\nSetor:'+it._setor+'\n'; for(const kv of Object.entries(it._row)){ if(kv[1]) det+=kv[0]+': '+kv[1]+'\n'; } const qTot=m.porOS[it._os]?.length||0; const qPend=m.porOSPend[it._os]?.length||0; det+='\nBD_MAT total '+qTot+' pend '+qPend; if(qPend>0) await ctx.reply(det.substring(0,3900), Markup.inlineKeyboard([[Markup.button.callback('Ver '+qPend+' pend','pend:'+it._os)]])); else await ctx.reply(det.substring(0,4000),menu); } });
  bot.action(/pend:(.+)/, async (ctx)=>{ await ctx.answerCbQuery(); const os=ctx.match[1]; const mm=await lerMateriais(); const pend=mm.porOSPend[os]||[]; const todos=mm.porOS[os]||[]; if(!pend.length) return ctx.reply('SEM PENDENCIAS',menu); let txt='PENDENTES OS '+os+' ('+pend.length+' de '+todos.length+')\n\n'; pend.forEach(function(x,i){ txt+=(i+1)+') '+x.material+' '+x.txt+'\nNec:'+x.nec+' Ret:'+x.ret+'\n\n'; }); for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu); });
}
process.on('unhandledRejection', function(r){ console.log('unhandled',r); });
process.on('uncaughtException', function(e){ console.log('uncaught',e.message); });