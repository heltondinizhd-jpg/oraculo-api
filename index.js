require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');

const bot = new Telegraf(process.env.BOT_TOKEN);
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CANAL_ID = -1004373039044;

async function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

async function garanteAbaExiste(nomeAba, cabecalho) {
  try {
    const auth = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existe = meta.data.sheets.some(s => s.properties.title === nomeAba);
    if (!existe) {
      console.log(`Criando aba ${nomeAba}...`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: [{ addSheet: { properties: { title: nomeAba } } }] }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${nomeAba}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [cabecalho] }
      });
      console.log(`Aba ${nomeAba} criada!`);
    }
  } catch (e) {
    console.error(`Erro aba ${nomeAba}:`, e.message);
  }
}

async function salvarSolicitacao(dados) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `SOLICITACOES!A:J`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[dados.data, dados.hora, dados.os, dados.solicitante, dados.id, dados.setor, dados.problema, dados.prioridade, 'ABERTA', '']]
    }
  });
}

async function enviarParaCanal(dados) {
  try {
    const texto = `🚨 *NOVA SOLICITAÇÃO*\n\n*OS:* ${dados.os}\n*Setor:* ${dados.setor}\n*Prioridade:* ${dados.prioridade}\n*Problema:* ${dados.problema}\n\n👤 Solicitante: ${dados.solicitante}\n🕒 ${dados.data} ${dados.hora}`;
    await bot.telegram.sendMessage(CANAL_ID, texto, {
      parse_mode: 'Markdown',
     ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Assumir OS ' + dados.os, 'assumir_' + dados.os)],
        [Markup.button.callback('📅 Programar', 'programar_' + dados.os)]
      ])
    });
  } catch (e) {
    console.error('Erro canal:', e.message);
  }
}

const tecladoPrincipal = Markup.keyboard([
  ['⚡ ELETRICA', '⛏️ MINA', '🏭 USINA'],
  ['📝 Nova Solicitação', '📅 Programação'],
  ['📊 Status', '❓ Ajuda']
]).resize();

bot.start(async (ctx) => {
  await ctx.reply(`Olá ${ctx.from.first_name}! Bem-vindo ao ZROFS`, tecladoPrincipal);
});

const wizard = {};

bot.hears(['📝 Nova Solicitação', '/solicitar'], async (ctx) => {
  wizard[ctx.from.id] = { step: 1 };
  await ctx.reply('📝 *Nova Solicitação*\n\nMe manda o número da OS:', { parse_mode: 'Markdown' });
});

bot.action(/sol_setor_(.+)/, async (ctx) => {
  const w = wizard[ctx.from.id];
  if (!w) return;
  w.setor = ctx.match[1];
  w.step = 3;
  await ctx.editMessageText(`Setor: ${w.setor}\n\nAgora descreve o problema:`);
  await ctx.answerCbQuery();
});

bot.action(/sol_prio_(.+)/, async (ctx) => {
  const w = wizard[ctx.from.id];
  if (!w) return;
  w.prioridade = ctx.match[1];
  const dados = {
    data: new Date().toLocaleDateString('pt-BR'),
    hora: new Date().toLocaleTimeString('pt-BR'),
    os: w.os,
    setor: w.setor,
    problema: w.problema,
    prioridade: w.prioridade,
    solicitante: ctx.from.first_name,
    id: ctx.from.id
  };
  await salvarSolicitacao(dados);
  await enviarParaCanal(dados);
  await ctx.editMessageText(`✅ OS ${dados.os} enviada para o canal!`);
  delete wizard[ctx.from.id];
  await ctx.answerCbQuery();
});

bot.on('text', async (ctx, next) => {
  const w = wizard[ctx.from.id];
  if (!w) return next();
  if (w.step === 1) {
    w.os = ctx.message.text;
    w.step = 2;
    return ctx.reply('Qual setor?', Markup.inlineKeyboard([
      [Markup.button.callback('⚡ ELETRICA', 'sol_setor_ELETRICA')],
      [Markup.button.callback('⛏️ MEC MINA', 'sol_setor_MECANICA MINA')],
      [Markup.button.callback('🏭 MEC USINA', 'sol_setor_MECANICA USINA')]
    ]));
  }
  if (w.step === 3) {
    w.problema = ctx.message.text;
    w.step = 4;
    return ctx.reply('Qual prioridade?', Markup.inlineKeyboard([
      [Markup.button.callback('🔴 ALTA', 'sol_prio_ALTA'), Markup.button.callback('🟡 MEDIA', 'sol_prio_MEDIA'), Markup.button.callback('🟢 BAIXA', 'sol_prio_BAIXA')]
    ]));
  }
});

bot.hears(['⚡ ELETRICA', '⛏️ MINA', '🏭 USINA', '📅 Programação', '📊 Status', '❓ Ajuda'], async (ctx) => {
  await ctx.reply(`Você escolheu: ${ctx.message.text}`, tecladoPrincipal);
});

(async () => {
  await garanteAbaExiste('PROGRAMACAO', ['OS', 'SETOR_PROG', 'DATA_INI', 'DATA_FIM', 'TURNO', 'RESPONSAVEL', 'STATUS', 'PRIORIDADE', 'OBS']);
  await garanteAbaExiste('SOLICITACOES', ['DATA', 'HORA', 'OS', 'SOLICITANTE', 'ID_SOLICITANTE', 'SETOR', 'PROBLEMA', 'PRIORIDADE', 'STATUS', 'FOTO']);
  bot.launch();
  console.log('Bot rodando canal', CANAL_ID);
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));