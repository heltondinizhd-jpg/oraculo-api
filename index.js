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
          const isPend =!cl[6] || cl[6]==='0' || parseFloat(cl[6].replace(',','.'))===0;
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

app.get('/',(req,res)=>res.send('OK V13.6.1 FIX <a href="/dashboard">Dashboard</a>'));
app.get('/ping',(req,res)=>res.send('pong'));
app.get('/api/resumo', async (req,res)=>{ const d=await lerPlanilha(); const m=await lerMateriais(); res.json({d,m}); });
app.get('/api/check', async (req,res)=>{
  const d=await lerPlanilha();
  res.json({totalOrdens:d.totalOrdens,porSetor:d.porSetor,ok:true});
});

app.get('/dashboard', async (req,res)=>{
  const d=await lerPlanilha(); const m=await lerMateriais();
  const dd=d||{totalOrdens:0,totalMina:0,totalUsina:0,porMacro:{MINA:0,USINA:0},porSetor:{},porSetorMina:{},porSetorUsina:{},porFamilia:{}};
  const mm=m||{total:0,totalPend:0};
  const html = `
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.big{font-size:22px;font-weight:800}</style>
  </head><body>
  <h2>ZROF Dashboard V13.6.1 FIX</h2>
  <div class="kpis">
    <div class="card"><div>Total Ordens</div><div class="big">${dd.totalOrdens}</div></div>
    <div class="card"><div>MINA</div><div class="big">${dd.totalMina}</div></div>
    <div class="card"><div>USINA</div><div class="big">${dd.totalUsina}</div></div>
    <div class="card"><div>Pend BD_MAT</div><div class="big">${mm.totalPend}/${mm.total}</div></div>
  </div>
  <div class="grid"><div class="card"><h3>Macro</h3><canvas id="cMacro"></canvas></div><div class="card"><h3>Setor Geral</h3><canvas id="cSetor"></canvas></div></div>
  <script>
    var d=${JSON.stringify(dd)};
    new Chart(document.getElementById('cMacro'),{type:'doughnut',data:{labels:Object.keys(d.porMacro),datasets:[{data:Object.values(d.porMacro)}]}});
    function bar(id,obj){var e=Object.entries(obj||{}).sort((a,b)=>b[1]-a[1]).slice(0,10); new Chart(document.getElementById(id),{type:'bar',data:{labels:e.map(x=>x[0]),datasets:[{data:e.map(x=>x[1])}]},options:{indexAxis:'y'}})}
    bar('cSetor',d.porSetor);
  </script>
  </body></html>`;
  res.send(html);
});

let bot=null;
if(BOT_TOKEN && Telegraf){
  bot=new Telegraf(BOT_TOKEN);
  app.use(bot.webhookCallback(WEBHOOK_PATH));
}

app.listen(PORT,()=>{
  console.log('WEB ON '+PORT+' V13.6.1 FIX');
  if(bot){
    const domain=process.env.RENDER_EXTERNAL_HOSTNAME;
    if(domain){
      bot.telegram.setWebhook('https://'+domain+WEBHOOK_PATH).then(()=>console.log('WEBHOOK OK'));
    }else{
      bot.telegram.deleteWebhook({drop_pending_updates:true}).then(()=>bot.launch());
    }
  }
});

if(bot){
  const menu=Markup.keyboard([['Buscar OS','Materiais OS'],['Resumo','Dashboard'],['Limpar']]).resize();
  bot.start((ctx)=>ctx.reply('ZROF V13.6.1 FIX Online',menu));
  bot.hears('Resumo', async (ctx)=>{ const d=await lerPlanilha(); const mm=await lerMateriais(); ctx.reply('Total:'+d.totalOrdens+' Pend:'+mm.totalPend,menu); });
  bot.hears('Dashboard', async (ctx)=>{ const dom=process.env.RENDER_EXTERNAL_HOSTNAME; ctx.reply('https://'+dom+'/dashboard',menu); });
  bot.hears('Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; ctx.reply('Limpo',menu); });
  bot.hears('Buscar OS',(ctx)=>{ estado[ctx.from.id]='BUSCA'; ctx.reply('Digite OS:',menu); });
  bot.hears('Materiais OS',(ctx)=>{ estado[ctx.from.id]='MAT'; ctx.reply('Digite OS:',menu); });
  bot.on('text', async (ctx)=>{
    const t=ctx.message.text.trim(); if(['Buscar OS','Materiais OS','Resumo','Dashboard','Limpar'].includes(t)) return;
    const d=await lerPlanilha(); const m=await lerMateriais();
    if(estado[ctx.from.id]==='MAT'){
      estado[ctx.from.id]=null; const os=t.replace(/\D/g,''); const pend=m.porOSPend[os]||[];
      if(!pend.length) return ctx.reply('SEM PENDENCIAS OS '+os,menu);
      let txt='PEND OS '+os+'\n'; pend.slice(0,10).forEach(x=>{ txt+=x.material+' '+x.txt+'\n'; });
      return ctx.reply(txt,menu);
    }
    const ach=d.dadosFull.filter(x=>x._busca.includes(t.toLowerCase()));
    if(!ach.length) return ctx.reply('Nada',menu);
    const it=ach[0]; let det='OS:'+it._os+' Setor:'+it._setor+'\n'; for(const kv of Object.entries(it._row)){ if(kv[1]) det+=kv[0]+':'+kv[1]+'\n'; }
    const qPend=m.porOSPend[it._os]?.length||0;
    if(qPend>0) await ctx.reply(det.substring(0,3500), Markup.inlineKeyboard([[Markup.button.callback('Ver pend','pend:'+it._os)]]));
    else await ctx.reply(det.substring(0,3500),menu);
  });
  bot.action(/pend:(.+)/, async (ctx)=>{ await ctx.answerCbQuery(); const os=ctx.match[1]; const mm=await lerMateriais(); const pend=mm.porOSPend[os]||[]; let txt='PEND OS '+os+'\n'; pend.slice(0,15).forEach(x=>{ txt+=x.material+' '+x.txt+'\n'; }); await ctx.reply(txt.substring(0,4000)); });
}