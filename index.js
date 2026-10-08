const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// Consulta seu banco - depois a gente conecta sua planilha/DB aqui
async function consultarBanco(pergunta) {
  return "Você é o Oráculo, um assistente útil e direto.";
}

async function gerarResposta(msg) {
  // Por enquanto sem IA, só eco. Depois colocamos OpenAI
  // Pra testar rápido:
  return `Recebi: ${msg} - O Oráculo está online!`;
}

// ROTA WHATSAPP - Evolution manda aqui
app.post('/webhook/evolution', async (req,res)=>{
  try{
    const texto = req.body?.data?.message?.conversation || req.body?.data?.message?.extendedTextMessage?.text || '';
    const remoteJid = req.body?.data?.key?.remoteJid || '';
    console.log("WhatsApp:", texto);
    if(!texto || req.body?.data?.key?.fromMe) return res.sendStatus(200);
    
    const resposta = await gerarResposta(texto);
    
    await axios.post(`${process.env.EVOLUTION_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`,
      { number: remoteJid, text: resposta },
      { headers:{ apikey: process.env.EVOLUTION_APIKEY }}
    );
    res.sendStatus(200);
  } catch(e){ console.log(e); res.sendStatus(200); }
});

// ROTA TELEGRAM
app.post('/webhook/telegram', async (req,res)=>{
  try{
    const msg = req.body.message;
    if(!msg?.text) return res.sendStatus(200);
    console.log("Telegram:", msg.text);
    const resposta = await gerarResposta(msg.text);
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: msg.chat.id, text: resposta }
    );
    res.sendStatus(200);
  } catch(e){ console.log(e); res.sendStatus(200); }
});

app.get('/', (req,res)=> res.send('Oráculo online!'));
app.listen(process.env.PORT || 3000, ()=> console.log('Online'));