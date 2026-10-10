require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');

const bot = new Telegraf(process.env.BOT_TOKEN);
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CANAL_ID = -1004373039044; // Solicitações ZROFS - TRAVADO

// ===== AUTH GOOGLE =====
async function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

async function getSheetData(aba) {
  const auth = await getAuth();
  const sheets = google.sheets({version:'v4', auth});
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${aba}!A:Z`,
  });
  return res.data.values || [];
}

// ===== CRIA ABA AUTOMATICAMENTE SE NÃO EXISTIR =====
async function garanteAbaExiste(nomeAba, cabecalho) {
  try {
    const auth = await getAuth();
    const sheets = google.sheets({version:'v4', auth});
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
      console.log(`✅ Aba ${nomeAba} criada!`);
    }
  } catch (e) {
    console.error(`Erro aba ${nomeAba}:`, e.message);
  }
}

// ===== CANAL SOLICITAÇÕES =====
bot.on('channel_post', (ctx) => {
  console.log('>>> ID DO CANAL DETECTADO:', ctx.chat.id, '| Titulo:', ctx.chat.title);
});

async function enviarSolicitacaoParaCanal(dados){
  try{
    const texto = `🚨 *NOVA SOLICITAÇÃO*\n\n*OS:* ${dados.os}\n*Setor:* ${dados.setor}\n*Prioridade:* ${dados.prioridade}\n*Problema:* ${dados.problema}\n\n👤 *Solicitante:* ${dados.solicitante}\n🕒 ${dados.data} ${dados.hora}`;
    await bot.telegram.sendMessage(CANAL_ID, texto, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Assumir OS '+dados.os, 'assumir_'+dados.os)],
        [Markup.button.callback('📅 Programar OS '+dados.os, 'programar_'+dados.os)]
      ])
    });
    console.log('Enviado para canal:', CANAL_ID);
  }catch(e){
    console.error('Erro ao enviar para canal:', e.message);
  }
}

async function salvarSolicitacao(dados){
  const auth = await getAuth();
  const sheets = google.sheets({version:'v4', auth});
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `SOLICITACOES!A:J`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[dados.data, dados.hora, dados.os, dados.solicitante, dados.id, dados.setor