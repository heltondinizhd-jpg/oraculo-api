const express = require('express');
const axios = require('axios');
let Telegraf, Markup;
try{ const t=require('telegraf'); Telegraf=t.Telegraf; Markup=t.Markup; }catch(e){ console.log('telegraf falta'); }

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = '/telegraf/'+BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID || '7649089144';

const app = express();
app.use(express.json());
let cache={dados:null,hora:0};
let cacheMat={dados:null,hora:0};
let estado={};
global.SOLICITACOES = global.SOLICITACOES || [];

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

// ROTAS PRIMEIRO
app.get('/',(req,res)=>res.send('OK V13.6.2 <a href="/dashboard">Dashboard</a> <a href="/api/resumo">API</a> <a href="/api/check">CHECK</a> <a href="/api/solicitacoes">SOLIC</a>'));
app.get('/ping',(req,res)=>res.send('pong '+Date.now()));
app.get('/api/resumo', async (req,res)=>{ const d=await lerPlanilha(); const m=await lerMateriais(); res.json({d,m}); });
app.get('/api/solicitacoes',(req,res)=>res.json(global.SOLICITACOES));
app.get('/api/check', async (req,res)=>{
  try{
    const d=await lerPlanilha();
    const sumSetor=Object.values(d.porSetor).reduce((a,b)=>a+b,0);
    const sumMina=Object.values(d.porSetorMina).reduce((a,b)=>a+b,0);
    const sumUsina=Object.values(d.porSetorUsina).reduce((a,b)=>a+b,0);
    res.json({totalOrdens:d.totalOrdens,somaSetor:sumSetor,totalMina:d.totalMina,somaSetorMina:sumMina,totalUsina:d.totalUsina,somaSetorUsina:sumUsina,porMacro:d.porMacro,ok:sumSetor===d.totalOrdens,porSetor:d.porSetor,porSetorMina:d.porSetorMina,porSetorUsina:d.porSetorUsina,solicitacoes:global.SOLICITACOES.length});
  }catch(e){ res.json({erro:e.message}); }
});
app.get('/dashboard', async (req,res)=>{
  try{
    const d=await lerPlanilha(); const m=await lerMateriais();
    const dd=d||{totalOrdens:0,totalMina:0,totalUsina:0,porMacro:{MINA:0,USINA:0},porSetor:{},porSetorMina:{},porSetorUsina:{},porFamilia:{}}; const mm=m||{total:0,totalPend:0};
    let html=''; html+='<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'; html+='<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'; html+='<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.big{font-size:22px;font-weight:800}.label{opacity:.7;font-size:12px}@media(max-width:700px){.grid,.kpis{grid-template-columns:1fr}}</style>'; html+='</head><body>'; html+='<h2>ZROF Dashboard V13.6.2 + Solicitações</h2>'; html+='<div class="kpis">'; html+='<div class="card"><div class="label">Total Ordens</div><div class="big">'+dd.totalOrdens+'</div></div>'; html+='<div class="card"><div class="label">MINA</div><div class="big">'+dd.totalMina+'</div></div>'; html+='<div class="card"><div class="label">USINA</div><div class="big">'+dd.totalUsina+'</div></div>'; html+='<div class="card"><div class="label">Pendentes BD_MAT / Solic</div><div class="big">'+mm.totalPend+'/'+mm.total+' ('+global.SOLICITACOES.length+')</div></div>'; html+='</div>'; html+='<div class="grid"><div class="card"><h3>Macro Mina x Usina</h3><canvas id="cMacro"></canvas></div><div class="card"><h3>Setor Geral</h3><canvas id="cSetor"></canvas></div></div>'; html+='<div class="grid"><div class="card"><h3>Setor MINA</h3><canvas id="cSetorMina"></canvas></div><div class="card"><h3>Setor USINA</h3><canvas id="cSetorUsina"></canvas></div></div>'; html+='<div class="card"><h3>Familia Top</h3><canvas id="cFam"></canvas></div>'; html+='<div class="card"><h3>Solicitações Recentes</h3><pre style="white-space:pre-wrap">'+JSON.stringify(global.SOLICITACOES.slice(0,20),null,2)+'</pre></div>'; html+='<p><a href="/api/check" style="color:#38bdf8">Ver /api/check</a></p>'; html+='<script>'; html+='var d='+JSON.stringify(dd)+';'; html+='function sortE(o){return Object.entries(o||{}).sort(function(a,b){return b[1]-a[1]}) }'; html+='new Chart(document.getElementById("cMacro"),{type:"doughnut",data:{labels:Object.keys(d.porMacro),datasets:[{data:Object.values(d.porMacro)}]}});'; html+='function makeBar(id,obj,color){ var e=sortE(obj).slice(0,12); new Chart(document.getElementById(id),{type:"bar",data:{labels:e.map(function(x){return x[0]}),datasets:[{data:e.map(function(x){return x[1]}),backgroundColor:color}]},options:{indexAxis:"y"}})};'; html+='makeBar("cSetor",d.porSetor,"#a78bfa");'; html+='makeBar("cSetorMina",d.porSetorMina,"#38bdf8");'; html+='makeBar("cSetorUsina",d.porSetorUsina,"#fbbf24");'; html+='makeBar("cFam",d.porFamilia,"#34d399");'; html+='</script></body></html>'; res.send(html);
  }catch(e){ res.send('Erro dashboard '+e.message); }
});

