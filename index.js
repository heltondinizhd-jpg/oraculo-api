const express = require('express');
const axios = require('axios');
let Telegraf, Markup;
try{ const t=require('telegraf'); Telegraf=t.Telegraf; Markup=t.Markup; }catch(e){}

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;

console.log('INICIANDO TOKEN='+(BOT_TOKEN?'OK':'FALTANDO'));

const app = express();
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
          porOS[os].push({item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]});
          if(isPend){
            if(!porOSPend[os]) porOSPend[os]=[];
            porOSPend[os].push({item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]});
            totalPend++;
          }
          total++;
        }
        const res={porOS,porOSPend,total,totalPend};
        cacheMat={dados:res,hora:Date.now()};
        console.log('BD_MAT OK total='+total+' pend='+totalPend);
        return res;
      }
    }catch(e){}
  }
  return {porOS:{},porOSPend:{},total:0,totalPend:0};
}

async function lerPlanilha(){
  if(cache.dados && Date.now()-cache.hora<120000) return cache.dados;
  try{
    const r=await axios.get('https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv',{responseType:'text',timeout:15000});
    const linhas=r.data.split(/\r?\n/).filter(l=>l.trim());
    const cab=linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const cabU=cab.map(h=>h.toUpperCase());
    let idxOS=cabU.indexOf('OS'); if(idxOS<0) idxOS=cabU.findIndex(h=>h.includes('ORDEM'));
    let idxSetor=cabU.findIndex(h=>h.includes('SETOR'));
    let idxGrupo=cabU.findIndex(h=>h.includes('GRUPO'));
    const mapaOrdens={}, mapaMina={}, mapaUsina={}, dadosFull=[];
    for(let i=1;i<linhas.length;i++){
      let line=linhas[i], cols=[], cur='', inQ=false;
      for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ;} else if(c==','&&!inQ){cols.push(cur);cur='';} else cur+=c; }
      cols.push(cur);
      const get=(idx)=> idx>=0?(cols[idx]||'').replace(/^"|"$/g,'').trim():'';
      const os=get(idxOS).replace(/\D/g,''); if(!os) continue;
      const setor=(get(idxSetor)||'SEM').toUpperCase(); const grupo=(get(idxGrupo)||'').toUpperCase();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; else if(grupo.startsWith('U')) macro='USINA';
      const row={}; cab.forEach((n,idx)=>{row[n]=get(idx);}); row['_MACRO']=macro;
      dadosFull.push({_os:os,_setor:setor,_macro:macro,_row:row,_busca:line.toLowerCase()});
      if(!mapaOrdens[os]) mapaOrdens[os]=1; if(macro==='MINA') mapaMina[os]=1; if(macro==='USINA') mapaUsina[os]=1;
    }
    const result={totalOrdens:Object.keys(mapaOrdens).length,totalMina:Object.keys(mapaMina).length,totalUsina:Object.keys(mapaUsina).length,dadosFull};
    cache={dados:result,hora:Date.now()}; return result;
  }catch(e){ return cache.dados; }
}

app.get('/',(req,res)=>res.send('OK TOKEN='+(BOT_TOKEN?'OK':'FALTANDO')));
app.get('/api/resumo', async (req,res)=>{ res.json(await lerPlanilha()||{}); });
app.listen(PORT,()=>console.log('WEB ON '+PORT));

if(BOT_TOKEN && Telegraf){
  const bot=new Telegraf(BOT_TOKEN);
  const menu=Markup.keyboard([['Buscar OS','Materiais OS'],['Resumo','Limpar']]).resize();
  bot.start((ctx)=>ctx.reply('ZROF Online - So Pendentes',menu));
  bot.hears('Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; await ctx.reply('Limpando...',menu); const d=await lerPlanilha(); const m=await lerMateriais(); ctx.reply('Ordens:'+d.totalOrdens+' BD_MAT total:'+m.total+' pendentes:'+m.totalPend,menu); });
  bot.hears('Buscar OS',(ctx)=>ctx.reply('Digite a OS:',menu));
  bot.hears('Materiais OS',(ctx)=>{ estado[ctx.from.id]='MAT'; ctx.reply('Digite a OS (ex: 25291524):',menu); });
  bot.hears('Resumo', async (ctx)=>{ const d=await lerPlanilha(); ctx.reply('Total:'+d.totalOrdens+' Mina:'+d.totalMina+' Usina:'+d.totalUsina,menu); });
  bot.on('text', async (ctx)=>{
    const t=ctx.message.text.trim(); if(['Buscar OS','Materiais OS','Resumo','Limpar'].includes(t)||t.startsWith('/')) return;
    if(estado[ctx.from.id]==='MAT'){
      estado[ctx.from.id]=null;
      const os=t.replace(/\D/g,''); const m=await lerMateriais();
      const todos=m.porOS[os]||[]; const pend=m.porOSPend[os]||[];
      if(!todos.length) return ctx.reply('Nada na BD_MAT para '+os,menu);
      if(!pend.length) return ctx.reply('✅ OS '+os+' SEM PENDENCIAS! '+todos.length+' materiais ja retirados.',menu);
      let txt='⚠️ PENDENTES - OS '+os+' ('+pend.length+' pendente de '+todos.length+')\n\n';
      pend.forEach((x,i)=>{ txt+=(i+1)+') Mat:'+x.material+' '+x.txt+'\nItem:'+x.item+' Nec:'+x.nec+' Ret:'+x.ret+' PO:'+x.po+'\n\n'; });
      for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu); return;
    }
    const d=await lerPlanilha(); const ach=d.dadosFull.filter(a=>a._busca.includes(t.toLowerCase()));
    if(!ach.length) return ctx.reply('Nada para '+t,menu);
    for(const it of ach.slice(0,2)){
      const m=await lerMateriais(); const qPend=m.porOSPend[it._os]?.length||0; const qTot=m.porOS[it._os]?.length||0;
      let det='OS:'+it._os+' Macro:'+it._macro+' Total mats:'+qTot+' Pend:'+qPend+'\n';
      if(qPend>0) await ctx.reply(det,Markup.inlineKeyboard([[Markup.button.callback('Ver '+qPend+' pendentes','pend:'+it._os)]])); else await ctx.reply(det+'✅ SEM PENDENCIAS',menu);
    }
  });
  bot.action(/pend:(.+)/, async (ctx)=>{
    await ctx.answerCbQuery(); const os=ctx.match[1]; const m=await lerMateriais(); const pend=m.porOSPend[os]||[];
    if(!pend.length) return ctx.reply('✅ SEM PENDENCIAS',Markup.keyboard([['Buscar OS','Materiais OS'],['Resumo','Limpar']]).resize());
    let txt='⚠️ PENDENTES OS '+os+' ('+pend.length+')\n\n'; pend.forEach((x,i)=>{ txt+=(i+1)+') '+x.material+' '+x.txt+' Nec:'+x.nec+' Ret:'+x.ret+'\n\n'; });
    for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu);
  });
  bot.telegram.deleteWebhook({drop_pending_updates:true}).then(()=>bot.launch().then(()=>console.log('BOT ON'))).catch(()=>bot.launch().then(()=>console.log('BOT ON polling')));
}