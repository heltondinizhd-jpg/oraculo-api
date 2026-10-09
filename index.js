const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const PORT = process.env.PORT || 3000;
const bot=new Telegraf(BOT_TOKEN);
const app=express();
let cache=null,cHora=0,erro='';

async function getCSV(gid){
 const urls=[`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`,`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`];
 for(let u of urls){ try{ const r=await axios.get(u,{timeout:15000,headers:{'User-Agent':'Mozilla/5.0'}}); if(r.data&&r.data.length>50&&!r.data.includes('<html')) return r.data; }catch(e){erro=e.message} } throw new Error(erro);
}
function parseCSV(t){ const l=t.split(/\r?\n/).filter(x=>x.trim()!=''); const cab=l[0].split(',').map(s=>s.replace(/^"|"$/g,'').trim()); const rows=[]; for(let i=1;i<l.length;i++){ let line=l[i],cols=[],cur='',inQ=false; for(let j=0;j<line.length;j++){ let c=line[j]; if(c=='"'){if(line[j+1]=='"'){cur+='"';j++;}else inQ=!inQ;} else if(c==','&&!inQ){cols.push(cur);cur='';} else cur+=c; } cols.push(cur); rows.push(cols.map(v=>v.replace(/^"|"$/g,'').trim())); } return {cab,rows}; }

