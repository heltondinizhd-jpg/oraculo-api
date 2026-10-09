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
    for(let i=1;i<linhas.length;i