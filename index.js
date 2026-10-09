app.get('/dashboard', async (req,res)=>{
  res.send(`
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{background:#0f172a;color:#fff;font-family:system-ui;padding:12px}
.card{background:#1e293b;padding:16px;border-radius:16px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.big{font-size:26px;font-weight:800}
.label{opacity:.7;font-size:12px}
@media(max-width:800px){.grid,.kpis{grid-template-columns:1fr}}
</style></head><body>
<h2>ZROF Dashboard V13 - FIX GRAFICO</h2>
<div class="kpis">
<div class="card"><div class="label">Total de ordens</div><div class="big" id="tOrd">...</div></div>
<div class="card"><div class="label">Ordens Mina</div><div class="big" id="tMina">...</div></div>
<div class="card"><div class="label">Ordens Usina</div><div class="big" id="tUsina">...</div></div>
<div class="card"><div class="label">Materiais pendentes</div><div class="big" id="tPend">...</div></div>
</div>
<div class="grid">
<div class="card"><h3>Macro Mina x Usina</h3><canvas id="cMacro"></canvas></div>
<div class="card"><h3>Setor Geral</h3><canvas id="cSetor"></canvas></div>
</div>
<div class="grid">
<div class="card"><h3>Setor MINA</h3><canvas id="cSetorMina"></canvas></div>
<div class="card"><h3>Setor USINA</h3><canvas id="cSetorUsina"></canvas></div>
</div>
<div class="card"><h3>Familia Top</h3><canvas id="cFam"></canvas></div>
<script>
async function load(){
  const r = await fetch('/api/resumo'); 
  const j = await r.json();
  const d = j.d || j; 
  const m = j.m || {total:0,totalPend:0};
  // Se vier no formato antigo {d,m} usa, se vier direto usa d
  const dd = d.dados ? d.dados : d;
  const mm = m;
  const porMacro = dd.porMacro || d.porMacro || {};
  const porSetor = dd.porSetor || d.porSetor || {};
  const porSetorMina = dd.porSetorMina || d.porSetorMina || {};
  const porSetorUsina = dd.porSetorUsina || d.porSetorUsina || {};
  const porFamilia = dd.porFamilia || d.porFamilia || {};
  
  document.getElementById('tOrd').innerText = dd.totalOrdens || d.totalOrdens || 0;
  document.getElementById('tMina').innerText = dd.totalMina || d.totalMina || 0;
  document.getElementById('tUsina').innerText = dd.totalUsina || d.totalUsina || 0;
  document.getElementById('tPend').innerText = (mm.totalPend||0) + '/' + (mm.total||0);

  function sortE(o){return Object.entries(o||{}).sort((a,b)=>b[1]-a[1]);}
  
  new Chart(document.getElementById('cMacro'),{
    type:'doughnut',
    data:{labels:Object.keys(porMacro),datasets:[{data:Object.values(porMacro),backgroundColor:['#38bdf8','#fbbf24']}]}
  });
  
  function makeBar(id,obj,color){
    const e=sortE(obj).slice(0,12);
    new Chart(document.getElementById(id),{
      type:'bar',
      data:{labels:e.map(x=>x[0]),datasets:[{data:e.map(x=>x[1]),backgroundColor:color}]},
      options:{indexAxis:'y',plugins:{legend:{display:false}}}
    });
  }
  makeBar('cSetor',porSetor,'#a78bfa');
  makeBar('cSetorMina',porSetorMina,'#38bdf8');
  makeBar('cSetorUsina',porSetorUsina,'#fbbf24');
  makeBar('cFam',porFamilia,'#34d399');
}
load();
</script>
</body></html>
`);
});