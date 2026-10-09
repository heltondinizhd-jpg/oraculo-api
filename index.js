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
let estadoUsuario = {}; // para saber quem clicou em Buscar Material

async function getCSVSheet(gid){
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`
  ];
  for(let u of urls){
    try{
      const r = await axios.get(u, { responseType:'text', timeout:15000 });
      if(r.data && r.data.length>100 &&!r.data.includes('<html')) return r.data;
    }catch(e){}
  }
  return null;
}

async function lerMateriais(){
  if(cacheMat.dados && Date.now() - cacheMat.hora < 2*60*1000) return cacheMat.dados;
  // Tenta achar a aba BD_MAT - tenta gids comuns
  const gids = ['1','1957311427','1132978923','2','3','0'];
  let csv = null, gidUsado = null;
  for(let gid of gids){
    csv = await getCSVSheet(gid);
    if(csv && (csv.toUpperCase().includes('MATERIAL') || csv.toUpperCase().includes('QTD'))){
      if(gid!=='0'){ gidUsado=gid; break; }
    }
  }
  if(!csv){ console.log('BD_MAT nao achada'); return { porOS:{}, total:0 }; }
  console.log('BD_MAT achada gid='+gidUsado);

  const linhas = csv.split(/\r?\n/).filter(l=>l.trim());
  const porOS = {};
  let total = 0;
  for(let i=1;i<linhas.length;i++){
    const linha = linhas[i]; if(!linha.trim()) continue;
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
    const txtOrdem = clean[1]||'';
    const item = clean[2]||'';
    const material = clean[3]||'';
    const txtMat = clean[4]||'';
    const qtdNec = clean[5]||'';
    const qtdRet = clean[6]||'';
    const po = clean[7]||'';
    // Considera pendente se qtdRet for 0 ou vazio - mas lista todos pra busca
    if(!porOS[os]) porOS[os]=[];
    porOS[os].push({ item, material, txtMat, qtdNec, qtdRet, po, txtOrdem });
    total++;
  }
  const res = { porOS, total };
  cacheMat = { dados: res, hora: Date.now() };
  return res;
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
    let idxGrupo = cabUpper.findIndex(h=>h==='GRUPO' || h.includes('GRUPO'));

    const mapaOrdens = {};
    const mapaMina = {};
    const mapaUsina = {};
    const dadosFull = [];

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

      let macro = 'OUTROS';
      if (grupo.startsWith('M')) macro = 'MINA';
      else if (grupo.startsWith('U')) macro = 'USINA';

      const rowCompleta = {}; cabOriginal.forEach((n,idx)=>{ rowCompleta[n]=get(idx); });
      rowCompleta['_MACRO']=macro;

      dadosFull.push({ _os: os, _setor: setor, _familia: fam, _grupo: grupo, _macro: macro, _row: rowCompleta, _busca: linha.toLowerCase() });

      if (!mapaOrdens[os]) mapaOrdens[os] = { setor, familia: fam, macro };
      if (macro==='MINA') mapaMina[os]= { setor, familia: fam };
      if (macro==='USINA') mapaUsina[os]= { setor, familia: fam };
    }

    const totalOrdens = Object.keys(mapaOrdens).length;
    const totalMina = Object.keys(mapaMina).length;
    const totalUsina = Object.keys(mapaUsina).length;

    const porSetor = {}; Object.values(mapaOrdens).forEach(d=>{ porSetor[d.setor]=(porSetor[d.setor]||0)+1; });
    const porFamilia = {}; Object.values(mapaOrdens).forEach(d=>{ porFamilia[d.familia]=(porFamilia[d.familia]||0)+1; });

    const porSetorMina = {}; Object.values(mapaMina).forEach(d=>{ porSetorMina[d.setor]=(porSetorMina[d.setor]||0)+1; });
    const porSetorUsina = {}; Object.values(mapaUsina).forEach(d=>{ porSetorUsina[d.setor]=(porSetorUsina[d.setor]||0)+1; });
    const porFamiliaMina = {}; Object.values(mapaMina).forEach(d=>{ porFamiliaMina[d.familia]=(porFamiliaMina[d.familia]||0)+1; });
    const porFamiliaUsina = {}; Object.values(mapaUsina).forEach(d=>{ porFamiliaUsina[d.familia]=(porFamiliaUsina[d.familia]||0)+1; });
    const porMacro = { MINA: totalMina, USINA: totalUsina };

    const result = { totalOrdens, totalMina, totalUsina, porMacro, porSetor, porFamilia, porSetorMina, porSetorUsina, porFamiliaMina, porFamiliaUsina, dadosFull };
    cache = { dados: result, hora: Date.now() };
    console.log(`LIDO: ${totalOrdens} Ordens | Mina:${totalMina} Usina:${totalUsina}`);
    return result;
  } catch (e) {
    console.log('ERRO:', e.message);
    return cache.dados || { totalOrdens:0, totalMina:0, totalUsina:0, porMacro:{}, porSetor:{}, porFamilia:{}, porSetorMina:{}, porSetorUsina:{}, porFamiliaMina:{}, porFamiliaUsina:{}, dadosFull:[], erro:e.message };
  }
}

lerPlanilha();
lerMateriais();

// MENU ATUALIZADO COM NOVO BOTAO
const menu = Markup.keyboard([['🔍 Buscar OS','🧩 Materiais OS'],['📊 Resumo','📈 Dashboard'],['♻️ Limpar']]).resize();

bot.start((ctx)=>ctx.reply('🤖 Bot ZROF - Macro Mina/Usina Online!', menu));
bot.hears('📊 Resumo', async (ctx)=>{ ctx.message.text='/resumo'; return bot.handleUpdate({message: ctx.message}); });
bot.hears('📈 Dashboard', async (ctx)=>{ const domain=process.env.RENDER_EXTERNAL_HOSTNAME; const url=domain? 'https://'+domain+'/dashboard':'/dashboard'; return ctx.reply('📈 Dashboard: '+url, menu); });
bot.hears('♻️ Limpar', async (ctx)=>{ cache={dados:null,hora:0}; cacheMat={dados:null,hora:0}; await ctx.reply('♻️ Recarregando...', menu); const d=await lerPlanilha(); const m=await lerMateriais(); return ctx.reply(`Pronto! Ordens:${d.totalOrdens} | Materiais:${m.total}`, menu); });
bot.hears('🔍 Buscar OS', (ctx)=>ctx.reply('Digite a OS:', menu));

// NOVO BOTAO - BUSCA DE MATERIAL
bot.hears('🧩 Materiais OS', (ctx)=>{
  estadoUsuario[ctx.from.id] = 'AGUARDANDO_OS_MATERIAL';
  return ctx.reply('🧩 Digite o número da OS para listar os materiais referentes a ela (ex: 25307053):', menu);
});

bot.command('resumo', async (ctx)=>{
  const d = await lerPlanilha();
  let txt = `📊 RESUMO ZROF - MACRO GRUPOS\n\n`;
  txt += `Total de Ordens: ${d.totalOrdens}\n`;
  txt += `⛏️ Macro MINA (M): ${d.totalMina}\n`;
  txt += `🏭 Macro USINA (U): ${d.totalUsina}\n\n`;
  txt += `📍 SETOR - GERAL:\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });
  txt += `\n⛏️ SETOR - MINA:\n`;
  Object.entries(d.porSetorMina).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });
  txt += `\n🏭 SETOR - USINA:\n`;
  Object.entries(d.porSetorUsina).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+= `${k}: ${v}\n`; });
  for (let i=0;i<txt.length;i+=4000){ await ctx.reply(txt.substring(i,i+4000), menu); }
});

