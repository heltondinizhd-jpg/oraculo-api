const express = require('express');
const axios = require('axios');
let Telegraf, Markup;
try{ const tel = require('telegraf'); Telegraf=tel.Telegraf; Markup=tel.Markup; }catch(e){ console.log('telegraf nao instalado'); }

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;

console.log('INICIANDO... TOKEN='+(BOT_TOKEN?'OK':'FALTANDO'));

const app = express();
let cache={dados:null,hora:0};
let cacheMat={dados:null,hora:0};
let estadoUsuario={};

async function lerMateriais(){
  if(cacheMat.dados && Date.now()-cacheMat.hora<120000) return cacheMat.dados;
  const tentativas=[
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv&sheet=BD_MAT',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=2',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=3',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1957311427'
  ];
  for(let url of tentativas){
    try{
      console.log('TESTANDO: '+url);
      const r=await axios.get(url,{responseType:'text',timeout:15000});
      if(r.data.includes('<html')) continue;
      const cab=r.data.split('\n')[0].toUpperCase();
      console.log('CAB: '+cab.substring(0,120));
      if(cab.includes('SETOR') && cab.includes('GRUPO')){ console.log('-> DB_ORDENS, pula'); continue; }
      if(cab.includes('MATERIAL') || cab.includes('QTD')){
        console.log('-> ACHOU BD_MAT!');
        const linhas=r.data.split(/\r?\n/).filter(l=>l.trim());
        const porOS={}; let total=0;
        for(let i=1;i<linhas.length;i++){
          let line=linhas[i], cols=[], cur='', inQ=false;
          for(let j=0;j<line.length;j++){
            let c=line[j];
            if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ; }
            else if(c==',' &&!inQ){ cols.push(cur); cur=''; } else cur+=c;
          }
          cols.push(cur);
          const clean=cols.map(s=>s.replace(/^"|"$/g,'').trim());
          const os=(clean[0]||'').replace(/\D/g,''); if(!os) continue;
          if(!porOS[os]) porOS[os]=[];
          porOS[os].push({item:clean[2]||'', material:clean[3]||'', txtMat:clean[4]||'', qtdNec:clean[5]||'', qtdRet:clean[6]||'', po:clean[7]||''});
          total++;
        }
        const res={porOS,total}; cacheMat={dados:res,hora:Date.now()}; console.log('BD_MAT TOTAL='+total); return res;
      }
    }catch(e){ console.log('ERRO '+url+' '+e.message); }
  }
  return {porOS:{},total:0};
}

async function lerPlanilha(){
  if(cache.dados && Date.now()-cache.hora<120000) return cache.dados;
  try{
    const r=await axios.get('https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv',{responseType:'text',timeout:15000});
    const linhas=r.data.split(/\r?\n/).filter(l=>l.trim());
    const cabOriginal=linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const cabUpper=cabOriginal.map(h=>h.toUpperCase());
    let idxOS=cabUpper.indexOf('OS'); if(idxOS==-1) idxOS=cabUpper.findIndex(h=>h.includes('ORDEM'));
    let idxSetor=cabUpper.findIndex(h=>h.includes('SETOR'));
    let idxFam=cabUpper.findIndex(h=>h.includes('FAMILIA'));
    let idxGrupo=cabUpper.findIndex(h=>h.includes('GRUPO'));
    const mapaOrdens={}, mapaMina={}, mapaUsina={}, dadosFull=[];
    for(let i=1;i<linhas.length;i++){
      let line=linhas[i], cols=[], cur='', inQ=false;
      for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ; } else if(c==','&&!inQ){ cols.push(cur); cur=''; } else cur+=c; }
      cols.push(cur);
      const get=(idx)=> idx>=0? (cols[idx]||'').replace(/^"|"$/g,'').trim() : '';
      const os=get(idxOS).replace(/\D/g,''); if(!os) continue;
      const setor=(get(idxSetor)||'SEM').toUpperCase(); const fam=(get(idxFam)||'SEM').toUpperCase(); const grupo=(get(idxGrupo)||'').toUpperCase();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; else if(grupo.startsWith('U')) macro='USINA';
      const row={}; cabOriginal.forEach((n,idx)=>{ row[n]=get(idx); }); row['_MACRO']=macro;
      dadosFull.push({_os:os,_setor:setor,_familia:fam,_grupo:grupo,_macro:macro,_row:row,_busca:line.toLowerCase()});
      if(!mapaOrdens[os]) mapaOrdens[os]={setor,familia:fam,macro};
      if(macro==='MINA') mapaMina[os]=1; if(macro==='USINA') mapaUsina[os]=1;
    }
    const result={totalOrdens:Object.keys(mapaOrdens).length,totalMina:Object.keys(mapaMina).length,totalUsina:Object.keys(mapaUsina).length,porMacro:{MINA:Object.keys(mapaMina).length,USINA:Object.keys(mapaUsina).length},porSetor:{},porSetorMina:{},porSetorUsina:{},porFamilia:{},dadosFull};
    cache={dados:result,hora:Date.now()}; return result;
  }catch(e){ console.log('ERRO lerPlanilha '+e.message); return cache.dados; }
}

