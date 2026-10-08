const express = require('express');
const app = express();
app.use(express.json());

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const ABA = 'DB_ORDENS';

function parseCSV(csv) {
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

async function getSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(ABA)}`;
  const res = await fetch(url);
  const txt = await res.text();
  return parseCSV(txt);
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

app.get('/', (req,res) => res.send('Oráculo online 🔮 DB_ORDENS'));
app.post('/webhook/telegram', async (req,res) => {
  try {
    const msg = req.body.message;
    if (!msg?.text) return res.sendStatus(200);
    const chatId = msg.chat.id;

    const ordens = await getSheet();
    const osNum = msg.text.match(/\d+/)?.[0];

    let resposta = '';
    if (osNum) {
      const o = ordens.find(x => x['OS'] == osNum);
      if (o) {
        resposta = `🔧 *OS ${o['OS']}*\n${o['SUBCONJUNTO']}\n\n📦 Código: ${o['CODIGO']}\n🏭 Setor: *${o['SETOR']}*\n📊 Status: *${o['STATUS']}*\n⚠️ Pend: ${o['Nº DE PENDENCIA']} | Disp: ${o['% MAT. DISP.']}`;
      } else {
        resposta = `❌ OS ${osNum} não encontrada`;
      }
    } else {
      resposta = `🤖 Digite o número da OS. Ex: 1025`;
    }

    await sendTelegram(chatId, resposta);
    res.sendStatus(200);
  } catch(e) {
    console.error(e);
    res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => console.log('ON'));