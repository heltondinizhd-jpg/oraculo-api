const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) { console.log('SEM BOT_TOKEN'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const app = express();
let cache = null;
let cacheHora = 0;

async function getCSV(gid){
  const url = 'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid='+gid;
  const r = await axios.get(url, {responseType:'text', timeout:30000});
  return r.data;
}

function parseCSV(text){
  const linhas = text.split(/\r?\n/).filter(l=>l.trim()!=='');
  if(!linhas.length) return {cab:[], rows:[]};
  const cab = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
  const rows = [];
  for(let i=1;i<linhas.length;i++){
    let line=linhas[i]; let cols=[]; let cur=''; let inQ=false;
    for(let j=0;j<line.length;j++){
      let c=line[j];
      if(c=='"'){ if(line[j+1]=='"'){cur+='"'; j++;} else inQ=!inQ; }
      else if(c==',' &&!inQ){ cols.push(cur); cur=''; }
      else cur+=c;
    }
    cols.push(cur);
    rows.push(cols.map(v=>v.replace(/^"|"$/g,'').trim()));
  }
  return {cab, rows};
}

async function lerPlanilha(){
  if(cache && Date.now()-cacheHora<120000) return cache;
  try{
    console.log('Lendo planilha...');
    const csv1 = await getCSV('0');
    let csv2 = null;
    try{ csv2 = await getCSV('1'); console.log('Aba 1 lida: '+csv2.length); }catch(e){ console.log('Erro aba 1: '+e.message); }
    if(!csv2){
      try{ csv2 = await getCSV('1088812947'); }catch(e){}
    }

    const p1 = parseCSV(csv1);
    const up1 = p1.cab.map(h=>h.toUpperCase());
    let iOS = up1.indexOf('OS'); if(iOS<0) iOS=up1.findIndex(h=>h.includes('ORDEM'));
    let iSet = up1.findIndex(h=>h.includes('SETOR'));
    let iFam = up1.findIndex(h=>h.includes('FAMILIA')||h.includes('FAM'));
    let iGru = up1.findIndex(h=>h.includes('GRUPO'));

    let dadosFull=[]; let mapaGeral={}; let mapaMina={}; let mapaUsina={};

    p1.rows.forEach(cols=>{
      const os=(cols[iOS]||'').replace(/\D/g,''); if(!os) return;
      const setor=(cols[iSet]||'SEM').toUpperCase().trim();
      const fam=(cols[iFam]||'SEM').toUpperCase().trim();
      const grupo=(cols[iGru]||'').toUpperCase().trim();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; if(grupo.startsWith('U')) macro='USINA';
      let rowObj={}; p1.cab.forEach((n,idx)=>{ rowObj[n]=cols[idx]||''; });
      dadosFull.push({os, setor, fam, grupo, macro, row:rowObj, busca:cols.join(' ').toLowerCase(), pend:[]});
      if(!mapaGeral[os]) mapaGeral[os]={setor, fam, macro};
      if(macro==='MINA') mapaMina[os]=mapaGeral[os];
      if(macro==='USINA') mapaUsina[os]=mapaGeral[os];
    });

    let pend