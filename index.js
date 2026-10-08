const express = require('express');
const app = express();
app.use(express.json());

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const ABA = 'DB_ORDENS';

function parseCSV(csv) {
  const delim = csv.includes(';') && csv.split('\n')[0].split(';').length > 1? ';' : ',';
  const lines = csv.split('\n').filter(l => l.trim());
  const headers = lines[0].split(delim).map(h => h.replace(/"/g,'').trim().toUpperCase());
  return { headers, data: lines.slice(1).map(line => {
    const values = line.split(delim).map(v => v.replace(/^"|"$/g,'').trim());
    const obj = {};
    headers.forEach((h,i) => obj[h] = values[i] || '');
    return obj;
  })};
}

async function getSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(ABA)}`;
  const res = await fetch(url);
  const txt = await res.text();
  console.log('CSV cru:', txt.slice(0,500));
  return parseCSV(txt);
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

app.get('/', (req,res) => res.send('Diagnóstico 🔮'));
app.post('/webhook/telegram', async (req,res) => {
  try {
    const msg = req.body.message;
    if (!msg?.text) return res.sendStatus(200);
    const chatId = msg.chat.id;

    const parsed = await getSheet();
    const ordens = parsed.data;
    const osNum = msg.text.match(/\d+/)?.[0] || '';

    let resposta = `📊 Diagnóstico:\nHeaders: ${parsed.headers.join(' | ')}\nTotal linhas: ${ordens.length}\n`;
    resposta += `Primeiras OS que achei: ${ordens.slice(0,3).map(o=>o['OS']).join(', ')}\n`;
    resposta += `Você buscou: ${osNum}\n`;

    const o = ordens.find(x => String(x['OS']).trim() == String(osNum).trim());
    if (o) {
      resposta += `\n✅ ACHOU! OS ${o['OS']} | Setor ${o['SETOR']}`;
    } else {
      resposta += `\n❌ Não achei. Tenta copiar exatamente uma dessas: ${ordens.slice(0,5).map(o=>o['OS']).join(', ')}`;
    }

    await sendTelegram(chatId, resposta);
    res.sendStatus(200);
  } catch(e) {
    console.error(e);
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: req.body.message.chat.id, text: `ERRO: ${e.message}\nSHEET_ID: ${SHEET_ID?.slice(0,10)}...` })
    });
    res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => console.log('ON'));