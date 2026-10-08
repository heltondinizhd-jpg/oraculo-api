const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';

async function buscarNaPlanilha(pergunta) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
    const res = await axios.get(url);
    // pega o JSON dentro da resposta do Google
    const txt = res.data.replace('/*O_o*/','').replace('google.visualization.Query.setResponse(','').slice(0,-2);
    const json = JSON.parse(txt);
    const rows = json.table.rows;

    // procura a pergunta (coluna A = pergunta, coluna B = resposta)
    // Ajuste se sua planilha for diferente
    const perguntaLower = pergunta.toLowerCase();
    for (let r of rows) {
      const p = r.c[0]?.v?.toString().toLowerCase() || '';
      const resp = r.c[1]?.v?.toString() || '';
      if (perguntaLower.includes(p) || p.includes(perguntaLower)) {
        if(resp) return resp;
      }
    }
    return null;
  } catch (e) {
    console.log('Erro planilha', e.message);
    return null;
  }
}

app.get('/', (req,res)=> res.send('Oráculo online 🔮 - Planilha conectada'));

app.post('/webhook/evolution', async (req,res)=>{
  console.log('WhatsApp:', JSON.stringify(req.body));
  const data = req.body;
  const message = data?.data?.message?.conversation || data?.data?.message?.extendedTextMessage?.text;
  const remoteJid = data?.data?.key?.remoteJid;

  if(message && remoteJid &&!data?.data?.key?.fromMe){
    try{
      let resposta = await buscarNaPlanilha(message);
      if(!resposta) resposta = `🔮 Oráculo recebeu: ${message}\n\nNão achei na planilha ainda, mas já estou aprendendo!`;

      await axios.post(`https://evolution-api-prod.up.railway.app/message/sendText/${data.instance}`,{
        number: remoteJid,
        text: resposta
      },{
        headers: { apikey: process.env.EVOLUTION_APIKEY }
      });
    }catch(e){ console.log('Erro envio', e.message) }
  }
  res.sendStatus(200);
});

app.listen(10000, ()=> console.log('On'));