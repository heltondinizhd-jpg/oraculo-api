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
let cacheMat = { dados: null, hora: 0 };
let estadoUsuario = {};

async function lerMateriais(){
  if(cacheMat.dados && Date.now() - cacheMat.hora < 2*60*1000) return cacheMat.dados;
  try{
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=BD_MAT`;
    console.log('Buscando BD_MAT: '+url);
    const r = await axios.get(url, { responseType:'text', timeout:20000 });
    if(r.data.includes('<html')) throw new Error('HTML retornado');
    const linhas = r.data.split(/\r?\n/).filter(l=>l.trim());
    console.log('BD_MAT linhas: '+linhas.length+' primeira: '+linhas[0].substring(0,100));
    const porOS = {}; let total=0;
    for(let i=1;i<linhas.length;i++){
      const linha = linhas[i];
      const cols=[]; let cur='',inQ=false;
      for(let j=0;j<linha.length;j++){
        const c=linha[j];
        if(c==='"'){ if(linha[j+1]==='"'){ cur+='"'; j++; } else inQ=!inQ; }
        else if(c===',' &&!inQ){ cols.push(cur); cur=''; }
        else cur+=c;
      }
      cols.push(cur);
      const clean = cols.map(s=>s.replace(/^"|"$/g,'').trim());
      const os = (clean[0]||'').replace(/\D/g,''); if(!os) continue;
      if(!porOS[os]) porOS[os]=[];
      porOS[os].push({
        txtOrdem: clean[1]||'',
        item: clean[2]||'',
        material: clean[3]||'',
        txtMat: clean[4]||'',
        qtdNec: clean[5]||'',
        qtdRet: clean[6]||'',
        po: clean[7]||''
      });
      total++;
    }
    const res = { porOS, total };
    cacheMat = { dados: res, hora: Date.now() };
    console.log(`BD_MAT OK: ${total} materiais`);
    return res;
  }catch(e){
    console.log('ERRO BD_MAT: '+e.message);
    return cacheMat.dados || { porOS:{}, total:0 };
  }
}

async function lerPlanilha() {
  if (cache.dados && Date.now() - cache.hora < 2*60*1000) return cache.dados;
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv';
    const r = await axios.get(url, { responseType: 'text', timeout: 25000 });
    const linhas = r.data.split(/\r?\n/).filter(l=>l.trim());
    const cabOriginal = linhas[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim());
    const cabUpper = cabOriginal.map(h=>h.toUpperCase().trim());
    let idxOS = cabUpper.indexOf('OS'); if (idxOS===-1) idxOS=cabUpper.findIndex(h=>h.includes('ORDEM'));
    let idxSetor = cabUpper.findIndex(h=>h.includes('SETOR'));
    let idxFam = cabUpper.findIndex(h=>h.includes('FAMILIA') || h.includes('FAMÍLIA'));
    let idxGrupo = cabUpper.findIndex(h=>h==='GRUPO');
    const mapaOrdens = {}; const mapaMina = {}; const mapaUsina = {}; const dadosFull = [];
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
      const get = (idx)=> idx>=0? (cols[idx]||'').replace(/^"|"$/g,'').trim() : '';
      const os = get(idxOS).replace(/\D/g,''); if(!os || os.length < 3) continue;
      const setor = (get(idxSetor)||'SEM SETOR').toUpperCase().trim();
      const fam = (get(idxFam)||'SEM FAMILIA').toUpperCase().trim();
      const grupo = (get(idxGrupo)||'').toUpperCase().trim();
      let macro = 'OUTROS'; if (grupo.startsWith('M')) macro = 'MINA'; else if (grupo.startsWith('U')) macro = 'USINA';
      const rowCompleta = {}; cabOriginal.forEach((n,idx)=>{ rowCompleta[n]=get(idx); }); rowCompleta['_MACRO']=macro;
      dadosFull.push({ _os: os, _setor: setor, _familia: fam, _grupo: grupo, _macro: macro, _row: rowCompleta, _busca: linha.toLowerCase() });
      if (!mapaOrdens[os]) mapaOrdens[os] = { setor, familia: fam, macro };
      if (macro==='MINA') mapaMina[os]= { setor, familia: fam }; if (macro==='USINA') mapaUsina[os]= { setor, familia: fam };
    }
    const totalOrdens = Object.keys(mapaOrdens).length; const totalMina = Object.keys(mapaMina).length; const totalUsina = Object.keys(mapaUsina).length;
    const porSetor = {}; Object.values(mapaOrdens).forEach(d=>{ porSetor[d.setor]=(porSetor[d.setor]||0)+1; });
    const porFamilia = {}; Object.values(mapaOrdens).forEach(d=>{ porFamilia[d.familia]=(porFamilia[d.familia]||0)+1; });
    const porSetorMina = {}; Object.values(mapaMina).forEach(d=>{ porSetorMina[d.setor]=(porSetorMina[d.setor]||0)+1; });
    const porSetorUsina = {}; Object.values(mapaUsina).forEach(d=>{ porSetorUsina[d.setor]=(porSetorUsina[d.setor]||0)+1; });
    const porFamiliaMina = {}; Object.values(mapaMina).forEach(d=>{ porFamiliaMina[d.familia]=(porFamiliaMina[d.familia]||0)+1; });
    const porFamiliaUsina = {}; Object.values(mapaUsina).forEach(d=>{ porFamiliaUsina[d.familia]=(porFamiliaUsina[d.familia]||0)+1; });
    const porMacro = { MINA: totalMina, USINA: totalUsina };
    const result = { totalOrdens, totalMina, totalUsina, porMacro, porSetor, porFamilia, porSetorMina, porSetorUsina, porFamiliaMina, porFamiliaUsina, dadosFull };
    cache = { dados: result, hora: Date.now() }; return result;
  } catch (e) {
    return cache.dados;
  }
}

lerPlanilha(); lerMateriais();
const menu = Markup.keyboard([['🔍 Buscar OS','🧩 Materiais OS'],['📊 Resumo','📈 Dashboard'],['♻️ Limpar']]).resize();
bot.start((ctx)=>ctx.reply('🤖 Bot ZROF Online!', menu));
bot.hears('📊 Resumo', async (ctx)=>{ ctx.message.text='/resumo'; return bot.handleUpdate({message: ctx.message}); });
bot.hears('📈 Dashboard', async (ctx)=>{ const domain=process.env.RENDER_EXTERNAL_HOSTNAME; const url=domain? 'https://'+domain+'/dashboard':'/dashboard'; return ctx.reply('📈 Dashboard: '+url, menu); });
bot.hears('♻️ Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; await ctx.reply('♻️ Recarregando...', menu); const d=await lerPlanilha(); const m=await lerMateriais(); return ctx.reply(`Pronto! Ordens:${d.totalOrdens} | Materiais:${m.total} (BD_MAT)`, menu); });
bot.hears('🔍 Buscar OS', (ctx)=>ctx.reply('Digite a OS:', menu));
bot.hears('🧩 Materiais OS', (ctx)=>{ estadoUsuario[ctx.from.id] = 'AGUARDANDO_OS_MATERIAL'; return ctx.reply('🧩 Digite o número da OS:', menu); });

bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  let txt = `📊 RESUMO ZROF\nTotal: ${d.totalOrdens} | Mina:${d.totalMina} | Usina:${d.totalUsina}\n\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });
  for (let i=0;i<txt.length;i+=4000){ await ctx.reply(txt.substring(i,i+4000), menu); }
});

bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/') || ['🔍 Buscar OS','🧩 Materiais OS','📊 Resumo','📈 Dashboard','♻️ Limpar'].includes(texto)) return;
  const userId = ctx.from.id;
  if(estadoUsuario[userId] === 'AGUARDANDO_OS_MATERIAL'){
    estadoUsuario[userId] = null;
    const osBusca = texto.replace(/\D/g,'');
    const mats = await lerMateriais();
    const lista = mats.porOS[osBusca];
    if(!lista) return ctx.reply(`❌ Nenhum material na BD_MAT para OS ${osBusca}. Total BD_MAT: ${mats.total}`, menu);
    let txt = `🧩 MATERIAIS BD_MAT - OS ${osBusca} (${lista.length} itens)\n\n`;
    lista.forEach((m,i)=>{
      const pend = (m.qtdRet==='0' || m.qtdRet==='0,000' || m.qtdRet==='' )? '⚠️ PENDENTE' : '✅';
      txt += `${i+1}) ${pend}\nItem:${m.item} Mat:${m.material}\n${m.txtMat}\nNec:${m.qtdNec} Ret:${m.qtdRet} PO:${m.po}\n\n`;
    });
    for (let i=0;i<txt.length;i+=4000){ await ctx.reply(txt.substring(i,i+4000), menu); }
    return;
  }
  try {
    const busca = texto.toLowerCase(); const { dadosFull } = await lerPlanilha();
    const achadas = dadosFull.filter(d=>d._busca.includes(busca));
    if (!achadas.length) return ctx.reply(`❌ Nada para "${texto}"`, menu);
    for (const item of achadas.slice(0,3)){
      let detalhe = `📋 OS: ${item._os} | Macro: ${item._macro}\n`;
      for (const [col, val] of Object.entries(item._row)){ if (val) detalhe += `${col}: ${val}\n`; }
      const mats = await lerMateriais();
      const qtdMat = mats.porOS[item._os]?.length || 0;
      if(qtdMat>0){
        detalhe += `\n🧩 ${qtdMat} materiais na BD_MAT`;
        await ctx.reply(detalhe.substring(0,4000), Markup.inlineKeyboard([[Markup.button.callback(`Ver ${qtdMat} materiais`,`mat:${item._os}`)]]));
      } else {
        await ctx.reply(detalhe.substring(0,4000), menu);
      }
    }
  } catch(e){}
});

bot.action(/mat:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  const os = ctx.match[1]; const mats = await lerMateriais(); const lista = mats.porOS[os];
  if(!lista) return ctx.reply(`Sem materiais BD_MAT para ${os}`, menu);
  let txt = `🧩 BD_MAT - OS ${os} (${lista.length})\n\n`;
  lista.forEach((m,i)=>{ const pend = (m.qtdRet==='0' || m.qtdRet==='0,000' || m.qtdRet==='' )? '⚠️' : '✅'; txt += `${i+1}) ${pend} ${m.material} ${m.txtMat} Nec:${m.qtdNec} Ret:${m.qtdRet} PO:${m.po}\n\n`; });
  for (let i=0;i<txt.length;i+=4000){ await ctx.reply(txt.substring(i,i+4000), menu); }
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{ res.json(await lerPlanilha()); });
app.get('/api/materiais/:os', async (req,res)=>{ const m=await lerMateriais(); res.json(m.porOS[req.params.os]||[]); });
app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));
const dashHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding: