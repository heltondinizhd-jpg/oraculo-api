const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
app.use(cors());
app.use(express.json());

// Pega o token de qualquer nome possível
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.TOKEN;

console.log('--- DEBUG ---');
console.log('BOT_TOKEN existe?', !!process.env.BOT_TOKEN);
console.log('TELEGRAM_TOKEN existe?', !!process.env.TELEGRAM_TOKEN);
console.log('TOKEN final existe?', !!BOT_TOKEN);

if (!BOT_TOKEN) {
  console.log('ERRO: Nenhum token encontrado! Configure BOT_TOKEN no Render');
}

const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;

if (bot) {
  bot.start((ctx) => ctx.reply('🔮 Oráculo Online! Manda a falha.'));
  bot.on('text', (ctx) => ctx.reply(`🔧 Recebi: "${ctx.message.text}" - Analisando...`));
  app.use(bot.webhookCallback('/telegram'));
}

app.get('/', (req, res) => res.json({ status: 'online', token_ok: !!BOT_TOKEN }));
app.get('/health', (req, res) => res.json({ ok: true, token: !!BOT_TOKEN }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('API na porta ' + PORT);
  if (bot) {
    try {
      const url = `https://oraculo-api-7ozv.onrender.com/telegram`;
      await bot.telegram.setWebhook(url);
      console.log('Webhook OK: ' + url);
    } catch (e) {
      console.log('Erro webhook: ' + e.message);
    }
  }
});