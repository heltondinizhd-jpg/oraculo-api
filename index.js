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
          porOS[os].push({txtOrdem:cl[1],item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]});
          if(isPend){ if(!porOSPend[os]) porOSPend[os]=[]; porOSPend[os].push({txtOrdem:cl[1],item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]}); totalPend++; }
          total++;
        }
        const res={porOS,porOSPend,total,totalPend};
        cacheMat={dados:res,hora:Date.now()};
        return res;
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
      dadosFull.push({_os:os,_setor:setor,_familia:fam,_grupo:grupo,_macro:macro,_row:row,_busca:line.toLowerCase()});
      if(!mapaOrdens[os]){ mapaOrdens[os]=1; porSetor[setor]=(porSetor[setor]||0)+1; porFamilia[fam]=(porFamilia[fam]||0)+1; }
      if(macro==='MINA' &&!mapaMina[os]){ mapaMina[os]=1; porSetorMina[setor]=(porSetorMina[setor]||0)+1; }
      if(macro==='USINA' &&!mapaUsina[os]){ mapaUsina[os]=1; porSetorUsina[setor]=(porSetorUsina[setor]||0)+1; }
    }
    const result={totalOrdens:Object.keys(mapaOrdens).length,totalMina:Object.keys(mapaMina).length,totalUsina:Object.keys(mapaUsina).length,porMacro:{MINA:Object.keys(mapaMina).length,USINA:Object.keys(mapaUsina).length},porSetor, porSetorMina, porSetorUsina, porFamilia, dadosFull};
    cache={dados:result,hora:Date.now()}; return result;
  }catch(e){ return cache.dados; }
}

app.get('/',(req,res)=>res.send('OK BOT '+new Date().toISOString()+' <a href="/dashboard">Dash</a>'));
app.get('/ping',(req,res)=>res.send('pong '+Date.now()));
app.get('/api/resumo', async (req,res)=>{ const d=await lerPlanilha(); const m=await lerMateriais(); res.json({d,m}); });

app.get('/dashboard', async (req,res)=>{
  try{
    const d=await lerPlanilha(); const m=await lerMateriais();
    const dd=d||{totalOrdens:0,totalMina:0,totalUsina:0,porMacro:{MINA:0,USINA:0},porSetor:{},porSetorMina:{},porSetorUsina:{},porFamilia:{}};
    const mm=m||{total:0,totalPend:0};
    let html='';
    html+='<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.big{font-size:22px;font-weight:800}.label{opacity:.7;font-size:12px}@media(max-width:700px){.grid,.kpis{grid-template-columns:1fr}}</style></head><body><h2>ZROF Dashboard V13</h2><div class="kpis"><div class="card"><div class="label">Total Ordens</div><div class="big">'+dd.totalOrdens+'</div></div><div class="card"><div class="label">MINA</div><div class="big">'+dd.totalMina+'</div></div><div class="card"><div class="label">USINA</div><div class="big">'+dd.totalUsina+'</div></div><div class="card"><div class="label">Pendentes</div><div class="big">'+mm.totalPend+'/'+mm.total+'</div></div></div>';
    html+='<div class="grid"><div class="card"><h3>Macro</h3><canvas id="cMacro"></canvas></div><div class="card"><h3>Setor Geral</h3><canvas id="cSetor"></canvas></div></div>';
    html+='<div class="grid"><div class="card"><h3>Setor MINA</h3><canvas id="cSetorMina"></canvas></div><div class="card"><h3>Setor USINA</h3><canvas id="cSetorUsina"></canvas></div></div><script>var d='+JSON.stringify(dd)+';function sortE(o){return Object.entries(o||{}).sort(function(a,b){return b[1]-a[1]})} new Chart(document.getElementById("cMacro"),{type:"doughnut",data:{labels:Object.keys(d.porMacro),[STRIPPED] function makeBar(id,obj,color){var e=sortE(obj).slice(0,12);new Chart(document.getElementById(id),{type:"bar",data:{labels:e.map(function(x){return x[0]}),datasets:[{data:e.map(function(x){return x[1]}),backgroundColor:color}]},options:{indexAxis:"y"}})}makeBar("cSetor",d.porSetor,"#a78bfa");makeBar("cSetorMina",d.porSetorMina,"#38bdf8");makeBar("cSetorUsina",d.porSetorUsina,"#fbbf24");</script></body></html>';
    res.send(html);
  }catch(e){ res.send('erro '+e.message); }
});

app.listen(PORT, function(){ console.log('WEB ON '+PORT); });

