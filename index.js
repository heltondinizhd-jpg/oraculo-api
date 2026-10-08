async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;

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
    return rows.filter(r => r.join('').trim()!=='');
  }

  let allDataRows = [];
  let cabecalho = null;
  let offset = 0;
  const limit = 1000;

  while (true) {
    const tq = `SELECT * LIMIT ${limit} OFFSET ${offset}`;
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&tq=${encodeURIComponent(tq)}`;
    const { data } = await axios.get(url, { responseType: 'text' });
    const rows = await parseCSV(data);
    if (rows.length === 0) break;

    if (!cabecalho) {
      cabecalho = rows[0].map(h => h.replace(/"/g,'').trim().toUpperCase());
      allDataRows.push(...rows.slice(1));
    } else {
      // Se já tem cabeçalho, verifica se veio cabeçalho de novo
      const firstRowIsHeader = rows[0].join(',').toUpperCase().includes('OS');
      allDataRows.push(...(firstRowIsHeader? rows.slice(1) : rows));
    }
    console.log(`Lote offset ${offset}: ${rows.length} linhas`);
    if (rows.length < limit) break; // acabou
    offset += limit;
    if (offset > 10000) break; // segurança
  }

  const idxEmissao = cabecalho.findIndex(h => h.includes('EMISS'));
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dados = allDataRows.map(cols => {
    let obj = {};
    cabecalho.forEach((h, idx) => obj[h] = (cols[idx] || '').replace(/^"|"$/g,'').trim());
    const emissaoStr = idxEmissao >=0? (cols[idxEmissao] || '') : '';
    let lead = 0;
    const m = emissaoStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let dia=parseInt(m[1]), mes=parseInt(m[2])-1, ano=parseInt(m[3]); if(ano<100) ano+=2000;
      const dEmissao = new Date(ano, mes, dia); dEmissao.setHours(0,0,0,0);
      if(!isNaN(dEmissao)) lead = Math.floor((hoje - dEmissao)/(1000*60*60*24));
    }
    obj._leadTime = lead; obj._emissaoRaw = emissaoStr; obj._textoBusca = Object.values(obj).join(' ').toLowerCase();
    return obj;
  }).filter(o => Object.values(o).join('').trim()!=='');

  console.log(`TOTAL FINAL: ${dados.length} OS lidas`);
  const res = { cabecalho, dados };
  cachePlanilha = { dados: res, hora: Date.now() };
  return res;
}