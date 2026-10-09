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
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const r = await axios.get(url, { responseType: 'text', timeout: 25000 });
  return r.data;
}
function parseCSV(text){
  const linhas = text.split(/\r?\n/).filter(l=>l.trim()!=='');
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
    let csv2 = null; try{ csv2 = await getCSV('1'); }catch(e){}
    const p1 = parseCSV(csv1);
    const up1 = p1.cab.map(h=>h.toUpperCase());
    let iOS = up1.indexOf('OS'); if(iOS<0) iOS = up1.findIndex(h=>h.includes('ORDEM'));
    let iSet = up1.findIndex(h=>h.includes('SETOR'));
    let iFam = up1.findIndex(h=>h.includes('FAMILIA')||h.includes('FAMÍLIA'));
    let iGru = up1.findIndex(h=>h.includes('GRUPO'));
    let mapaGeral={}; let mapaMina={}; let mapaUsina={}; let dadosFull=[];
    p1.rows.forEach(cols=>{
      const os = (cols[iOS]||'').replace(/\D/g,''); if(!os) return;
      const setor = (cols[iSet]||'SEM SETOR').toUpperCase().trim();
      const fam = (cols[iFam]||'SEM FAMILIA').toUpperCase().trim();
      const grupo = (cols[iGru]||'').toUpperCase().trim();
      let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; else if(grupo.startsWith('U')) macro='USINA';
      let rowObj={}; p1.cab.forEach((n,idx)=>{ rowObj[n]=cols[idx]||''; });
      dadosFull.push({os, setor, fam, grupo, macro, row:rowObj, busca:cols.join(' ').toLowerCase(), pend:[]});
      if(!mapaGeral[os]) mapaGeral[os]={setor, fam, macro};
      if(macro==='MINA') mapaMina[os]=mapaGeral[os];
      if(macro==='USINA') mapaUsina[os]=mapaGeral[os];
    });

    let pendPorOS={}; let totPend=0;
    if(csv2){
      const p2 = parseCSV(csv2);
      const up2 = p2.cab.map(h=>h.toUpperCase());
      let iOS2 = up2.indexOf('OS');
      let iRet = up2.findIndex(h=>h.includes('RETIRAD')); // Qtd.retirad
      let iItem = up2.findIndex(h=>h.includes('ITEM'));
      let iMat = up2.indexOf('MATERIAL');
      let iTxt = up2.findIndex(h=>h.includes('TEXTO') && h.includes('MATERIAL'));
      let iQtdNec = up2.findIndex(h=>h.includes('NECESS'));
      let iPO = up2.findIndex(h=>h.includes('PO') && h.includes('CONTRATO'));

      p2.rows.forEach(cols=>{
        const os = (cols[iOS2]||'').replace(/\D/g,''); if(!os) return;
        const qtdRetStr = (cols[iRet]||'0').replace('.','').replace(',','.').trim(); // 0,000 -> 0.000
        const qtdRet = parseFloat(qtdRetStr) || 0;
        if(qtdRet === 0){
          const obj = {
            item: cols[iItem] || '',
            material: cols[iMat] || '',
            texto: cols[iTxt] || '',
            qtdNec: cols[iQtdNec] || '',
            po: cols[iPO] || '',
            raw: cols
          };
          if(!pendPorOS[os]) pendPorOS[os]=[];
          pendPorOS[os].push(obj);
          totPend++;
        }
      });
      dadosFull.forEach(d=>{ if(pendPorOS[d.os]) d.pend=pendPorOS[d.os]; });
    }

    const count = (arr, key) => { const o={}; Object.values(arr).forEach(v=>{ const k=v[key]||'SEM'; o[k]=(o[k]||0)+1; }); return o; };
    const res = {
      total: Object.keys(mapaGeral).length, tMina: Object.keys(mapaMina).length, tUsina: Object.keys(mapaUsina).length, totPend,
      porMacro: {MINA:Object.keys(mapaMina).length, USINA:Object.keys(mapaUsina).length},
      porSetor: count(mapaGeral,'setor'), porSetorMina: count(mapaMina,'setor'), porSetorUsina: count(mapaUsina,'setor'),
      porFamMina: count(mapaMina,'fam'), porFamUsina: count(mapaUsina,'fam'), porFamilia: count(mapaGeral,'fam'),
      dadosFull
    };
    cache=res; cacheHora=Date.now(); console.log('OK', res.total, res.tMina, res.tUsina, res.totPend); return res;
  }catch(e){ console.log('ERRO', e.message); return cache; }
}

lerPlanilha();
const menu = Markup.keyboard([['🔍 Buscar OS','📊 Resumo'],['📈 Dashboard','♻️ Limpar']]).resize();
bot.start((ctx)=>ctx.reply('ZROF Online - Mina/Usina + Pendentes!', menu));
bot.hears('📊 Resumo', (ctx)=>{ ctx.message.text='/resumo'; bot.handleUpdate({message:ctx.message}); });
bot.hears('📈 Dashboard', (ctx)=>{ const d=process.env.RENDER_EXTERNAL_HOSTNAME; const url=d?'https://'+d+'/dashboard':'/dashboard'; return ctx.reply('Dashboard: '+url, menu); });
bot.hears('♻️ Limpar', async(ctx)=>{ cache=null; await ctx.reply('Recarregando 2 abas...', menu); const r=await lerPlanilha(); return ctx.reply(`Pronto! Total:${r.total} Mina:${r.tMina} Usina:${r.tUsina} Pend:${r.totPend}`, menu); });
bot.hears('🔍 Buscar OS', (ctx)=>ctx.reply('Digite a OS:', menu));