let bot=null;
if(BOT_TOKEN && Telegraf){
  bot=new Telegraf(BOT_TOKEN);
  const menu=Markup.keyboard([['Buscar OS','Materiais OS'],['Resumo','Dashboard'],['Limpar']]).resize();

  bot.catch((err,ctx)=>{ console.log('BOT ERRO',err.message); });

  bot.start((ctx)=>ctx.reply('ZROF Online V13 Anti-Sono',menu));
  bot.hears('Resumo', async (ctx)=>{ const d=await lerPlanilha(); const mm=await lerMateriais(); ctx.reply('Total:'+d.totalOrdens+' Mina:'+d.totalMina+' Usina:'+d.totalUsina+' Pend:'+mm.totalPend+'/'+mm.total,menu); });
  bot.hears('Dashboard', async (ctx)=>{ const dom=process.env.RENDER_EXTERNAL_HOSTNAME; const url=dom?'https://'+dom+'/dashboard':'/dashboard'; ctx.reply('Dashboard: '+url,menu); });
  bot.hears('Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; await ctx.reply('Limpando...',menu); const d=await lerPlanilha(); const mm=await lerMateriais(); ctx.reply('Ordens:'+d.totalOrdens+' Pend:'+mm.totalPend,menu); });
  bot.hears('Buscar OS',(ctx)=>{ estado[ctx.from.id]='BUSCA'; ctx.reply('Digite OS:',menu); });
  bot.hears('Materiais OS',(ctx)=>{ estado[ctx.from.id]='MAT'; ctx.reply('Digite OS pendentes ex 25291524:',menu); });
  bot.on('text', async (ctx)=>{
    try{
      const t=ctx.message.text.trim(); if(['Buscar OS','Materiais OS','Resumo','Dashboard','Limpar'].includes(t)||t.startsWith('/')) return;
      const d=await lerPlanilha(); const m=await lerMateriais();
      if(estado[ctx.from.id]==='MAT'){
        estado[ctx.from.id]=null;
        const os=t.replace(/\D/g,''); const todos=m.porOS[os]||[]; const pend=m.porOSPend[os]||[];
        if(!todos.length) return ctx.reply('Nada BD_MAT para '+os,menu);
        if(!pend.length) return ctx.reply('OS '+os+' SEM PENDENCIAS! '+todos.length+' ja retirados.',menu);
        let txt='PENDENTES OS '+os+' ('+pend.length+' de '+todos.length+')\n\n'; pend.forEach(function(x,i){ txt+=(i+1)+') Mat:'+x.material+' '+x.txt+'\nNec:'+x.nec+' Ret:'+x.ret+'\n\n'; });
        for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu); return;
      }
      const ach=d.dadosFull.filter(function(x){ return x._busca.includes(t.toLowerCase()); });
      if(!ach.length) return ctx.reply('Nada para '+t,menu);
      for(const it of ach.slice(0,3)){
        let det='OS:'+it._os+' Macro:'+it._macro+'\nSetor:'+it._setor+'\n';
        for(const kv of Object.entries(it._row)){ if(kv[1]) det+=kv[0]+': '+kv[1]+'\n'; }
        const qTot=m.porOS[it._os]?.length||0; const qPend=m.porOSPend[it._os]?.length||0;
        det+='\nBD_MAT total '+qTot+' pend '+qPend;
        if(qPend>0) await ctx.reply(det.substring(0,3900), Markup.inlineKeyboard([[Markup.button.callback('Ver '+qPend+' pend','pend:'+it._os)]]));
        else await ctx.reply(det.substring(0,4000),menu);
      }
    }catch(e){ console.log('on text erro',e.message); }
  });
  bot.action(/pend:(.+)/, async (ctx)=>{
    try{ await ctx.answerCbQuery(); const os=ctx.match[1]; const mm=await lerMateriais(); const pend=mm.porOSPend[os]||[]; let txt='PENDENTES OS '+os+' ('+pend.length+')\n\n'; pend.forEach(function(x,i){ txt+=(i+1)+') '+x.material+' '+x.txt+'\nNec:'+x.nec+' Ret:'+x.ret+'\n\n'; }); for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000)); }catch(e){}
  });

  // WEBHOOK MODE - nao dorme mais
  const domain=process.env.RENDER_EXTERNAL_HOSTNAME;
  if(domain){
    const webhookUrl='https://'+domain+WEBHOOK_PATH;
    app.use(bot.webhookCallback(WEBHOOK_PATH));
    bot.telegram.setWebhook(webhookUrl).then(function(){ console.log('WEBHOOK SET '+webhookUrl); }).catch(function(e){ console.log('webhook erro '+e.message); });
  }else{
    // fallback polling local
    bot.telegram.deleteWebhook({drop_pending_updates:true}).then(function(){ bot.launch().then(function(){ console.log('BOT ON polling'); }); });
  }

  // KeepAlive - acorda o Render a cada 9 min
  setInterval(function(){
    const url=process.env.RENDER_EXTERNAL_URL || (domain?'https://'+domain:'');
    if(url){ axios.get(url+'/ping').then(function(){ console.log('keepalive ping'); }).catch(function(){}); }
  }, 9*60*1000);
}

process.on('unhandledRejection', function(r){ console.log('unhandled',r); });
process.on('uncaughtException', function(e){ console.log('uncaught',e.message); });