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
  return Math.floor((hoje - data) / (1000 * 60 * 60 * 24));
}

function getCriticidade(dias) {
  if (dias >= 180) return '[IMEDIATA]';
  if (dias >= 150) return '[URGENTE]';
  if (dias >= 120) return '[PRIORITARIO]';
  return '';
}

const menu = Markup.keyboard([
  ['Resumo', 'Alertas'],
  ['Buscar OS', 'Buscar Codigo'],
  ['Familia', 'Setor']
]).resize();

const TEXTO_SAUDACAO = (nome) => 
`Olá, ${nome}!

Prezado cliente da Oficina Central, bem-vindo ao canal exclusivo de Ordens de Restauração - ZROF.

Esta aplicação é destinada à gestão de demandas ZROF, tratadas de forma planejada, com maior nível de qualidade e controle de informações.

Criticidade por Lead Time:
IMEDIATA >=180d | URGENTE 150-179d | PRIORITÁRIO 120-149d

Utilize o menu abaixo.`;

bot.start((ctx) => {
  const nome = ctx.from.first_name || 'cliente';
  return ctx.reply(TEXTO_SAUDACAO(nome), menu);
});

// Garante que /start funciona mesmo com cache
bot.command('start', (ctx) => {
  const nome = ctx.from.first_name || 'cliente';
  return ctx.reply(TEXTO_SAUDACAO(nome), menu);
});

bot.hears('Resumo', async (ctx) => {
  const dados = await getSheet();
  ctx.reply(`Total: ${dados.length - 1} ordens`, menu);
});

bot.hears('Alertas', async (ctx) => {
  const dados = await getSheet();
  const header = dados[0];
  const idxOS = 0;
  const idxData = header.findIndex(h => h.toLowerCase().includes('data'));
  let alertas = [];
  dados.slice(1).forEach(l => {
    const dias = calcularLeadTime(l[idxData]);
    if (dias >= 120) alertas.push({ os: l[idxOS], dias, crit: getCriticidade(dias) });
  });
  alertas.sort((a,b) => b.dias - a.dias);
  if (alertas.length === 0) return ctx.reply('Nenhuma ordem >120 dias', menu);
  let msg = `ORDENS >120 DIAS (${alertas.length})\n\n`;
  alertas.slice(0, 15).forEach(a => { msg += `${a.crit} - OS ${a.os} - ${a.dias}d\n`; });
  ctx.reply(msg, menu);
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  if (['Resumo','Alertas','Buscar OS','Buscar Codigo','Familia','Setor'].includes(ctx.message.text)) return;
  const termo = ctx.message.text.toLowerCase();
  const dados = await getSheet();
  const resultados = dados.slice(1).filter(l => l.join(' ').toLowerCase().includes(termo)).slice(0, 10);
  if (resultados.length === 0) return ctx.reply(`Nenhum resultado para "${ctx.message.text}"`, menu);
  let msg = `${resultados.length} resultados:\n\n`;
  resultados.forEach(l => { msg += `OS: ${l[0]}\n`; });
  ctx.reply(msg, menu);
});

bot.launch();
console.log('Bot rodando com saudacao');