bot.on('text', async (ctx)=>{
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/') || ['🔍 Buscar OS','🧩 Materiais OS','📊 Resumo','📈 Dashboard','♻️ Limpar'].includes(texto)) return;

  const userId = ctx.from.id;
  const modo = estadoUsuario[userId];

  // SE ESTIVER NO MODO BUSCA DE MATERIAL
  if(modo === 'AGUARDANDO_OS_MATERIAL'){
    estadoUsuario[userId] = null;
    const osBusca = texto.replace(/\D/g,'');
    const mats = await lerMateriais();
    const lista = mats.porOS[osBusca];
    if(!lista ||!lista.length){
      return ctx.reply(`❌ Nenhum material encontrado para OS ${osBusca}\nTotal de materiais na planilha: ${mats.total}`, menu);
    }
    let txt = `🧩 MATERIAIS - OS ${osBusca} (${lista.length} itens)\n\n`;
    lista.forEach((m,i)=>{
      const pend = (m.qtdRet==='0' || m.qtdRet==='0,000' || m.qtdRet==='' || parseFloat(m.qtdRet.replace(',','.'))===0)? '⚠️ PENDENTE' : '✅';
      txt += `${i+1}) ${pend}\nItem: ${m.item} | Mat: ${m.material}\n${m.txtMat}\nNec: ${m.qtdNec} | Ret: ${m.qtdRet} | PO: ${m.po}\n\n`;
    });
    for (let i=0;i<txt.length;i+=4000){ await ctx.reply(txt.substring(i,i+4000), menu); }
    return;
  }

  // BUSCA NORMAL DE OS (como antes)
  try {
    const busca = texto.toLowerCase(); const { dadosFull } = await lerPlanilha();
    const achadas = dadosFull.filter(d=>d._busca.includes(busca));
    if (!achadas.length) return ctx.reply(`❌ Nada para "${texto}"`, menu);
    for (const item of achadas.slice(0,3)){
      let detalhe = `📋 OS: ${item._os} | Macro: ${item._macro}\n--------------------------\n`;
      for (const [col, val] of Object.entries(item._row)){ if (val && val.trim()) detalhe += `${col}: ${val}\n`; }
      const mats = await lerMateriais();
      const qtdMat = mats.porOS[item._os]?.length || 0;
      if(qtdMat>0){
        detalhe += `\n🧩 ${qtdMat} materiais vinculados. Clique para ver.`;
        await ctx.reply(detalhe.substring(0,4000), Markup.inlineKeyboard([[Markup.button.callback(`Ver ${qtdMat} materiais`,`mat:${item._os}`)]]));
      } else {
        await ctx.reply(detalhe.substring(0,4000), menu);
      }
    }
  } catch(e){ console.log(e.message); }
});

