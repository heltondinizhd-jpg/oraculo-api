const express = require('express');
const axios = require('axios');
let Telegraf, Markup;
try{ const t=require('telegraf'); Telegraf=t.Telegraf; Markup=t.Markup; }catch(e){}

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;

const app = express();
let cache={dados:null,hora:0};
let cacheMat={dados:null,hora:0};
let estado={};

async function lerMateriais(){
  if(cacheMat.dados && Date.now()-cacheMat.hora<120000) return cacheMat.dados;
  const urls=[
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv&sheet=BD_MAT',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=2',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=3'
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
        const pendPorOSCount={};
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
            pendPorOSCount[os]=(pendPorOSCount[os]||0)+1;
            totalPend++;
          }
          total++;
        }
        const res={porOS,porOSPend,total,totalPend,pendPorOSCount};
        cacheMat={dados:res,hora:Date.now()};
        return res;
      }
    }catch(e){}
  }
  return {porOS:{},porOSPend:{},total:0,totalPend:0,pendPorOSCount:{}};
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
    let idxGrupo=cabU.findIndex(h=>h==='GRUPO'||h.includes('GRUPO'));
    const mapaOrdens={}, mapaMina={}, mapaUsina={}, porSetor={}, porSetorMina={}, porSetorUsina={}, porFamilia={}, porFamiliaMina={}, porFamiliaUsina={}, dadosFull=[];
    for(let i=1;i<linhas.length;i++){
      let line=linhas[i], cols=[], cur='', inQ=false;
      for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ;} else if(c==','&&!inQ){cols.push(cur);cur='';} else cur+=c; }
      cols.push(cur);
      const get=(idx)=> idx>=0?(cols[idx]||'').replace(/^"|"$/g,'').trim():'';
      const os=get(idxOS).replace(/\D/g,''); if(!os) continue;
      const setor=(get(idxSetor)||'SEM SETOR').toUpperCase(); const fam=(get(idxFam)||'SEM').toUpperCase(); const grupo=(get(idxGrupo)||'').toUpperCase();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; else if(grupo.startsWith('U')) macro='USINA';
      const row={}; cabOriginal.forEach((n,idx)=>{row[n]=get(idx);}); row['_MACRO']=macro;
      dadosFull.push({_os:os,_setor:setor,_familia:fam,_grupo:grupo,_macro:macro,_row:row,_busca:line.toLowerCase()});
      if(!mapaOrdens[os]){ mapaOrdens[os]={setor,familia:fam,macro}; porSetor[setor]=(porSetor[setor]||0)+1; porFamilia[fam]=(porFamilia[fam]||0)+1; }
      if(macro==='MINA'){ if(!mapaMina[os]){ mapaMina[os]=1; porSetorMina[setor]=(porSetorMina[setor]||0)+1; porFamiliaMina[fam]=(porFamiliaMina[fam]||0)+1; } }
      if(macro==='USINA'){ if(!mapaUsina[os]){ mapaUsina[os]=1; porSetorUsina[setor]=(porSetorUsina[setor]||0)+1; porFamiliaUsina[fam]=(porFamiliaUsina[fam]||0)+1; } }
    }
    const result={
      totalOrdens:Object.keys(mapaOrdens).length,
      totalMina:Object.keys(mapaMina).length,
      totalUsina:Object.keys(mapaUsina).length,
      porMacro:{MINA:Object.keys(mapaMina).length,USINA:Object.keys(mapaUsina).length},
      porSetor, porSetorMina, porSetorUsina,
      porFamilia, porFamiliaMina, porFamiliaUsina,
      dadosFull
    };
    cache={dados:result,hora:Date.now()}; return result;
  }catch(e){ console.log(e.message); return cache.dados; }
}

app.get('/',(req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{ const d=await lerPlanilha(); const m=await lerMateriais(); res.json({ordens:d, materiais:m}); });

app.get('/dashboard', async (req,res)=>{
  const d=await lerPlanilha()||{totalOrdens:0,totalMina:0,totalUsina:0,porMacro:{MINA:0,USINA:0},porSetor:{},porSetorMina:{},porSetorUsina:{}};
  const m=await lerMateriais()||{total:0,totalPend:0};
  const html = `
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px;margin:0}
.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
h2{margin:8px 0 16px}
.big{font-size:28px;font-weight:800}
.label{opacity:.7;font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
@media(max-width:800px){.kpis{grid-template-columns:1fr 1fr}}
</style></head><body>
<h2>ZROF Dashboard</h2>
<div class="kpis">
  <div class="card"><div class="label">Total Ordens</div><div class="big">${d.totalOrdens}</div></div>
  <div class="card"><div class="label">MINA</div><div class="big">${d.totalMina}</div></div