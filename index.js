const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN) process.exit(1);

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
      if (!cabecalho) { cabecalho = rows[0].map(h=>h.replace(/"/g,'').trim()); allDataRows.push(...rows.slice(1)); }
      else { allDataRows.push(...rows); }
      if (rows.length < 1000) break;
      offset += 1000; if (offset > 15000) break;
    } catch (e) { break; }
  }
  const cabUpper = cabecalho.map(h=>h.toUpperCase());
  const idxEmissao = cabUpper.findIndex(h=>h.includes('EMISS'));
  const idxLead = cabUpper.findIndex(h=>h.includes('LEAD'));
  const idxQtd = cabUpper.findIndex(h=>h.includes('QTD') && h.includes('RETIRADA'));
  const idxOS = cabUpper.findIndex(h=>h==='OS');
  const idxSetor = cabUpper.findIndex(h=>h.includes('SETOR'));
  const idxStatus = cabUpper.findIndex(h=>h.includes('STATUS'));

  const dados = allDataRows.map(cols=>{
    let obj = {}; cabecalho.forEach((h, idx)=>{ obj[h]=(cols[idx]||'').replace(/^"|"$/g,'').trim(); });
    let lead = 0;
    if(idxLead>=0){ const num = parseInt(String(obj[cabecalho[idxLead]]||'').replace(/[^0-9\-]/g,'')); if(!isNaN(num)) lead=num; }
    let qtd = 0;
    if(idxQtd>=0){ qtd = parseFloat(String(obj[cabecalho[idxQtd]]||'0').replace(',','.'))||0; }
    obj._leadTime=lead; obj._qtd=qtd; obj._os=obj[cabecalho[idxOS]]||''; obj._setor=idxSetor>=0?obj[cabecalho[idxSetor]]:''; obj._status=idxStatus>=0?obj[cabecalho[idxStatus]]:'';
    obj._emissaoRaw=idxEmissao>=0?obj[cabecalho[idxEmissao]]:''; obj._textoBusca=Object.values(obj).join(' ').toLowerCase();
    return obj;
  }).filter(o=>o._os);

  const res={cabecalho,dados,idxQtd}; cachePlanilha={dados:res,hora:Date.now()};
  console.log('LIDO: '+dados.length+' linhas | OS unicas: '+new Set(dados.map(d=>d._os)).size);
  return res;
}

// MENU COM DASHBOARD DE VOLTA
const menu = Markup.keyboard([['OS','CÓDIGO','FAMÍLIA'],['SETOR','STATUS','/resumo'],['/alertas','/dashboard']]).resize();

