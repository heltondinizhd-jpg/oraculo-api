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

async function lerCSV(gid){
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const r = await axios.get(url, { responseType: 'text', timeout: 25000 });
  return r.data;
}

function parseCSV(txt){
  const linhas = txt.split(/\r?\n/).filter(l=>l.trim());
  const cab = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
  const rows=[];
  for(let i=1;i<linhas.length;i++){
    let linha=linhas[i]; if(!linha.trim()) continue;
    let cols=[],cur='',inQ=false;
    for(let j=0;j<linha.length;j++){
      let c=linha[j];
      if(c==='"'){ if(linha[j+1]==='"'){cur+='"';j++;} else inQ=!inQ; }
      else if(c===',' &&!inQ){ cols.push(cur); cur=''; }
      else cur+=c;
    }
    cols.push(cur);
    rows.push(cols.map(v=>v.replace(/^"|"$/g,'').trim()));
  }
  return {cab, rows};
}

async function lerPlanilha(){
  if(cache.dados && (Date.now()-cache.hora) < 120000) return cache.dados;
  try{
    let csv1 = await lerCSV('0');
    let csv2 = null;
    try{ csv2 = await lerCSV('1'); }catch(e){ csv2=null; }
    try{ if(!csv2) csv2 = await lerCSV('1480157056'); }catch(e){}

    const p1 = parseCSV(csv1);
    const up1 = p1.cab.map(h=>h.toUpperCase());
    let iOS1 = up1.indexOf('OS'); if(iOS1<0) iOS1=up1.findIndex(h=>h.includes('ORDEM'));
    let iSet1 = up1.findIndex(h=>h.includes('SETOR'));
    let iFam1 = up1.findIndex(h=>h.includes('FAMILIA')||h.includes('FAMÍLIA'));
    let iGru1 = up1.findIndex(h=>h.includes('GRUPO'));

    let mapa={}, mapaMina={}, mapaUsina={}, dados=[];
    p1.rows.forEach(cols=>{
      const get=(i)=> i>=0?cols[i]||'': '';
      const os=get(iOS1).replace(/\D/g,''); if(!os) return;
      const setor=(get(iSet1)||'SEM SETOR').toUpperCase();
      const fam=(get(iFam1)||'SEM FAMILIA').toUpperCase();
      const grupo=(get(iGru1)||'').toUpperCase();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; else if(grupo.startsWith('U')) macro='USINA';
      let row={}; p1.cab.forEach((n,ix)=>{ row[n]=cols[ix]||''; }); row._MACRO=macro;
      dados.push({_os:os,_setor:setor,_familia:fam,_grupo:grupo,_macro:macro,_row:row,_busca:cols.join(' ').toLowerCase(),_pend:[]});
      if(!mapa[os]) mapa[os]={setor,familia:fam,macro};
      if(macro==='MINA') mapaMina[os]={setor,familia:fam};
      if(macro==='USINA') mapaUsina[os]={setor,familia:fam};
    });

    let pendPorOS={}, totPend=0;
    if(csv2){
      const p2=parseCSV(csv2);
      const up2=p2.cab.map(h=>h.toUpperCase());
      let iOS2=up2.indexOf('OS'); if(iOS2<0) iOS2=up2.findIndex(h=>h.includes('ORDEM'));
      let iQtd=up2.findIndex(h=>h.includes('QTD')&&h.includes('RETIRADA')); if(iQtd<0) iQtd=up2.findIndex(h=>h.includes('RETIRADA'));
      p2.rows.forEach(cols=>{
        const get=(i)=> i>=0?cols[i]||'': '';
        const os=get(iOS2).replace(/\D/g,''); if(!os) return;
        const qtdStr=(get(iQtd)||'').replace(',','.').trim();
        const qtd=parseFloat(qtdStr);
        if(qtdStr===''||qtd===0||qtdStr==='0'){
          let m={}; p2.cab.forEach((n,ix)=>{ m[n]=cols[ix]||''; });
          if(!pendPorOS[os]) pendPorOS[os]=[];
          pendPorOS[os].push(m); totPend++;
        }
      });
      dados.forEach(d=>{ if(pendPorOS[d._os]) d._pend=pendPorOS[d._os]; });
    }

    const total=Object.keys(mapa).length;
    const tMina=Object.keys(mapaMina).length;
    const tUsina=Object.keys(mapaUsina).length;
    const cSet={}, cFam={}, cSetM={}, cSetU={}, cFamM={}, cFamU={};
    Object.values(mapa).forEach(v=>{ cSet[v.setor]=(cSet[v.setor]||0)+1; cFam[v.familia]=(cFam[v.familia]||0)+1; });
    Object.values(mapaMina).forEach(v=>{ cSetM[v.setor]=(cSetM[v.setor]||0)+1; cFamM[v.familia]=(cFamM[v.familia]||0)+1; });
    Object.values(mapaUsina).forEach(v=>{ cSetU[v.setor]=(cSetU[v.setor]||0)+1; cFamU[v.familia]=(cFamU[v.familia]||0)+1; });

    const res={totalOrdens:total,totalMina:tMina,totalUsina:tUsina,totalPend:totPend,porMacro:{MINA:tMina,USINA:tUsina},porSetor:cSet,porFamilia:cFam,porSetorMina:cSetM,porSetorUsina:cSetU,porFamiliaMina:cFamM,porFamiliaUsina:cFamU,dadosFull:dados};
    cache={dados:res,hora:Date.now()};
    console.log('OK',total,tMina,tUsina,totPend);
    return res;
  }catch(e){
    console.log('ERRO',e.message);
    return cache.dados||{totalOrdens:0,totalMina:0,totalUsina:0,totalPend:0,porMacro:{},porSetor:{},porFamilia:{},porSetorMina:{},porSetorUsina:{},porFamiliaMina:{},porFamiliaUsina:{},dadosFull:[]};
  }
}

