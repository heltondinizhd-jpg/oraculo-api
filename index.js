const express = require('express');
const app = express();
app.use(express.json());

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const ABA_ORDENS = process.env.ABA_ORDENS || 'BD_OS';
const ABA_MATERIAIS = 'BD_MAT';

function parseCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim().toUpperCase());
  return lines.slice(1).map(line => {
    const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^"|"$/g,'').trim());
    const obj = {};
    headers.forEach((h,i) => obj[h] = values[i] || '');
    return obj;
  });
}

async function getSheet(aba) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(aba)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Aba ${aba} não encontrada`);
  return parseCSV(await res.text());
}

function gerarResumo(ordens) {
  const porSetor = {};
  const porStatus = {};
  ordens.forEach(o => {
    const setor = (o['SETOR'] || 'SEM SETOR').toUpperCase();
    const status = (o['STATUS'] || 'SEM STATUS').toUpperCase();
    porSetor[setor] = (porSetor[setor] || 0) + 1;
    porStatus[status] = (porStatus[status] || 0) + 1;
  });

  let txt = `🔮 *RESUMO GERAL* - ${ordens.length} OS\n\n`;
  txt += `*POR SETOR:*\n`;
  Object.entries(porSetor).sort((a,b)=>b[1]-a[1]).forEach(([s,q]) => txt += `▪️ ${s}: *${q}*\n`);

  txt += `\n*POR STATUS:*\n`;
  Object.entries(porStatus).sort((a,b)=>b[1]-a[1]).forEach(([s,q]) => txt += `▪️ ${s}: ${q}\n`);

  txt += `\nDigite "setor NOME" para detalhar. Ex: setor USINAGEM`;
  return txt;
}

function listarPorSetor(ordens, busca) {
  const filtradas = ordens.filter(o => (o['SETOR']||'').toLowerCase().includes(busca.toLowerCase()));
  if (!filtradas.length) return `❌ Nenhuma OS no setor "${busca}"\nSetores existentes: ${[...new Set(ordens.map(o=>o['SETOR']))].join(', ')}`;

  let txt = `📋 *SETOR ${busca.toUpperCase()}* - ${filtradas.length} OS\n\n`;
  filtradas.slice(0,25).forEach(o => {
    txt += `• OS *${o['OS']}* | ${o['SUBCONJUNTO']} | ${o['STATUS']} | Mat: ${o['% MAT. DISP.'] || o['% MAT. DISP'] || '?'} | Pend: ${o['Nº DE PENDENCIA'] || 0}\n`;
  });
  if (filtradas.length > 25) txt += `\n...e mais ${filtradas.length-25} OS`;
  return txt;
}

function formatarOrdem(o, mats) {
  if (!o) return `❌ OS não encontrada`;
  let txt = `🔧 *OS ${o['OS']}* - ${o['SUBCONJUNTO']}\n\n`;
  txt += `📦 Código: ${o['CODIGO']}\n`;
  txt += `🏭 Setor: *${o['SETOR']}*\n`;
  txt += `📊 Status: *${o['STATUS']}*\n`;
  txt += `👨‍👩‍👧‍👦 Grupo: ${o['GRUPO']} | Família: ${o['FAMILIA']}\n`;
  txt += `📅 Emissão: ${o['EMISSÃO'] || o['EMISSAO']}\n`;
  txt += `⏱️ Lead Time: ${o['LEAD TIME']}\n`;
  txt += `📊 Itens: Solicit. ${o['Nº ITENS. SOLIC.']} | Ret. ${o['Nº ITENS. RET.']} | Estoque ${o['Nº MAT. EST.']} | Pedido ${o['EM PEDIDO.']}\n`;
  txt += `⚠️ Pendências: ${o['Nº DE PENDENCIA']} | % Disponível: ${o['% MAT. DISP.']}\n`;

  if (mats && mats.length) {
    txt += `\n📦 *MATERIAIS BD_MAT (${mats.length})*:\n`;
    mats.slice(0,20).forEach(m => {
      // tenta achar colunas comuns da BD_MAT
      const desc = m['MATERIAL'] || m['DESCRICAO'] || m['DESCRIÇÃO'] || m['ITEM'] || m['CODIGO'] || JSON.stringify(m).slice(0,40);
      const qtd = m['QTD'] || m['QUANTIDADE'] || m['QTDE'] || '';
      const statusMat = m['STATUS'] || m['SITUACAO'] || '';
      txt += `• ${desc} ${qtd? `| Qtd: ${qtd}`:''} ${statusMat? `| ${statusMat}`:''}\n`;
    });
    if (mats.length > 20) txt += `...e mais ${mats.length-20} materiais`;
  } else {
    txt += `\n📦 Nenhum material encontrado na BD_MAT para essa OS`;
  }
  return txt;
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

app.get('/', (req,res) => res.send('Oráculo online 🔮 v3 BD_OS + BD_MAT'));
app.post('/webhook/telegram', async (req,res) => {
  try {
    const msg = req.body.message;
    if (!msg?.text) return res.sendStatus(200);
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    let ordens = [];
    try { ordens = await getSheet(ABA_ORDENS); }
    catch {
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
      ordens = parseCSV(await (await fetch(url)).text());
    }

    let resposta = '';
    if (lower.includes('resumo') || lower === 'setores' || lower === '/setores') {
      resposta = gerarResumo(ordens);
    } else if (lower.startsWith('setor')) {
      const busca = text.replace(/setor/gi,'').replace('/','').trim();
      resposta = busca? listarPorSetor(ordens, busca) : gerarResumo(ordens);
    } else {
      const osNum = text.match(/\d+/)?.[0];
      if (osNum) {
        const ordem = ordens.find(o => o['OS'] == osNum);
        let mats = [];
        try {
          const bdmat = await getSheet(ABA_MATERIAIS);
          mats = bdmat.filter(m => Object.values(m).some(v => v == osNum));
        } catch(e){ console.log('BD_MAT erro', e.message); }
        resposta = formatarOrdem(ordem, mats);
      } else {
        resposta = `🤖 *Oráculo Oficina*\n\n• Digite o número da OS (ex: 12345)\n• Digite "setor USINAGEM"\n• Digite "resumo"`;
      }
    }
    await sendTelegram(chatId, resposta);
    res.sendStatus(200);
  } catch(e){ console.error(e); res.sendStatus(200); }
});

app.listen(process.env.PORT || 3000, () => console.log('ON'));