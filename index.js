const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) process.exit(1);

const bot = new Telegraf(BOT_TOKEN);
const app = express();
let cache = null;
let cacheHora = 0;

async function getCSV(gid){
  // EXPORT pega a planilha inteira, não limita como o gviz
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const r = await axios.get(url, { responseType: 'text', timeout: 30000 });
  return r.data;
}

function parseCSV(text){
  const linhas = text.split(/\r?\n/).filter(l=>l.trim()!=='');
  if(!linhas.length) return {cab:[], rows:[]};
  const cab = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
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
    rows.push(cols.map(v=>v.replace(/^"|"$/g,'').trim()));
  }
  return {cab, rows};
}

async function lerPlanilha(){
  if(cache && Date.now()-cacheHora < 120000) return cache;
  try{
    const csv1 = await getCSV('0');
    let csv2 = null;
    try{ csv2 = await getCSV('1088812947'); }catch(e){ try