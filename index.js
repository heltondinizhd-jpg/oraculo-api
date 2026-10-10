require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');

const bot = new Telegraf(process.env.BOT_TOKEN);
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

const tecladoPrincipal = Markup.keyboard([
  ['⚡ ELETRICA', '⛏️ MINA', '🏭 USINA'],
  ['📅 Programação', '📊 Status'],
  ['❓ Ajuda']
]).resize();

bot.start(async (ctx) => {
  await ctx.reply(`Olá ${ctx.from.first_name}! 👋\nBot ZROFS Ouro no ar!`, tecladoPrincipal);
});

bot.hears(['⚡ ELETRICA', '⛏️ MINA', '🏭 USINA'], async (ctx) => {
  await ctx.reply(`Você selecionou: ${ctx.message.text}\nBuscando OS...`, tecladoPrincipal);
});

bot.hears('📅 Programação', async (ctx) => {
  await ctx.reply('📅 Programação - em breve');
});

bot.hears('📊 Status', async (ctx) => {
  await ctx.reply('📊 Status - em breve');
});

bot.hears('❓ Ajuda', async (ctx) => {
  await ctx.reply('❓ Ajuda ZROFS: Use os botões para navegar');
});

bot.launch().then(() => {
  console.log('✅ BOT OURO RODANDO');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));