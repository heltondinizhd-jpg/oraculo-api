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
let cache = { dados: null, hora: 0 };

async function getGids() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/`;
    const r = await axios.get(url, { timeout: 10000 });
    const matches = [...r.data.matchAll(/"gid":\s*"?(\d+)"?/g)].map(m=>m[1]);
    const unicos = [...new Set(matches)];
    return unicos;
  } catch(e){ return ['0']; }
}

async function lerCSVporGid(gid) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
    const r = await axios.get(url, { responseType: 'text', timeout: 25000 });
    return r.data;
  } catch(e){ return null; }
}

function parseCSV(csvText) {
  const linhas = csvText.split(/\r?\n/).filter(l=>l.trim());
  if (!linhas.length) return { cab: [], rows: [] };
  const cab = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
  const rows = [];
  for (let i=1;i<linhas.length;i++){
    const linha = linhas[i]; if (!linha.trim()) continue;
    const cols = []; let cur='', inQ=false;
    for (let j=0;j<linha.length;j++){
      const c=linha[j];
      if (c==='"'){ if (linha[j+1]==='"'){ cur+='"'; j++; } else inQ=!inQ; }
      else if (c===',' &&!inQ){ cols.push(cur); cur=''; }
      else cur+=c;
    }
    cols.push(cur);
    rows.push(cols.map(c=>c.replace(/^"|"$/g,'').trim()));
  }
  return { cab, rows };
}

async function lerPlanilha() {
  if (cache.dados && Date.now() - cache.hora < 2*60*1000) return cache.dados;