const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) { console.error('BOT_TOKEN nao definido!'); process.exit(1); }
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());
let cachePlanilha = { dados: null, hora: 0 };
let esperandoFiltro = {};
async function parseCSV(text) {
  const rows = []; let cur = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const next = text[i+1];
    if (c === '"') { if (inQuotes && next === '"') { cur += '"'; i++; } else inQuotes =!inQuotes; }
    else if (c === ',' &&!inQuotes) { row.push(cur); cur = ''; }
    else if ((c === '\n' || c === '\r') &&!inQuotes) {
      if (cur || row.length) { row.push(cur); rows.push(row); row=[]; cur=''; }
      if (c === '\r' && next === '\n') i++;
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.join('').trim()!== '');
}
async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
  let allDataRows = []; let cabecalho = null; let offset = 0;
  while (true) {
    const tq = 'SELECT * LIMIT 1000 OFFSET ' + offset;
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&tq=' + encodeURIComponent(tq);
    try {
      const r = await axios.get(url, { responseType: 'text', timeout: 15000 });
      const rows = await parseCSV(r.data);
      if (rows.length === 0) break;
      if (!cabecalho) { cabecalho = rows[0].map(h=>h.replace(/"/g,'').trim().toUpperCase()); allDataRows.push(...rows.slice(1)); }
      else { const isHeader = rows[0].join(',').toUpperCase().includes('OS'); allDataRows.push(...(isHeader? rows.slice(1) : rows)); }
      if (rows.length < 1000) break;
      offset += 1000; if (offset > 15000) break;
    } catch (e) { console.error('Erro planilha:', e.message); break; }
  }
  const idxEmissao = cabecalho? cabecalho.findIndex(h=>h.includes('EMISS')) : -1;
  const idxLead = cabecalho? cabecalho.findIndex(h=>h.includes('LEAD')) : -1;
  const dados = allDataRows.map(cols=>{
    let obj = {}; cabecalho.forEach((h, idx)=>{ obj[h]=(cols[idx]||'').replace(/^"|"$/g,'').trim(); });
    const emissaoStr = idxEmissao>=0? (cols[idxEmissao]||'') : '';
    let lead = 0;
    if(idxLead>=0){
      const rawLead = (cols[idxLead]||'').replace(/^"|"$/g,'').trim();
      const num = parseInt(String(rawLead).replace(/[^0-9\-]/g,''));
      if(!isNaN(num)) lead=num;
    }
    obj._leadTime=lead; obj._emissaoRaw=emissaoStr; obj._textoBusca=Object.values(obj).join(' ').toLowerCase();
    return obj;
  }).filter(o=>o['OS']);
  const res={cabecalho,dados}; cachePlanilha={dados:res,hora:Date.now()};
  console.log('TOTAL LIDO: '+dados.length);
  return res;
}
const menu = Markup.keyboard([['OS','CÓDIGO','FAMÍLIA'],['SETOR','STATUS','/resumo'],['/alertas','/dashboard']]).resize();
bot.start((ctx)=>ctx.reply('Bot ZROF - Dashboard com grafico',menu));
bot.command('limpar',(ctx)=>{cachePlanilha={dados:null,hora:0}; return ctx.reply('Cache limpo!',menu);});
bot.command('resumo',async(ctx)=>{
  try{
    const {dados}=await lerPlanilhaCompleta();
    let txt='RESUMO GERAL: '+dados.length+' OS\n';
    const porSetor={}; dados.forEach(d=>{ const s=d['SETOR']||'SEM SETOR'; porSetor[s]=(porSetor[s]||0)+1; });
    Object.entries(porSetor).forEach(([k,v])=>{txt+=k+': '+v+'\n';});
    return ctx.reply(txt.substring(0,4096),menu);
  }catch(e){return ctx.reply('Erro no resumo',menu);}
});
bot.command('dashboard',(ctx)=>{
  const host=process.env.RENDER_EXTERNAL_HOSTNAME||('localhost:'+PORT);
  return ctx.reply('Dashboard: https://'+host+'/dashboard',menu);
});
bot.command('alertas',async(ctx)=>{
  try{
    const {dados}=await lerPlanilhaCompleta();
    const imediatas=dados.filter(d=>d._leadTime>=180).sort((a,b)=>b._leadTime-a._leadTime);
    const urgentes=dados.filter(d=>d._leadTime>=150&&d._leadTime<180).sort((a,b)=>b._leadTime-a._leadTime);
    const prioritarias=dados.filter(d=>d._leadTime>=120&&d._leadTime<150).sort((a,b)=>b._leadTime-a._leadTime);
    const total=imediatas.length+urgentes.length+prioritarias.length;
    if(total===0) return ctx.reply('Nenhuma OS com mais de 120 dias!',menu);
    let txt='ALERTAS LEAD >120 DIAS: '+total+' OS\n';
    if(imediatas.length){txt+='\nIMEDIATA (>=180d): '+imediatas.length+' OS\n'; imediatas.slice(0,20).forEach(o=>{txt+='OS '+o['OS']+' | '+o._leadTime+'d | '+o['SETOR']+'\n';});}
    if(urgentes.length){txt+='\nURGENTE (150-179d): '+urgentes.length+' OS\n'; urgentes.slice(0,20).forEach(o=>{txt+='OS '+o['OS']+' | '+o._leadTime+'d | '+o['SETOR']+'\n';});}
    if(prioritarias.length){txt+='\nPRIORITARIO (120-149d): '+prioritarias.length+' OS\n'; prioritarias.slice(0,20).forEach(o=>{txt+='OS '+o['OS']+' | '+o._leadTime+'d | '+o['SETOR']+'\n';});}
    return ctx.reply(txt.substring(0,4096),menu);
  }catch(e){return ctx.reply('Erro nos alertas',menu);}
});
bot.hears(['OS','CÓDIGO','FAMÍLIA','SETOR','STATUS'],(ctx)=>{
  const mapa={'OS':'OS','CÓDIGO':'CODIGO','FAMÍLIA':'FAMILIA','SETOR':'SETOR','STATUS':'STATUS'};
  esperandoFiltro[ctx.from.id]=mapa[ctx.message.text];
  return ctx.reply('Digite o valor para '+ctx.message.text+':');
});
bot.on('text',async(ctx)=>{
  try{
    const textoOriginal=ctx.message.text.trim(); if(textoOriginal.startsWith('/')) return;
    if(['OS','CÓDIGO','FAMÍLIA','SETOR','STATUS'].includes(textoOriginal)) return;
    const id=ctx.from.id; const texto=textoOriginal.toLowerCase();
    const {cabecalho,dados}=await lerPlanilhaCompleta();
    const filtroAtivo=esperandoFiltro[id];
    let encontradas=filtroAtivo?dados.filter(d=>(d[filtroAtivo]||'').toLowerCase().includes(texto)):dados.filter(d=>d._textoBusca.includes(texto));
    delete esperandoFiltro[id];
    if(encontradas.length===0) return ctx.reply('Nada para "'+textoOriginal+'"',menu);
    if(encontradas.length===1){
      const os=encontradas[0]; let r='FICHA OS '+os['OS']+'\n';
      cabecalho.forEach(col=>{ if(!col.startsWith('_')) r+=col+': '+(os[col]||'-')+'\n'; });
      return ctx.reply(r.substring(0,4096),menu);
    }
    await ctx.reply(encontradas.length+' OS encontradas:');
    for(let i=0;i<encontradas.length;i+=10){
      const lote=encontradas.slice(i,i+10); let msg='';
      lote.forEach(o=>{ msg+='OS '+o['OS']+' | COD '+o['CODIGO']+' | '+o._emissaoRaw+' | '+o['SETOR']+' | LEAD '+o._leadTime+'d\n'; });
      await ctx.reply(msg);
    }
    return ctx.reply('Total: '+encontradas.length+' OS',menu);
  }catch(e){ console.error(e); return ctx.reply('Erro na busca',menu); }
});
app.get('/',(req,res)=>res.send('Bot ZROF online - webhook ativo'));
app.get('/dashboard',async(req,res)=>{
  try{
    const {dados}=await lerPlanilhaCompleta();
    const porSetor={}; dados.forEach(d=>{ const k=d['SETOR']||'SEM'; porSetor[k]=(porSetor[k]||0)+1; });
    const porStatus={}; dados.forEach(d=>{ const k=d['STATUS']||'SEM'; porStatus[k]=(porStatus[k]||0)+1; });
    const a180=dados.filter(d=>d._leadTime>=180).length;
    const a150=dados.filter(d=>d._leadTime>=150&&d._leadTime<180).length;
    const a120=dados.filter(d=>d._leadTime>=120&&d._leadTime<150).length;
    const aOk=dados.filter(d=>d._leadTime<120).length;
    const labelsSetor=JSON.stringify(Object.keys(porSetor));
    const valuesSetor=JSON.stringify(Object.values(porSetor));
    const labelsStatus=JSON.stringify(Object.keys(porStatus));
    const valuesStatus=JSON.stringify(Object.values(porStatus));
    let linhas='';
    for(let i=0;i<Math.min(500,dados.length);i++){
      const o=dados[i];
      linhas+='<tr><td>'+o['OS']+'</td><td>'+(o['CODIGO']||'')+'</td><td>'+o._emissaoRaw+'</td><td>'+(o['SETOR']||'')+'</td><td>'+(o['STATUS']||'')+'</td><td>'+o._leadTime+'</td></tr>';
    }
    res.send(
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZROF</title>'+
      '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'+
      '<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:12px}.grid{display:grid;gap:12px}.card{background:#1e293b;padding:16px;border-radius:16px} table{width:100%;border-collapse:collapse;margin-top:12px;background:#1e293b} th,td{border:1px solid #334155;padding:6px;font-size:11px} th{background:#0f172a} @media(min-width:800px){.grid{grid-template-columns:1fr 1fr}}</style>'+
      '</head><body><h2>ZROF - '+dados.length+' OS - Lead da planilha</h2>'+
      '<div class="grid"><div class="card"><h3>OS por SETOR</h3><canvas id="c1"></canvas></div>'+
      '<div class="card"><h3>OS por STATUS</h3><canvas id="c2"></canvas></div>'+
      '<div class="card"><h3>Alertas LEAD TIME</h3><canvas id="c3"></canvas></div>'+
      '<div class="card"><h3>Resumo</h3><p>Imediata >=180d: '+a180+'</p><p>Urgente 150-179d: '+a150+'</p><p>Prioritario 120-149d: '+a120+'</p><p>OK <120d: '+aOk+'</p></div></div>'+
      '<table><tr><th>OS</th><th>CODIGO</th><th>EMISSAO</th><th>SETOR</th><th>STATUS</th><th>LEAD</th></tr>'+linhas+'</table>'+
      '<script>'+
      'new Chart(document.getElementById("c1"),{type:"bar",data:{labels:'+labelsSetor+',datasets:[{label:"OS",data:'+valuesSetor+',backgroundColor:"#38bdf8"}]}});'+
      'new Chart(document.getElementById("c2"),{type:"doughnut",data:{labels:'+labelsStatus+',datasets:[{data:'+valuesStatus+'}]}});'+
      'new Chart(document.getElementById("c3"),{type:"bar",data:{labels:["180+","150-179","120-149","<120"],datasets:[{label