// BOT
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
  const menu=Markup.keyboard([['Buscar OS','Materiais OS'],['Resumo','Dashboard'],['📋 Minhas Solicitações','Limpar']]).resize();
  bot.catch((err)=>console.log('BOT ERRO',err.message));
  bot.start((ctx)=>ctx.reply('ZROF V13.6.2 Online + Solicitações',menu));
  bot.hears('Resumo', async (ctx)=>{ const d=await lerPlanilha(); const mm=await lerMateriais(); let txt='RESUMO\nTotal:'+d.totalOrdens+' Mina:'+d.totalMina+' Usina:'+d.totalUsina+'\nPend BD_MAT:'+mm.totalPend+'/'+mm.total+' Solic:'+global.SOLICITACOES.length+'\n\nSETOR GERAL:\n'; Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(function(p){ txt+=p[0]+': '+p[1]+'\n'; }); txt+='\nMINA:\n'; Object.entries(d.porSetorMina).sort((a,b)=>b[1]-a[1]).forEach(function(p){ txt+=p[0]+': '+p[1]+'\n'; }); txt+='\nUSINA:\n'; Object.entries(d.porSetorUsina).sort((a,b)=>b[1]-a[1]).forEach(function(p){ txt+=p[0]+': '+p[1]+'\n'; }); for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu); });
  bot.hears('Dashboard', async (ctx)=>{ const dom=process.env.RENDER_EXTERNAL_HOSTNAME; const url=dom?'https://'+dom+'/dashboard':'/dashboard'; ctx.reply('Dashboard: '+url+'\nCheck: https://'+dom+'/api/check',menu); });
  bot.hears('Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; await ctx.reply('Limpando...',menu); const d=await lerPlanilha(); const mm=await lerMateriais(); ctx.reply('Ordens:'+d.totalOrdens+' Pend:'+mm.totalPend,menu); });
  bot.hears('📋 Minhas Solicitações', async (ctx)=>{
    const minhas=global.SOLICITACOES.filter(s=>s.quemId===ctx.from.id);
    if(!minhas.length) return ctx.reply('Você não tem solicitações ainda.',menu);
    let txt='📋 Suas solicitações:\n\n'; minhas.slice(0,10).forEach(s=>{ txt+=`OS:${s.os} - ${s.status}\n"${s.texto}"\n${s.resposta?'✅ Resp: '+s.resposta:''}\n\n`; });
    return ctx.reply(txt,menu);
  });
  bot.hears('Buscar OS',(ctx)=>{ estado[ctx.from.id]='BUSCA'; ctx.reply('Digite OS ou texto:',menu); });
  bot.hears('Materiais OS',(ctx)=>{ estado[ctx.from.id]='MAT'; ctx.reply('Digite OS pendentes ex 25291524:',menu); });

  bot.command('solicitacoes', async (ctx)=>{
    if(String(ctx.from.id)!==String(OWNER_ID)) return ctx.reply('Apenas admin.');
    if(!global.SOLICITACOES.length) return ctx.reply('Fila vazia.');
    let txt='📋 FILA:\n\n'; global.SOLICITACOES.slice(0,15).forEach(s=>{ txt+=`ID:${s.id} OS:${s.os} ${s.quem}\n"${s.texto}"\nStatus:${s.status}\n/resp ${s.id} resposta\n\n`; });
    return ctx.reply(txt);
  });
  bot.command('resp', async (ctx)=>{
    if(String(ctx.from.id)!==String(OWNER_ID)) return;
    const p=ctx.message.text.split(' '); const id=p[1]; const resp=p.slice(2).join(' ');
    if(!id||!resp) return ctx.reply('Uso: /resp ID texto');
    const sol=global.SOLICITACOES.find(s=>String(s.id)===String(id));
    if(!sol) return ctx.reply('ID não achado');
    sol.status='respondida'; sol.resposta=resp;
    try{ await bot.telegram.sendMessage(sol.quemId, `✅ RESPOSTA OS ${sol.os}\nSeu pedido: "${sol.texto}"\nResposta: ${resp}`); ctx.reply('Enviado!'); }catch(e){ ctx.reply('Erro '+e.message); }
  });

  bot.on('text', async (ctx)=>{
    const t=ctx.message.text.trim();
    if(['Buscar OS','Materiais OS','Resumo','Dashboard','Limpar','📋 Minhas Solicitações'].includes(t)||t.startsWith('/')) return;

    if(estado[ctx.from.id] && String(estado[ctx.from.id]).startsWith('SOLICITA_')){
      const os=String(estado[ctx.from.id]).split('_')[1];
      const nova={id:Date.now(),os:os,quem:ctx.from.first_name+(ctx.from.username?' @'+ctx.from.username:''),quemId:ctx.from.id,texto:t,data:new Date().toLocaleString('pt-BR'),status:'aberta'};
      global.SOLICITACOES.unshift(nova); estado[ctx.from.id]=null;
      await ctx.reply(`✅ Solicitação OS ${os} enviada!\n"${t}"`,