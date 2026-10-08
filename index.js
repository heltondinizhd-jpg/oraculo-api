const express = require('express');
const app = express();
app.use(express.json());

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const ABA_ORDENS = 'DB_ORDENS';
const ABA_MATERIAIS = 'BD_MAT';

function parseCSV(csv) {
  // Suporta vírgula e ponto-e-vírgula (Brasil)
  const delim = csv.includes(';') && csv.split('\n')[0].split(';').length > csv.split('\n')[0].split(',').length? ';' : ',';
  const lines = csv.split('\n').filter(l => l.trim());
  const headers = lines[0].split(delim).map(h => h.replace(/"/g,'').trim().toUpperCase());
  return lines.slice(1).map(line => {
    const values = line.split(delim).map(v => v.replace(/^"|"$/g,'').trim());
    const obj = {};
    headers.forEach((h,i) => obj[h] = values[i] || '');
    return obj;
  });
}

async function getSheet(aba) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(aba)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Aba ${aba} erro ${res.status}`);
  const txt = await res.text();
  console.log(`Aba ${aba} OK - ${txt.length} chars`);
  return parseCSV(txt);
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
  let txt = `🔮 *RESUMO - ${ordens.length} OS (DB_ORDENS)*\n\n*POR SETOR:*\n`;
  Object.entries(porSetor).sort((a,b)=>b[1]-a[1]).forEach(([s,q]) => txt += `▪️ ${s}: *${q}*\n`);
  txt += `\n*POR STATUS:*\n`;
  Object.entries(porStatus).forEach(([s,q]) => txt += `▪️ ${s}: ${q}\n`);
  return txt;
}

function listarPorSetor(ordens, busca) {
  const filtradas = ordens.filter(o => (o['SETOR']||'').toLowerCase().includes(busca.toLowerCase()));
  if (!filtradas.length) return `❌ Nenhuma OS no setor "${busca}"`;
  let txt = `📋 *SETOR ${busca.toUpperCase()}* - ${filtradas.length} OS\n\n`;
  filtradas.slice(0,25).forEach(o => {
    txt += `• OS *${o['OS']}* | ${o['SUBCONJUNTO']?.slice(0,25)} | ${o['STATUS']} | Disp: ${o['% MAT. DISP.'] || ''} | Pend: ${o['Nº DE PENDENCIA']}\n`;
  });
  return txt;
}

function formatarOrdem(o, mats) {
  if (!o) return `❌ OS não encontrada na DB_ORDENS`;
  let txt = `🔧 *OS ${o['OS']}*\n${o['SUBCONJUNTO']}\n\n`;
  txt += `📦 Código: ${o['CODIGO']}\n🏭 Setor: *${o['SETOR']}*\n📊 Status: *${o['STATUS']}*\n`;
  txt += `👨‍👩‍👧‍👦 Grupo: ${o['GRUPO']} | Fam: ${o['FAMILIA']}\n📅 Emissão: ${o['EMISSÃO']}\n⏱️ Lead: ${o['LEAD TIME']}\n`;
  txt += `📊 Solic: ${o['Nº ITENS. SOLIC.']} | Ret: ${o['Nº ITENS. RET.']} | Est: ${o['Nº MAT. EST.']} | Ped: ${o['EM PEDIDO.']}\n`;
  txt += `⚠️ Pend: ${o['Nº DE PENDENCIA']} | Disp: ${o['% MAT. DISP.']}\n`;

  if (mats.length) {
    txt += `\n📦 *MATERIAIS BD_MAT (${mats.length})*:\n`;
    mats.slice(0,20).forEach(m => {
      const keys = Object.keys(m).join(' | ');
      const desc = m['MATERIAL'] || m['DESCRICAO'] || m['DESCRIÇÃO'] || m['ITEM'] || m['SUBCONJUNTO'] || m['CODIGO'] || keys.slice(0,50);
      txt += `• ${desc}\n`;
    });
  } else {
    txt += `\n📦 Sem materiais na BD_MAT para essa OS`;
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

app.get('/', (req,res) => res.send('Oráculo online 🔮 DB_ORDENS + BD_MAT'));
app.post('/webhook/telegram', async (req,res) => {
  try {
    const msg = req.body.message;
    if (!msg?.text) return res.sendStatus(200);
    const chatId = msg.chat.id;
    const text = msg.text.trim().toLowerCase();

    const ordens = await getSheet(ABA_ORDENS);
    let resposta = '';

    if (text.includes('resumo') || text === 'setores') {
      resposta = gerarResumo(ordens);
    } else if (text.startsWith('setor')) {
      const busca = msg.text.replace(/setor/gi,'').trim();
      resposta = busca? listarPorSetor(ordens, busca) : gerarResumo(ordens);
    } else {
      const osNum = msg.text.match(/\d+/)?.[0];
      if (osNum) {
        const ordem = ordens.find(o => o['OS'] == osNum);
        let mats = [];
        try {
          const bdmat = await getSheet(ABA_MATERIAIS);
          mats = bdmat.filter(m => Object.values(m).some(v => v == osNum));
        } catch(e){ console.log('BD_MAT erro', e.message); }
        resposta = formatarOrdem(ordem, mats);
      } else {
        resposta = `🤖 *Oráculo*\n\n• Digite OS (ex: 1025)\n• "setor pintura"\n• "resumo"`;
      }
    }
    await sendTelegram(chatId, resposta);
    res.sendStatus(200);
  } catch(e){ console.error(e); res.sendStatus(200); }
});

app.listen(process.env.PORT || 3000, () => console.log('ON'));