app.get('/',(req,res)=>res.send('OK '+(BOT_TOKEN?'TOKEN OK':'SEM TOKEN')+' <a href="/dashboard">dash</a>'));
app.get('/api/resumo', async (req,res)=>{ res.json(await lerPlanilha()||{}); });
app.get('/api/materiais/:os', async (req,res)=>{ const m=await lerMateriais(); res.json(m.porOS[req.params.os]||[]); });
app.get('/dashboard',(req,res)=>{ res.send('<h1>ZROF OK</h1><p>TOKEN: '+(BOT_TOKEN?'OK':'FALTANDO')+'</p><a href="/api/resumo">resumo</a>'); });

app.listen(PORT,()=>console.log('WEB ON '+PORT));

if(BOT_TOKEN && Telegraf){
  const bot=new Telegraf(BOT_TOKEN);
  const menu=Markup.keyboard([['Buscar OS','Materiais OS'],['Resumo','Dashboard'],['Limpar']]).resize();
  bot.start((ctx)=>ctx.reply('ZROF Online',menu));
  bot.hears('Resumo', async (ctx)=>{ const d=await lerPlanilha(); ctx.reply('Total:'+d.totalOrdens+' Mina:'+d.totalMina+' Usina:'+d.totalUsina,menu); });
  bot.hears('Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; await ctx.reply('Limpando...',menu); const d=await lerPlanilha(); const m=await lerMateriais(); ctx.reply('Ordens:'+d.totalOrdens+' Materiais:'+m.total,menu); });
  bot.hears('Buscar OS',(ctx)=>ctx.reply('Digite a OS:',menu));
  bot.hears('Materiais OS',(ctx)=>{ estadoUsuario[ctx.from.id]='MAT'; ctx.reply('Digite a OS (ex: 25291524):',menu); });
  bot.on('text', async (ctx)=>{
    const t=ctx.message.text.trim(); if(t.startsWith('/')||['Buscar OS','Materiais OS','Resumo','Dashboard','Limpar'].includes(t)) return;
    if(estadoUsuario[ctx.from.id]==='MAT'){
      estadoUsuario[ctx.from.id]=null;
      const os=t.replace(/\D/g,''); const m=await lerMateriais(); const lista=m.porOS[os];
      if(!lista) return ctx.reply('Nada na BD_MAT para '+os+' total:'+m.total,menu);
      let txt='BD_MAT OS '+os+' ('+lista.length+')\n\n'; lista.forEach((x,i)=>{ txt+=(i+1)+') '+x.material+' '+x.txtMat+' Nec:'+x.qtdNec+' Ret:'+x.qtdRet+' PO:'+x.po+'\n\n'; });
      for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu); return;
    }
    const d=await lerPlanilha(); if(!d) return; const ach=d.dadosFull.filter(a=>a._busca.includes(t.toLowerCase()));
    if(!ach.length) return ctx.reply('Nada',menu);
    for(const it of ach.slice(0,2)){
      let det='OS:'+it._os+' Macro:'+it._macro+'\n'; for(const [k,v] of Object.entries(it._row)) if(v) det+=k+': '+v+'\n';
      const m=await lerMateriais(); const q=m.porOS[it._os]?.length||0; if(q>0) await ctx.reply(det.substring(0,3800)+'\n'+q+' materiais',Markup.inlineKeyboard([[Markup.button.callback('Ver '+q+' mats','mat:'+it._os)]])); else await ctx.reply(det.substring(0,4000),menu);
    }
  });
  bot.action(/mat:(.+)/, async (ctx)=>{ await ctx.answerCbQuery(); const os=ctx.match[1]; const m=await lerMateriais(); const lista=m.porOS[os]; if(!lista) return ctx.reply('Sem',menu); let txt='OS '+os+' ('+lista.length+')\n\n'; lista.forEach((x,i)=>{ txt+=(i+1)+') '+x.material+' '+x.txtMat+'\n'; }); for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu); });
  bot.telegram.deleteWebhook({drop_pending_updates:true}).then(()=>{ bot.launch().then(()=>console.log('BOT ON')); }).catch(e=>console.log('webhook erro '+e.message));
} else {
  console.log('SEM TOKEN, so web');
}