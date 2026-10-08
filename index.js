const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN;
const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';

const bot = new Telegraf(BOT_TOKEN);

async function buscarNaPlanilha(codigoBuscado) {
  // 3 URLs diferentes que o Google aceita
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sheet1`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`
  ];

  for (const url of urls) {
    try {
      console.log('Tentando URL:', url);
      const { data } = await axios.get(url, { timeout: 10000 });

      if (!data || data.includes('<HTML>') || data.includes('<!DOCTYPE')) continue;

      const linhas = data.split('\n').filter(l => l.trim());
      const cabecalho = linhas[0].split(',').map(h => h.replace(/"/g,'').trim());

      for (let i = 1; i < linhas.length; i++) {
        if (linhas[i].toLowerCase().includes(codigoBuscado.toLowerCase())) {
          const colunas = linhas[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g,'').trim());
          let resposta = `🔮 *ORÁCULO - CÓDIGO ${codigoBuscado}*\n\n`;
          cabecalho.forEach((nome, idx) => {
            if (colunas[idx] && colunas[idx].length > 0) {
              resposta += `*${nome}:* ${colunas[idx]}\n`;
            }
          });
          return resposta;
        }
      }
      return null; // tentou e não achou
    } catch (e) {
      console.log('Falhou URL:', url, e.message);
      continue;
    }
  }
  return 'ERRO_PLANILHA';
}

bot.start((ctx) => ctx.reply('🔮 Oráculo Online! Mande o código.'));

bot.on('text', async (ctx) => {
  const codigo = ctx.message.text.trim();
  await ctx.reply(`🔧 Buscando *${codigo}*...`, { parse_mode: 'Markdown' });

  const resultado = await buscarNaPlanilha(codigo);

  if (resultado === 'ERRO_PLANILHA') {
    await ctx.reply(`❌ Ainda não consegui ler a planilha.\n\nFaz isso: Na planilha vai em ARQUIVO > COMPARTILHAR > PUBLICAR NA WEB > Publicar como CSV`);
  } else if (!resultado) {
    await ctx.reply(`❌ Código *${codigo}* não encontrado na planilha.`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(resultado, { parse_mode: 'Markdown' });
  }
});

app.get('/', (req, res) => res.json({ ok: true }));
app.use(bot.webhookCallback('/telegram'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('Subindo...');
  await bot.telegram.setWebhook(`https://oraculo-api-7ozv.onrender.com/telegram`);
  console.log('Webhook OK');
});