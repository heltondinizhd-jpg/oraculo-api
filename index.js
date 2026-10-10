const express = require('express');
const axios = require('axios');
let Telegraf, Markup;
try { const t=require('telegraf'); Telegraf=t.Telegraf; Markup=t.Markup; } catch(e){ console.log('telegraf falta'); }
const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = '/telegraf/'+BOT_TOKEN;
const CANAL_ID = -1004373039044; // Solicitações ZROFS
const app = express();
app.use(express.json());
let cache={dados:null,hora:0};
let cacheMat={dados:null,hora:0};
let estado={};
let solTemp={};

async function enviarParaCanal(dados){
  try{
    const txt = `🚨 *NOVA SOLICITAÇÃO*\n\n*OS:* ${dados.os}\n*Setor:* ${dados.setor}\n*Prioridade:* ${dados.prioridade}\n*Problema:* ${dados.problema}\n\n👤 Solicitante: ${dados.nome}\n🕒 ${dados.data}`;
    await bot.telegram.sendMessage(CANAL_ID, txt, {parse_mode:'Markdown'});
    console.log('Enviado canal OS', dados.os);
  }catch(e){ console.log('Erro canal:', e.message); }
}

async function lerMateriais(){
  if(cacheMat.dados && Date.now()-cacheMat.hora<120000) return cacheMat.dados;
  try{
    const r=await axios.get('https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv&sheet=BD_MAT',{responseType:'text',timeout:20000});
    if(r.data.includes('<html')) throw new Error('html');
    const linhas=r.data.split(/\r?\n/).filter(function(l){return l.trim();});
    const porOS={}, porOSPend={}; let total=0, totalPend=0;
    for(let i=1;i<linhas.length;i++){
      let line=linhas[i], cols=[], cur='', inQ=false;
      for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ;} else if(c==','&&!inQ){cols.push(cur);cur='';} else cur+=c; }
      cols.push(cur);
      const cl=cols.map(function(s){return s.replace(/^"|"$/g,'').trim();});
      const os=(cl[0]||'').replace(/\D/g,''); if(!os) continue;
      const nec=parseFloat((cl[5]||'0').replace(',','.'))||0;
      const ret=parseFloat((cl[6]||'0').replace(',','.'))||0;
      const isPend=!cl[6] || cl[6]==='0' || ret < nec || ret===0;
      if(!porOS[os]) porOS[os]=[];
      porOS[os].push({txtOrdem:cl[1],item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]});
      if(isPend){ if(!porOSPend[os]) porOSPend[os]=[]; porOSPend[os].push({txtOrdem:cl[1],item:cl[2],material:cl[3],txt:cl[4],nec:cl[5],ret:cl[6],po:cl[7]}); totalPend++; }
      total++;
    }
    const res={porOS:porOS,porOSPend:porOSPend,total:total,totalPend:totalPend};
    cacheMat={dados:res,hora:Date.now()}; return res;
  }catch(e){ console.log('BD_MAT erro',e.message); return {porOS:{},porOSPend:{},total:0,totalPend:0}; }
}

async function lerPlanilha(){
  if(cache.dados && Date.now()-cache.hora<120000) return cache.dados;