lerPlanilha();
const menu=Markup.keyboard([['\uD83D\uDD0D Buscar OS','\uD83D\uDCCA Resumo'],['\uD83D\uDCC8 Dashboard','\u267B\uFE0F Limpar']]).resize();
bot.start((ctx)=>ctx.reply('Bot ZROF Online!',menu));
bot.hears('\uD83D\uDCCA Resumo',(ctx)=>{ ctx.message.text='/resumo'; return bot.handleUpdate({message:ctx.message}); });
bot.hears('\uD83D\uDCC8 Dashboard',(ctx)=>{ const d=process.env.RENDER_EXTERNAL_HOSTNAME; const url=d?'https://'+d+'/dashboard':'/dashboard'; return ctx.reply('Dashboard: '+url,menu); });
bot.hears('\u267B\uFE0F Limpar',async(ctx)=>{ cache={dados:null,hora:0}; await ctx.reply('Recarregando...',menu); const r=await lerPlanilha(); return ctx.reply(`OK Ordens:${r.totalOrdens} Pend:${r.totalPend}`,menu); });
bot.hears('\uD83D\uDD0D Buscar OS',(ctx)=>ctx.reply('Digite a OS:',menu));

bot.command('resumo',async(ctx)=>{
  const d=await lerPlanilha();
  let txt=`RESUMO ZROF\nTotal:${d.totalOrdens} Mina:${d.totalMina} Usina:${d.totalUsina} Pendentes:${d.totalPend}\n\nSETOR GERAL:\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+=`${k}: ${v}\n`; });
  txt+=`\nSETOR MINA:\n`; Object.entries(d.porSetorMina).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+=`${k}: ${v}\n`; });
  txt+=`\nSETOR USINA:\n`; Object.entries(d.porSetorUsina).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+=`${k}: ${v}\n`; });
  for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu);
});
bot.command('dashboard',(ctx)=>{ const d=process.env.RENDER_EXTERNAL_HOSTNAME; const url=d?'https://'+d+'/dashboard':'/dashboard'; return ctx.reply('Dashboard: '+url,menu); });
bot.command('limpar',async(ctx)=>{ cache={dados:null,hora:0}; const r=await lerPlanilha(); return ctx.reply(`OK ${r.totalOrdens}`,menu); });

bot.on('text',async(ctx)=>{
  const t=ctx.message.text.trim(); if(t.startsWith('/')||t.includes('Buscar')||t.includes('Resumo')||t.includes('Dashboard')||t.includes('Limpar')) return;
  const d=await lerPlanilha();
  const busca=t.toLowerCase(); const dig=t.replace