bot.start((ctx) => ctx.reply('Bot ZROF - Online', menu));
bot.command('limpar', (ctx) => { cachePlanilha={dados:null,hora:0}; return ctx.reply('Cache limpo!', menu); });
bot.command('dashboard', (ctx) => {
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  const url = domain? `https://${domain}/dashboard` : `/dashboard`;
  return ctx.reply(`Dashboard: ${url}`, menu);
});
bot.command('resumo', async (ctx) => {
  const { dados } = await lerPlanilhaCompleta();
  const unicas = [...new Map(dados.map(d=>[d._os,d])).values()];
  let txt = `RESUMO: ${unicas.length} OS unicas / ${dados.length} materiais\n`;
  const porSetor={}; unicas.forEach(d=>{ porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
  Object.entries(porSetor).forEach(([k,v])=> txt+= `${k}: ${v}\n`);
  return ctx.reply(txt.substring(0,4096), menu);
});
bot.command('alertas', async (ctx) => {
  const { dados } = await lerPlanilhaCompleta();
  const unicas = [...new Map(dados.map(d=>[d._os,d])).values()];
  const imediatas = unicas.filter(d=>d._leadTime >= 180).sort((a,b)=>b._leadTime - a._leadTime);
  if (imediatas.length===0) return ctx.reply('Nenhuma OS >=180d', menu);
  let txt = `ALERTAS LEAD > 120d: ${unicas.filter(d=>d._leadTime>=120).length} OS\n\nIMEDIATA (>=180d):\n`;
  imediatas.slice(0,30).forEach(o=> txt+= `OS ${o._os} | ${o._leadTime}d | ${o._setor}\n`);
  return ctx.reply(txt.substring(0,4096), menu);
});
bot.hears(['OS','CÓDIGO','FAMÍLIA','SETOR','STATUS'], (ctx) => {
  const mapa = { 'OS':'OS','CÓDIGO':'CODIGO','FAMÍLIA':'FAMILIA','SETOR':'SETOR','STATUS':'STATUS' };
  esperandoFiltro[ctx.from.id]=mapa[ctx.message.text];
  return ctx.reply('Digite o valor para '+ctx.message.text+':');
});
bot.on('text', async (ctx) => {
  try {
    const textoOriginal = ctx.message.text.trim(); if (textoOriginal.startsWith('/')) return;
    if (['OS','CÓDIGO','FAMÍLIA','SETOR','STATUS'].includes(textoOriginal)) return;
    const id = ctx.from.id; const texto = textoOriginal.toLowerCase();
    const { cabecalho, dados } = await lerPlanilhaCompleta();
    const filtroAtivo = esperandoFiltro[id];
    let encontradas = filtroAtivo? dados.filter(d=>(d[filtroAtivo]||'').toLowerCase().includes(texto)) : dados.filter(d=>d._textoBusca.includes(texto));
    delete esperandoFiltro[id];
    if (encontradas.length===0) return ctx.reply('Nada para "'+textoOriginal+'"', menu);
    if (encontradas.length<=20) {
      for (const os of encontradas) {
        let r = `OS ${os._os} | QTD RET: ${os._qtd} ${os._qtd==0?'(PENDENTE)':''}\n`;
        cabecalho.slice(0,10).forEach(col=>{ r+= `${col}: ${os[col]||'-'}\n`; });
        await ctx.reply(r.substring(0,4096));
      }
      return ctx.reply(`Total: ${encontradas.length} linhas`, menu);
    } else {
      return ctx.reply(`${encontradas.length} linhas encontradas para "${textoOriginal}". Use /dashboard para ver completo.`, menu);
    }
  } catch(e){ return ctx.reply('Erro na busca', menu); }
});

// DASHBOARD 2 ABAS
app.get('/dashboard', async (req,res)=>{
  try{
    const { cabecalho, dados } = await lerPlanilhaCompleta();
    const osUnicas = [...new Map(dados.map(d=>[d._os,d])).values()];
    const porSetor={}; osUnicas.forEach(d=>{ porSetor[d._setor]=(porSetor[d._setor]||0)+1; });
    const porStatus={}; osUnicas.forEach(d=>{ porStatus[d._status]=(porStatus[d._status]||0)+1; });
    const a180=osUnicas.filter(d=>d._leadTime>=180).length;
    const a150=osUnicas.filter(d=>d._leadTime>=150&&d._leadTime<180).length;
    const a120=osUnicas.filter(d=>d._leadTime>=120&&d._leadTime<150).length;
    const pendentesTotal = dados.filter(d=>d._qtd==0).length;

    res.send(`
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>body{font-family:system-ui;background:#0f172a;color:#fff;padding:12px}.tabs{display:flex;gap:8px;margin-bottom:12px}.tab{padding:10px 16px;background:#1e293b;border-radius:12px;cursor:pointer}.tab.active{background:#38bdf8;color:#000;font-weight:bold}.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:12px}.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr} input{padding:10px;border-radius:8px;border:none;width:180px} button{padding:10px 16px;border-radius:8px;border:none;background:#38bdf8;font-weight:bold;cursor:pointer;margin-left:6px} table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border:1px solid #334155;padding:6px;font-size:11px;text-align:left}.pend{background:#7f1d1d;color:#fecaca;font-weight:bold}</style>
    </head><body>
    <h2>ZROF - ${osUnicas.length} OS / ${dados.length} materiais</h2>
    <div class="tabs"><div class="tab active" onclick="showTab(1)">📊 Dashboard</div><div class="tab" onclick="showTab(2)">📦 Material Pendente (Qtd.retirada=0)</div></div>
    <div id="tab1"><div class="grid"><div class="card"><canvas id="c1"></canvas></div><div class="card"><canvas id="c2"></canvas></div><div class="card"><canvas id="c3"></canvas></div><div class="card"><h3>Resumo</h3><p>180d+: ${a180}</p><p>150-179d: ${a150}</p><p>120-149d: ${a120}</p><p>Materiais pendentes (geral): ${pendentesTotal}</p></div></div></div>
    <div id="tab2" style="display:none"><div class="card"><h3>Consulta por OS - retorna todas as linhas</h3><input id="buscaOS" placeholder="Digite a OS"><button onclick="buscar()">Buscar</button><button onclick="buscarPend()">Só pendentes</button><div id="resultado"></div></div></div>
    <script>
      const dados = ${JSON.stringify(dados.slice(0,5000))};
      const cab = ${JSON.stringify(cabecalho)};
      function showTab(n){ document.getElementById('tab1').style.display=n==1?'block':'none'; document.getElementById('tab2').style.display=n==2?'block':'none'; document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active', i==n-1)); }
      new Chart(document.getElementById('c1'),{type:'bar',data:{labels:${JSON.stringify(Object.keys(porSetor))},[STRIPPED]
      new Chart(document.getElementById('c2'),{type:'doughnut',data:{labels:${JSON.stringify(Object.keys(porStatus))},[STRIPPED]
      new Chart(document.getElementById('c3'),{type:'bar',data:{labels:['180+',[STRIPPED]
      function render(lista){
        if(!lista.length){ document.getElementById('resultado').innerHTML='<p>Nenhuma linha encontrada</p>'; return; }
        let html='<p>Total: '+lista.length+' materiais | Pendentes: '+lista.filter(d=>d._qtd==0).length+'</p><div style="overflow:auto"><table><tr>'; cab.forEach(h=>html+='<th>'+h+'</th>'); html+='</tr>';
        lista.forEach(d=>{ const cls=d._qtd==0?'class="pend"':''; html+='<tr '+cls+'>'; cab.forEach(h=>html+='<td>'+(d[h]||'')+'</td>'); html+='</tr>'; }); html+='</table></div>';
        document.getElementById('resultado').innerHTML=html;
      }
      function buscar(){ const os=document.getElementById('buscaOS').value.trim().toLowerCase(); if(!os) return; const filtrados=dados.filter(d=>String(d._os||'').toLowerCase().includes(os)); render(filtrados); }
      function buscarPend(){ const os=document.getElementById('buscaOS').value.trim().toLowerCase(); if(!os) return; const filtrados=dados.filter(d=>String(d._os||'').toLowerCase().includes(os) && d._qtd==0); render(filtrados); }
    </script></body></html>`);
  }catch(e){ res.status(500).send('Erro dashboard: '+e.message); }
});

app.get('/', (req,res)=>res.send('Bot ZROF online - <a href="/dashboard">Dashboard</a>'));
app.use(bot.webhookCallback('/telegram'));

app.listen(PORT, async () => {
  console.log('Web ok porta '+PORT);
  const domain = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (domain) {
    try { await bot.telegram.setWebhook('https://'+domain+'/telegram'); console.log('Webhook ok'); } catch(e){ console.error(e.message); }
  } else { bot.launch(); }
});