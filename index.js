const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) process.exit(1);

const bot = new Telegraf(BOT_TOKEN);
const app = express();
let cache = null;
let cacheHora = 0;

async function getCSV(gid){
  const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + gid;
  const r = await axios.get(url, { responseType: 'text', timeout: 30000 });
  return r.data;
}

function parseCSV(text){
  const linhas = text.split(/\r?\n/).filter(function(l){return l.trim()!=='';});
  if(!linhas.length) return {cab:[], rows:[]};
  const cab = linhas[0].split(',').map(function(s){return s.replace(/^"|"$/g,'').trim();});
  const rows = [];
  for(let i=1;i<linhas.length;i++){
    let line = linhas[i]; let cols=[]; let cur=''; let inQ=false;
    for(let j=0;j<line.length;j++){
      let c=line[j];
      if(c==='"'){ if(line[j+1]==='"'){cur+='"'; j++;} else inQ=!inQ; }
      else if(c===',' &&!inQ){ cols.push(cur); cur=''; }
      else cur+=c;
    }
    cols.push(cur);
    rows.push(cols.map(function(v){return v.replace(/^"|"$/g,'').trim();}));
  }
  return {cab, rows};
}

async function lerPlanilha(){
  if(cache && Date.now()-cacheHora < 120000) return cache;
  try{
    const csv1 = await getCSV('0');
    let csv2 = null;
    try { csv2 = await getCSV('1'); } catch(e){}
    if(!csv2){
      try { csv2 = await getCSV('1088812947'); } catch(e){}
    }
    const p1 = parseCSV(csv1);
    const up1 = p1.cab.map(function(h){return h.toUpperCase();});
    let iOS = up1.indexOf('OS');
    if(iOS<0) iOS = up1.findIndex(function(h){return h.includes('ORDEM');});
    let iSet = up1.findIndex(function(h){return h.includes('SETOR');});
    let iFam = up1.findIndex(function(h){return h.includes('FAMILIA')||h.includes('FAMÍLIA');});
    let iGru = up1.findIndex(function(h){return h.includes('GRUPO');});

    let mapaGeral={}; let mapaMina={}; let mapaUsina={}; let dadosFull=[];

    p1.rows.forEach(function(cols){
      const os = (cols[iOS]||'').replace(/\D/g,''); if(!os) return;
      const setor = (cols[iSet]||'SEM SETOR').toUpperCase().trim();
      const fam = (cols[iFam]||'SEM FAMILIA').toUpperCase().trim();
      const grupo = (cols[iGru]||'').toUpperCase().trim();
      let macro='OUTROS';
      if(grupo.startsWith('M')) macro='MINA';
      else if(grupo.startsWith('U')) macro='USINA';
      let rowObj={};
      p1.cab.forEach(function(n,idx){ rowObj[n]=cols[idx]||''; });
      dadosFull.push({os, setor, fam, grupo, macro, row:rowObj, busca:cols.join(' ').toLowerCase(), pend:[]});
      if(!mapaGeral[os]) mapaGeral[os]={setor, fam, macro};
      if(macro==='MINA') mapaMina[os]=mapaGeral[os];
      if(macro==='USINA') mapaUsina[os]=mapaGeral[os];
    });

    let pendPorOS={}; let totPend=0;
    if(csv2){
      const p2 = parseCSV(csv2);
      const iOS2=0, iItem=1, iMat=2, iTxt=3, iQtdNec=4, iRet=5, iPO=6;
      p2.rows.forEach(function(cols){
        if(cols.length <= iRet) return;
        const os = (cols[iOS2]||'').replace(/\D/g,'');
        if(!os) return;
        const qtdRetRaw = (cols[iRet]||'').trim();
        const clean = qtdRetRaw.replace(/\./g,'').replace(',','.');
        const num = parseFloat(clean);
        const isZero = qtdRetRaw==='0' || qtdRetRaw==='0,000' || qtdRetRaw==='0.000' || qtdRetRaw==='' || num===0;
        if(isZero){
          const obj={item:cols[iItem]||'', material:cols[iMat]||'', texto:cols[iTxt]||'', qtdNec:cols[iQtdNec]||'', qtdRet:qtdRetRaw||'0,000', po:cols[iPO]||''};
          if(!pendPorOS[os]) pendPorOS[os]=[];
          pendPorOS[os].push(obj);
          totPend++;
        }
      });
      dadosFull.forEach(function(d){ if(pendPorOS[d.os]) d.pend=pendPorOS[d.os]; });
    }

    const count = function(arr, key){ const o={}; Object.values(arr).forEach(function(v){ const k=v[key]||'SEM'; o[k]=(o[k]||0)+1; }); return o; };
    const res={
      total:Object.keys(mapaGeral).length,
      tMina:Object.keys(mapaMina).length,
      tUsina:Object.keys(mapaUsina).length,
      totPend,
      porMacro:{MINA:Object.keys(mapaMina).length, USINA:Object.keys(mapaUsina).length},
      porSetor:count(mapaGeral,'setor'),
      porSetorMina:count(mapaMina,'setor'),
      porSetorUsina:count(mapaUsina,'setor'),