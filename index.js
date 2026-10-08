const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

async function buscarOrdem(numeroPedido) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
    const res = await axios.get(url);
    const txt = res.data.replace('/*O_o*/','').replace('google.visualization.Query.setResponse(','').slice(0,-2);
    const json = JSON.parse(txt);
    const cols = json.table.cols.map(c => c.label);
    const rows = json.table.rows;
    for (let r of rows) {
      const numOrdem = r.c[0]?.v?.toString().trim();
      if (numOrdem === numeroPedido.toString().trim()) {
        let resposta = `🔮 *ORÁCULO - ORDEM ${numOrdem}*\n\n`;
        for (let i = 1; i < r.c.length; i++) {
          const nomeCol = cols[i] || `Coluna ${i+1}`;
          const valor = r.c[i]?.v?.toString() || '-';
          resposta += `*${nomeCol}:* ${valor}\n`;
        }
        return resposta;
      }
    }
    return null;
  } catch (e) { console.log('Erro planilha', e.message); return null; }
}

app.get('/', (req,res)=> res.send('Oráculo online 🔮'));

app.post('/webhook/telegram', async (req,res)=>{
  const msg = req.body.message;
  if(!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const texto = msg.text || '';

  const numeros = texto.match(/\d+/g);
  const numeroPedido = numeros? numeros[0] : null;

  let resposta;
  if (numeroPedido) {
    let dados = await buscarOrdem(numeroPedido);
    if (dados) resposta = dados;
    else resposta = `❌ Ordem *${numeroPedido}* não encontrada.`;
  } else {
    resposta = `Olá! 👋 Envie o *número da sua ordem* que eu consulto.`;
  }

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{
    chat_id: chatId,
    text: resposta,
    parse_mode: 'Markdown'
  });

  res.sendStatus(200);
});

app.listen(10000, ()=> console.log('On'));