async function ler(){
 if(cache&&Date.now()-cHora<120000) return cache;
 try{
  const csv1=await getCSV('0');
  let csv2=null; for(let g of ['1','1957311427','1132978923','2']){ try{ const t=await getCSV(g); if(t.includes('Material')||t.includes('Qtd')){ csv2=t; console.log('BD_MAT gid='+g); break; } }catch(e){} }
  const p1=parseCSV(csv1); const up=p1.cab.map(h=>h.toUpperCase());
  let iOS=up.findIndex(h=>h=='OS'||h.includes('ORDEM')), iSet=up.findIndex(h=>h.includes('SETOR')), iFam=up.findIndex(h=>h.includes('FAMILIA')||h.includes('FAM')), iGru=up.findIndex(h=>h.includes('GRUPO'));
  let dados=[],mapG={},mapM={},mapU={},pendPorOS={},totPend=0;
  p1.rows.forEach(c=>{ const os=(c[iOS]||'').replace(/\D/g,''); if(!os) return; const setor=(c[iSet]||'SEM').toUpperCase(), grupo=(c[iGru]||'').toUpperCase(); let macro='OUTROS'; if(grupo.startsWith('M')) macro='MINA'; if(grupo.startsWith('U')) macro='USINA'; let row={}; p1.cab.forEach((n,i)=>row[n]=c[i]||''); dados.push({os,setor,grupo,macro,row,busca:c.join(' ').toLowerCase(),pend:[]}); if(!mapG[os]) mapG[os]={setor,macro}; if(macro=='MINA') mapM[os]=1; if(macro=='USINA') mapU[os]=1; });
  if(csv2){
   const p2=parseCSV(csv2);
   p2.rows.forEach(c=>{
    if(c.length<8) return; const os=(c[0]||'').replace(/\D/g,''); if(!os) return;
    const qtdRet=(c[6]||'').trim(); const clean=qtdRet.replace(/\./g,'').replace(',','.'); const num=parseFloat(clean);
    if(qtdRet==''||qtdRet=='0'||qtdRet=='0,000'||num===0){
     if(!pendPorOS[os]) pendPorOS[os]=[]; pendPorOS[os].push({item:c[2]||'',material:c[3]||'',texto:c[4]||'',qtdNec:c[5]||'',qtdRet:qtdRet,po:c[7]||''}); totPend++;
    }
   });
   dados.forEach(d=>{ if(pendPorOS[d.os]) d.pend=pendPorOS[d.os]; });
  }
  const porSetor={}; Object.values(mapG).forEach(v=>{porSetor[v.setor]=(porSetor[v.setor]||0)+1;});
  const res={total:Object.keys(mapG).length,tMina:Object.keys(mapM).length,tUsina:Object.keys(mapU).length,totPend,porSetor,dados}; cache=res; cHora=Date.now(); console.log('OK total='+res.total+' pend='+res.totPend); return res;
 }catch(e){ erro=e.message; console.log('ERRO '+erro); return cache; }
}
ler();
const menu=Markup.keyboard([['Buscar OS','Resumo'],['Dashboard','Limpar']]).resize();
bot.start(c=>c.reply('ZROF Online! Mande a OS (ex: 25292904)',menu));
bot.hears('Resumo',async ctx=>{ const d=await ler(); if(!d) return ctx.reply('Erro: '+erro,menu); let t=`RESUMO ZROF\nTotal OS:${d.total} Mina:${d.tMina} Usina:${d.tUsina}\nTotal pend materiais:${d.totPend}\n\n`; Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>t+=`${k}: ${v}\n`); ctx.reply(t,menu); });
bot.hears('Limpar',async ctx=>{ cache=null; await ctx.reply('Recarregando planilha...',menu); const d=await ler(); ctx.reply(d?`OK! Total:${d.total} Pend:${d.totPend}`:`Erro ${erro}`,menu); });
bot.hears('Dashboard',c=>c.reply('https://oraculo-api-7ozv.onrender.com/dashboard',menu));
bot.hears('Buscar OS',c=>c.reply('Digite a OS:',menu));
bot.action(/pend:(.+)/,async ctx=>{ await ctx.answerCbQuery(); const os=ctx.match[1]; const d=await ler(); const it=d.dados.find(x=>x.os===os); if(!it) return; let txt=`PENDENTES OS ${os} (${it.pend.length})\n`; it.pend.forEach((p,i)=>{ txt+=`${i+1}) Item:${p.item} Mat:${p.material}\n${p.texto}\nNec:${p.qtdNec} Ret:${p.qtdRet} PO:${p.po}\n\n`; }); for(let i=0;i<txt.length;i+=4000) await ctx.reply(txt.substring(i,i+4000),menu); });
bot.on('text',async ctx=>{
 const t=ctx.message.text.trim(); if(t.startsWith('/')||['Buscar OS','Resumo','Dashboard','Limpar'].includes(t)) return;
 const d=await ler(); if(!d) return ctx.reply('Carregando... '+erro,menu);
 const dig=t.replace(/\D/g,''); const busca=t.toLowerCase(); const ach=d.dados.filter(x=>x.busca.includes(busca)||(dig&&x.os.includes(dig)));
 if(!ach.length) return ctx.reply('Nada para '+t,menu);
 for(const it of ach.slice(0,2)){ let det=`OS: ${it.os}\nSetor: ${it.setor} Macro: ${it.macro}\n`; for(const k in it.row){ if(it.row[k]) det+=`${k}: ${it.row[k]}\n`; } if(it.pend.length>0){ det+=`\n⚠️ PENDENCIAS: ${it.pend.length} materiais com retirada 0`; await ctx.reply(det.substring(0,4000),Markup.inlineKeyboard([[Markup.button.callback(`Ver ${it.pend.length} Pend`,`pend:${it.os}`)]])); } else await ctx.reply(det.substring(0,4000),menu); }
});
app.get('/api/resumo',async(r,s)=>{ const d=await ler(); s.json(d?{total:d.total,pend:d.totPend,porSetor:d.porSetor}:{erro:'loading',erro}); });
app.get('/dashboard',(req,res)=>{ res.send(`<html><head><meta name="viewport" content="width=device-width"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>body{font-family:Arial;padding:15px;background:#f5f5f5}.card{background:#fff;padding:15px;border-radius:12px;margin-bottom:12px}</style></head><body><h2>ZROF Dashboard</h2><div class="card"><div id="nums">loading</div></div><div class="card"><canvas id="s"></canvas></div><div class="card"><canvas id="m"></canvas></div><script>fetch('/api/resumo').then(r=>r.json()).then(d=>{document.getElementById('nums').innerHTML='Total: <b>'+d.total+'</b> Pend Mat: <b>'+d.pend+'</b>'; const so=Object.entries(d.porSetor).sort((a,b)=>b[1]-a[1]); new Chart(document.getElementById('s'),{type:'bar',data:{labels:so.map(x=>x[0]),datasets:[{label:'OS por Setor',data:so.map(x=>x[1])}]}}); })</script></body></html>`); });
app.get('/',(r,s)=>s.send('OK'));
app.listen(PORT,()=>console.log('WEB ON')); (async()=>{try{await bot.telegram.deleteWebhook({drop_pending_updates:true});}catch(e){} bot.launch().then(()=>console.log('BOT ON'));})();