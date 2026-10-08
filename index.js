async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
  const { data } = await axios.get(url, { responseType: 'text' });

  function parseCSV(text) {
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
    return rows;
  }

  const allRows = parseCSV(data).filter(r => r.join('').trim()!== '');
  const cabecalho = allRows[0].map(h => h.replace(/"/g,'').trim().toUpperCase());
  const idxEmissao = cabecalho.findIndex(h => h.includes('EMISS'));
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  const dados = [];
  for(let i=1; i < allRows.length; i++) {
    const cols = allRows[i];
    let obj = {};
    cabecalho.forEach((h, idx) => obj[h] = (cols[idx] || '').replace(/^"|"$/g,'').trim());
    if (Object.values(obj).join('').trim() === '') continue;

    // --- CALCULO DE LEAD TIME CORRIGIDO ---
    const emissaoStr = idxEmissao >=0? (cols[idxEmissao] || '') : (obj['EMISSÃO'] || '');
    let lead = 0;
    const m = emissaoStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let dia = parseInt(m[1]), mes = parseInt(m[2])-1, ano = parseInt(m[3]);
      if (ano < 100) ano += 2000;
      const dEmissao = new Date(ano, mes, dia); dEmissao.setHours(0,0,0,0);
      if (!isNaN(dEmissao)) lead = Math.floor((hoje - dEmissao) / (1000*60*60*24));
    }
    obj._leadTime = lead;
    obj._emissaoRaw = emissaoStr;
    obj._textoBusca = Object.values(obj).join(' ').toLowerCase();
    dados.push(obj);
  }
  console.log(`Lido: ${dados.length} OS | Coluna EMISSÃO = ${cabecalho[idxEmissao]}`);
  const res = { cabecalho, dados };
  cachePlanilha = { dados: res, hora: Date.now() };
  return res;
}