bot.action(/mat:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  const os = ctx.match[1];
  const mats = await lerMateriais();
  const lista = mats.porOS[os];
  if(!lista) return ctx.reply(`Sem materiais para ${os}`, menu);
  let txt = `🧩 MATERIAIS - OS ${os} (${lista.length})\n\n`;
  lista.forEach((m,i)=>{
    const pend = (m.qtdRet==='0' || m.qtdRet==='0,000' || m.qtdRet==='' )? '⚠️ PEND' : '✅';
    txt += `${i+1}) ${pend} Mat:${m.material} ${m.txtMat} Nec:${m.qtdNec} Ret:${m.qtdRet} PO:${m.po}\n\n`;
  });
  for (let i=0;i<txt.length;i+=4000){ await ctx.reply(txt.substring(i,i+4000), menu); }
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">Dashboard</a>'));
app.get('/api/resumo', async (req,res)=>{ res.json(await lerPlanilha()); });
app.get('/dashboard', (req,res)=>res.sendFile(__dirname + '/dash.html'));

const dashHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.grid{grid-template-columns:1fr}}h3{margin:0 0 8px}</style>
</head><body>
<h2 id="titulo">Carregando...</h2>
<div class="grid">
<div class="card"><h3>Macro Grupo (Mina x Usina)</h3><canvas id="cMacro"></canvas></div>
<div class="card"><h3>Ordens por Setor - GERAL</h3><canvas id="cSetor"></canvas></div>
</div>
<div class="grid">
<div class="card"><h3>⛏️ Setor - MINA (M)</h3><canvas id="cSetorMina"></canvas></div>
<div class="card"><h3>🏭 Setor - USINA (U)</h3><canvas id="cSetorUsina"></canvas></div>
</div>
<div class="grid">
<div class="card"><h3>⛏️ Familia - MINA</h3><canvas id="cFamMina"></canvas></div>
<div class="card"><h3>🏭 Familia - USINA</h3><canvas id="cFamUsina"></canvas></div>
</div>
<script>
async function load(){
  const d = await fetch('/api/resumo').then(r=>r.json());
  document.getElementById('titulo').innerText = 'ZROF - Total:'+d.totalOrdens+' | Mina:'+d.totalMina+' | Usina:'+d.totalUsina;
  const sortEntries = (obj)=>Object.entries(obj).sort((a,b)=>b[1]-a[1]);
  new Chart(document.getElementById('cMacro'), {type:'doughnut', data:{labels:Object.keys(d.porMacro), datasets:[{data:Object.values(d.porMacro), backgroundColor:['#38bdf8','#fbbf24']}]}, options:{responsive:true, plugins:{legend:{labels:{color:'#fff'}}}}});
  const makeBar = (id, obj, color)=>{
    const e = sortEntries(obj);
    new Chart(document.getElementById(id), {type:'bar', data:{labels:e.map(x=>x[0]), datasets:[{label:'Ordens', data:e.map(x=>x[1]), backgroundColor:color}]}, options:{responsive:true, plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#fff', maxRotation:45}}, y:{ticks:{color:'#fff'}}}}});
  };
  makeBar('cSetor', d.porSetor, '#a78bfa');
  makeBar('cSetorMina', d.porSetorMina, '#38bdf8');
  makeBar('cSetorUsina', d.porSetorUsina, '#fbbf24');
  makeBar('cFamMina', d.porFamiliaMina, '#34d399');
  makeBar('cFamUsina', d.porFamiliaUsina, '#fb7185');
}
load();
</script>
</body></html>
`;
fs.writeFileSync(__dirname + '/dash.html', dashHtml);
app.use(bot.webhookCallback('/telegram'));
app.listen(PORT, async ()=>{
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (domain) { try { await bot.telegram.setWebhook('https://'+domain+'/telegram'); } catch(e){} }
  else { bot.launch(); }
});