bot.command('resumo', async(ctx)=>{
  const d=await lerPlanilha();
  let txt = `RESUMO ZROF\nTotal:${d.total} | Mina:${d.tMina} | Usina:${d.tUsina}\nPendentes (Qtd.retirad=0):${d.totPend}\n\nSETOR GERAL:\n`;
  Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{ txt+=k+': '+v+'\n'; });
  for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000), menu);
});

// BOTÃO DE PENDENTES
bot.action(/pend:(.+)/, async(ctx)=>{
  await ctx.answerCbQuery();
  const osAlvo = ctx.match[1];
  const d = await lerPlanilha();
  const item = d.dadosFull.find(x=> x.os === osAlvo);
  if(!item ||!item.pend.length) return ctx.reply(`OS ${osAlvo} sem pendentes (Qtd.retirad=0)`, menu);
  let txt = `📦 MATERIAIS PENDENTES - OS ${osAlvo}\nSetor: ${item.setor} | Macro: ${item.macro}\nTotal pendente (Qtd.retirad=0): ${item.pend.length}\n\n`;
  item.pend.forEach((p,i)=>{
    txt += `${i+1}) Item:${p.item} | Mat:${p.material}\n${p.texto}\nQtd.Nec:${p.qtdNec} | PO:${p.po}\n\n`;
  });
  for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000), menu);
});

bot.on('text', async(ctx)=>{
  const texto = ctx.message.text.trim();
  if(texto.startsWith('/') || texto.includes('Buscar') || texto.includes('Resumo') || texto.includes('Dashboard') || texto.includes('Limpar')) return;
  const d=await lerPlanilha();
  const dig = texto.replace(/\D/g,'');
  const busca = texto.toLowerCase();
  const ach = d.dadosFull.filter(x=> x.busca.includes(busca) || (dig && x.os.includes(dig)) );
  if(!ach.length) return ctx.reply('Nada para '+texto, menu);
  for(const it of ach.slice(0,3)){
    let det = `OS: ${it.os} | Macro: ${it.macro}\nSetor: ${it.setor}\nGrupo: ${it.grupo}\n----------------\n`;
    for(const k in it.row){ if(it.row[k]) det+=k+': '+it.row[k]+'\n'; }
    if(it.pend.length>0){
      det+=`\n⚠️ ${it.pend.length} material(is) com Qtd.retirad=0,000`;
      await ctx.reply(det.substring(0,4000), Markup.inlineKeyboard([[Markup.button.callback(`📦 Ver ${it.pend.length} Pendentes`, `pend:${it.os}`)]]));
    } else {
      det+=`\n✅ Nenhum pendente`; await ctx.reply(det.substring(0,4000), menu);
    }
  }
});

app.get('/', (req,res)=>res.send('OK <a href="/dashboard">dashboard</a>'));
app.get('/api/resumo', async(req,res)=>{ res.json(await lerPlanilha()); });
app.get('/dashboard', (req,res)=>res.sendFile(__dirname+'/dash.html'));

const htmlParts = [
'<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}.card{background:#1e293b;padding:14px;border-radius:14px;margin-bottom:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style></head><body><h2 id="tit">Carregando...</h2><div class="grid"><div class="card"><h3>Macro Mina x Usina</h3><canvas id="cMacro"></canvas></div><div class="card"><h3>Setor Geral</h3><canvas id="cSetor"></canvas></div></div><div class="grid"><div class="card"><h3>Setor Mina</h3><canvas id="cSetorMina"></canvas></div><div class="card"><h3>Setor Usina</h3><canvas id="cSetorUsina"></canvas></div></div><script>async function load(){ const d = await fetch("/api/resumo").then(r=>r.json()); document.getElementById("tit").innerText = "Total:"+d.total+" | Mina:"+d.tMina+" | Usina:"+d.tUsina+" | Pend:"+d.totPend; const sortE = o => Object.entries(o).sort((a,b)=>b[1]-a[1]); function bar(id,obj,color){ const e=sortE(obj); new Chart(document.getElementById(id),{type:"bar",data:{labels:e.map(x=>x[0]),[STRIPPED] } new Chart(document.getElementById("cMacro"),{type:"doughnut",data:{labels:Object.keys(d.porMacro),[STRIPPED] bar("cSetor", d.porSetor, "#a78bfa"); bar("cSetorMina", d.porSetorMina, "#38bdf8"); bar("cSetorUsina", d.porSetorUsina, "#fbbf24");} load(); </script></body></html>'
];
fs.writeFileSync(__dirname+'/dash.html', htmlParts.join(''));
app.use(bot.webhookCallback('/telegram'));
app.listen(PORT, async()=>{
  const dom = process.env.RENDER_EXTERNAL_HOSTNAME;
  if(dom){ try{ await bot.telegram.setWebhook('https://'+dom+'/telegram'); }catch(e){} } else { bot.launch(); }
});