const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

app.get('/', (req,res)=> res.send('Oráculo online! ✅'));

app.post('/webhook/evolution', async (req,res)=>{
  console.log('WhatsApp:', JSON.stringify(req.body).substring(0,200));
  
  const data = req.body;
  const message = data?.data?.message?.conversation || data?.data?.message?.extendedTextMessage?.text;
  const remoteJid = data?.data?.key?.remoteJid;
  const instance = data?.instance;

  if(message && remoteJid && !data?.data?.key?.fromMe){
    try{
      await axios.post(`https://evolution-api-production-af5e.up.railway.app/message/sendText/${instance}`, {
        number: remoteJid,
        text: `🔮 Oráculo recebeu: ${message}\n\nSeu cérebro está funcionando! Agora vamos colocar a IA.`
      },{
        headers: { apikey: process.env.EVOLUTION_API_KEY }
      });
    }catch(e){ console.log('Erro envio', e.message); }
  }
  res.sendStatus(200);
});

app.listen(10000, ()=> console.log('On'));