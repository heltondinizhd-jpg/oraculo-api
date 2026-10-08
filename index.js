const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.log('ERRO: BOT_TOKEN não configurado!');
}
const bot = new Telegraf(BOT_TOKEN);

// Mensagem do Oráculo
bot.start((ctx) => ctx.reply('🔮 Oráculo da Manutenção Online! Me mande a falha.'));
bot.on('text', (ctx) => {
  const msg = ctx.message.text;
  ctx.reply(`🔧 Recebi: "${msg}"\n\nAnalisando como Oráculo da Manutenção... (em breve aqui entra sua IA)`);
});

// Rotas da API
app.get('/', (req, res) => {
  res.json({ status: 'online', bot: 'oraculo ativo' });
});

// Webhook para o Telegram
app.use(bot.webhookCallback('/telegram'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('API rodando na porta ' + PORT);
  // Configura webhook automaticamente
  const url = `https://oraculo-api-7ozv.onrender.com/telegram`;
  try {
    await bot.telegram.setWebhook(url);
    console.log('Webhook configurado: ' + url);
  } catch (e) {
    console.log('Erro webhook: ' + e.message);
  }
});