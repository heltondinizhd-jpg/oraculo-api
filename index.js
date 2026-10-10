const express = require('express');
const axios = require('axios');
let Telegraf, Markup;
try { const t=require('telegraf'); Telegraf=t.Telegraf; Markup=t.Markup; } catch(e){ console.log('telegraf falta'); }
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
        const linhas=r.data.split(/\r?\n/).filter(function(l){return l.trim();});
        const porOS={}, porOSPend={}; let total=0, totalPend=0;
        for(let i=1;i<linhas.length;i++){
          let line=linhas[i], cols=[], cur='', inQ=false;
          for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ;} else if(c==','&&!inQ){cols.push(cur);cur='';} else cur+=c; }
          cols.push(cur);
          const cl=cols.map(function(s){return s.replace(/^"|"$/g,'').trim();});
          const os=(cl[0]||'').replace(/\D/g,''); if(!os) continue;
          const isPend =!cl[6] || cl[6]==='0' || parseFloat(cl[6].replace(',','.'))===0;
          if(!porOS[os]) porOS[os]=[];
          porOS[os].push({txtOrdem:cl[1],item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]});
          if(isPend){ if(!porOSPend[os]) porOSPend[os]=[]; porOSPend[os].push({txtOrdem:cl[1],item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]}); totalPend++; }
          total++;
        }
        const res={porOS:porOS,porOSPend:porOSPend,total:total,totalPend:totalPend};
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
    const linhas=r.data.split(/\r?\n/).filter(function(l){return l.trim();});
    const cabOriginal=linhas[0].split(',').map(function(s){return s.replace(/^"|"$/g,'').trim();});
    const cabU=cabOriginal.map(function(h){return h.toUpperCase();});
    let idxOS=cabU.indexOf('OS'); if(idxOS<0) idxOS=cabU.findIndex(function(h){return h.includes('ORDEM');});
    let idxSetor=cabU.findIndex(function(h){return h.includes('SETOR');});
    let idxFam=cabU.findIndex(function(h){return h.includes('FAMILIA');});
    let idxGrupo=cabU.findIndex(function(h){return h.includes('GRUPO');});
    const mapaOrdens={}, mapaMina={}, mapaUsina={}, porSetor={}, porSetorMina={}, porSetorUsina={}, porFamilia={}, dadosFull=[];
    for(let i=1;i<linhas.length;i++){
      let line=linhas[i], cols=[], cur='', inQ=false;
      for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ;} else if(c==','&&!inQ){cols.push(cur);cur='';} else cur+=c; }
      cols.push(cur);
      const get=function(idx){ return idx>=0?(cols[idx]||'').replace(/^"|"$/g,'').trim():''; };
      const os=get(idxOS).replace(/\D/g,''); if(!os) continue;
      const setor=(get(idxSetor)||'SEM').toUpperCase().trim();
      const fam=(get(idxFam)||'SEM').toUpperCase().trim();
      const grupo=(get(idxGrupo)||'').toUpperCase().trim();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; else if(grupo.startsWith('U')) macro='USINA';
      const row={}; cabOriginal.forEach(function(n,idx){row[n]=get(idx);}); row['_MACRO']=macro;
      dadosFull.push({_os:os,_setor:setor,_familia:fam,_grupo:grupo,_macro:macro,_row:row,_busca:line.toLowerCase()});
      if(!mapaOrdens[os]){ mapaOrdens[os]=1; porSetor[setor]=(porSetor[setor]||0)+1; porFamilia[fam]=(porFamilia[fam]||0)+1; }
      if(macro==='MINA' &&!mapaMina[os]){ mapaMina[os]=1; porSetorMina[setor]=(porSetorMina[setor]||0)+1; }
      if(macro==='USINA' &&!mapaUsina[os]){ mapaUsina[os]=1; porSetorUsina[setor]=(porSetorUsina[setor]||0)+1; }
    }
    const result={totalOrdens:Object.keys(mapaOrdens).length,totalMina:Object.keys(mapaMina).length,totalUsina:Object.keys(mapaUsina).length,porMacro:{MINA:Object.keys(mapaMina).length,USINA:Object.keys(mapaUsina).length},porSetor:porSetor, porSetorMina:porSetorMina, porSetorUsina:porSetorUsina, porFamilia:porFamilia, dadosFull:dadosFull};
    cache={dados:result,hora:Date.now()}; return result;
  }catch(e){ return cache.dados; }
}
app.get('/',function(req,res){ res.send('OK V13.6.1 ICONES <a href="/dashboard">Dashboard</a>'); });
app.get('/ping',function(req,res){ res.send('pong '+Date.now()); });
app.get('/api/resumo', async function(req,res){ const d=await lerPlanilha(); const m=await lerMateriais(); res.json({d:d,m:m}); });
app.get('/api/check', async function(req,res){
  try{
    const d=await lerPlanilha();
    function soma(obj){ let s=0; for(let k in obj){ s+=obj[k]; } return s; }
    res.json({totalOrdens:d.totalOrdens,somaSetor:soma(d.porSetor),