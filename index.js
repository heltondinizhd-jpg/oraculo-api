const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if(!BOT_TOKEN) process.exit(1);
const bot=new Telegraf(BOT_TOKEN);
const app=express();
let cache=null;let cacheHora=0;
async function getCSV(gid){
 const url='https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid='+gid;
 const r=await axios.get(url,{responseType:'text',timeout:30000});
 return r.data;
}
function parseCSV(text){
 const l=text.split(/\r?\n/).filter(x=>x.trim()!=='');
 const cab=l[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
 const rows=[];
 for(let i=1;i<l.length;i++){
  let line=l[i];let cols=[];let cur='';let inQ=false;
  for(let j=0;j<line.length;j++){
   let c=line[j];
   if(c=='"'){if(line[j+1]=='"'){cur+='"';j++;}else inQ=!inQ;}
   else if(c==','&&!inQ){cols.push(cur);cur='';}else cur+=c;
  }
  cols.push(cur);rows.push(cols.map(v=>v.replace(/^"|"$/g,'').trim()));
 }
 return {cab,rows};
}
async function lerPlanilha(){
 if(cache&&Date.now()-cacheHora<120000) return cache;
 try{
  const csv1=await getCSV('0');let csv2=null;
  try{csv2=await getCSV('1');}catch(e){}
  const p1=parseCSV(csv1);
  const up1=p1.cab.map(h=>h.toUpperCase());
  let iOS=up1.indexOf('OS');if(iOS<0)iOS=up1.findIndex(h=>h.includes('ORDEM'));
  let iSet=up1.findIndex(h=>h.includes('SETOR'));
  let iFam=up1.findIndex(h=>h.includes('FAMILIA')||h.includes('FAM'));
  let iGru=up1.findIndex(h=>h.includes('GRUPO'));
  let dadosFull=[];let mapaGeral={};let mapaMina={};let mapaUsina={};
  p1.rows.forEach(cols=>{
   const os=(cols[iOS]||'').replace(/\D/g,'');if(!os)return;
   const setor=(cols[iSet]||'SEM').toUpperCase().trim();
   const fam=(cols[iFam]||'SEM').toUpperCase().trim();
   const grupo=(cols[iGru]||'').toUpperCase().trim();
   let macro='OUTROS';if(grupo.startsWith('M'))macro='MINA';if(grupo.startsWith('U'))macro='USINA';
   let row={};p1.cab.forEach((n,idx)=>{row[n]=cols[idx]||'';});
   dadosFull.push({os,setor,fam,grupo,macro,row,busca:cols.join(' ').toLowerCase(),pend:[]});
   if(!mapaGeral[os])mapaGeral[os]={setor,fam,macro};
   if(macro==='MINA')mapaMina[os]=mapaGeral[os];
   if(macro==='USINA')mapaUsina[os]=mapaGeral[os];
  });
  let pendPorOS={};let totPend=0;
  if(csv2){
   const p2=parseCSV(csv2);
   p2.rows.forEach(cols=>{
    if(cols.length<6)return;
    const os=(cols[0]||'').replace(/\D/g,'');if(!os)return;
    const qtdRaw=(cols[5]||'').trim();
    const clean=qtdRaw.replace(/\./g,'').replace(',','.');
    const num=parseFloat(clean);
    if(qtdRaw===''||qtdRaw==='0'||qtdRaw==='0,000'||num===0){
     if(!pendPorOS[os])pendPorOS[os]=[];
     pendPorOS[os].push({item:cols[1]||'',material:cols[2]||'',texto:cols[3]||'',qtdNec:cols[4]||'',qtdRet:qtdRaw,po:cols[6]||''});
     totPend++;
    }
   });
   dadosFull.forEach(d=>{if(pendPorOS[d.os])d.pend=pendPorOS[d.os];});
  }
  const count=(arr,key)=>{const o={};Object.values(arr).forEach(v=>{const k=v[key]||'SEM';o[k]=(o[k]||0)+1;});return o;};
  const res={total:Object.keys(mapaGeral).length,tMina:Object.keys(mapaMina).length,tUsina:Object.keys(mapaUsina).length,totPend,porSetor:count(mapaGeral,'setor'),porMacro:{MINA:Object.keys(mapaMina).length,USINA:Object.keys(mapaUsina).length},dadosFull};
  cache=res;cacheHora=Date.now();console.log('OK '+res.total+' pend '+res.totPend);return res;
 }catch(e){console.log('ERRO '+e.message);return cache;}
}
lerPlanilha();
const menu=Markup.keyboard([['Buscar OS','Resumo'],['Dashboard','Limpar']]).resize();
bot.start(ctx=>ctx.reply('ZROF Online',menu));
bot.hears('Resumo',ctx=>{ctx.message.text='/resumo';bot.handleUpdate({message:ctx.message});});
bot.hears('Limpar',async ctx=>{cache=null;await ctx.reply('Recarregando...',menu);const r=await lerPlanilha();ctx.reply('Total:'+r.total+' Pend:'+r.totPend,menu);});
bot.hears('Buscar OS',ctx=>ctx.reply('Digite a OS:',menu));
bot.hears('Dashboard',ctx=>{const d=process.env.RENDER_EXTERNAL_HOSTNAME;const url=d?'https://'+d+'/dashboard':'/dashboard';ctx.reply(url,menu);});
bot.command('resumo',async ctx=>{const d=await lerPlanilha();if(!d)return ctx.reply('Carregando...',menu);let t='RESUMO\nTotal:'+d.total+' Mina:'+d.tMina+' Usina:'+d.tUsina+' Pend:'+d.totPend+'\n';Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(kv=>{t+=kv[0]+':'+kv[1]+'\n';});ctx.reply(t,menu);});
bot.action(/pend:(.+)/,async ctx=>{await ctx.answerCbQuery();const os=ctx.match[1];const d=await lerPlanilha();const it=d.dadosFull.find(x=>x.os===os);if(!it)return;let txt='PENDENTES OS '+os+' ('+it.pend.length+')\n';it.pend.forEach((p,i)=>{txt+=(i+1)+') '+p.material+' '+p.texto+' Nec:'+p.qtdNec+' Ret:'+p.qtdRet+'\n';});for(let i=0;i<txt.length;i+=4000)await ctx.reply(txt.substring(i,i+4000),menu);});
bot.on('text',async ctx=>{
 const texto=ctx.message.text.trim();
 if(texto.startsWith('/')||['Buscar OS','Resumo','Dashboard','Limpar'].includes(texto))return;
 const d=await lerPlanilha();if(!d)return ctx.reply('Aguarde 10s',menu);
 const dig=texto.replace(/\D/g,'');const busca=texto.toLowerCase();
 const ach=d.dadosFull.filter(x=>x.busca.includes(busca)||(dig&&x.os.includes(dig)));
 if(!ach.length)return ctx.reply('Nada para '+texto,menu);
 for(const it of ach.slice(0,2)){
  let det='OS:'+it.os+' Setor:'+it.setor+' Macro:'+it.macro+'\n';
  for(const k in it.row){if(it.row[k])det+=k+':'+it.row[k]+'\n';}
  if(it.pend.length>0){det+='\nPEND:'+it.pend.length;await ctx.reply(det.substring(0,4000),Markup.inlineKeyboard([[Markup.button.callback('Ver '+it.pend.length+' Pend','pend:'+it.os)]]));}
  else await ctx.reply(det.substring(0,4000),menu);
 }
});
app.get('/',(req,res)=>res.send('OK'));
app.get('/api/resumo',async(req,res)=>{const d=await lerPlanilha();res.json(d?{total:d.total,pend:d.totPend}:{erro:'loading'});});
app.get('/dashboard',(req,res)=>{res.send('<h1>ZROF</h1><div id=t>loading</div><script>fetch("/api/resumo").then(r=>r.json()).then(d=>{document.getElementById("t").innerText="Total:"+d.total+" Pend:"+d.pend})</script>');});
app.listen(PORT,()=>console.log('WEB ON'));
(async()=>{try{await bot.telegram.deleteWebhook({drop_pending_updates:true});}catch(e){}bot.launch().then(()=>console.log('BOT ON'));})();