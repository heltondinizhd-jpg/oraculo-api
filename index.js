require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');

const bot = new Telegraf(process.env.BOT_TOKEN);
const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Base';

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

async function getSheet() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}`,
  });
  return res.data.values;
}

function calcularLeadTime(dataStr) {
  if (!dataStr) return 0;
  const data = new Date(dataStr);
  if (isNaN(data)) return 0;
  const hoje = new Date();
  const diff = hoje - data;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getCriticidade(dias) {
  if (dias >= 180) return '🔴 IMEDIATA';
  if (dias >= 150) return '🟠 URGENTE';
  if (dias >= 120) return '🟡 PRIORITÁRIO';
  return '';
}

const menu = Markup.keyboard([
  ['📊 Resumo', '🚨 Alertas'],
  ['🔍 Buscar OS', '🔍 Buscar Código'],
  ['🏭 Família', '🏢 Setor']
]).resize();

bot.start((ctx) => {
  const nome = ctx.from.first_name || 'cliente';
  const texto = `Olá, ${nome}!\n\n` +
  `Prezado cliente da Oficina Central, bem-vindo ao canal exclusivo de Ordens de Restauração - ZROF.\n\n` +
  `Esta aplicação é destinada à gestão de demandas ZROF, tratadas de forma planejada, com maior nível de qualidade e controle de informações.\n\n` +
  `🚨 Criticidade por Lead Time:\n` +
  `🔴 IMEDIATA >=180d | 🟠 URGENTE 150-179d | 