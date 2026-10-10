// index.js - V13.8 - MANUTENCAO + PROGRAMACAO + CONTROLE ACESSO
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');

const app = express();
const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN ||!SPREADSHEET_ID) {
  console.error('Faltando BOT_TOKEN ou SPREADSHEET_ID');
}

const bot = new Telegraf(BOT_TOKEN);

// ===== CONFIG ABAS =====
const ABA_BASE = 'BASE'; // sua aba principal de materiais
const ABA_PROGRAMACAO = 'PROGRAMACAO';
const SETORES_PROG = ['ELETRICA', 'MECANICA MINA', 'MECANICA USINA'];

// ===== CONTROLE DE ACESSO - COLOCA SEUS IDs AQUI =====
// Pega seu ID em @userinfobot
const ADMINS = ['123456789']; // SEU ID - ACESSO TOTAL
const FRESTA_ELETRICA = ['']; // IDs que podem ver/alterar ELETRICA
const FRESTA_MINA = []; // IDs MECANICA MINA
const FRESTA_USINA = []; // IDs MECANICA USINA
const LIBERADO_VER = true; // true = qualquer um vê, false = só IDs acima

function isAdmin(id){ return ADMINS.includes(String(id)); }
function podeVer(id){
  if(LIBERADO_VER) return true;
  const s = String(id);
  return isAdmin(s) || [...FRESTA_ELETRICA,...FRESTA_MINA,...FRESTA_USINA].includes(s);
}
function podeEditarSetor(id, setor){
  const s = String(id);
  if(isAdmin(s)) return true;
  if(setor==='ELETRICA') return FRESTA_ELETRICA.includes(s);
  if(setor==='MECANICA MINA') return FRESTA_MINA.includes(s);
  if(setor==='MECANICA USINA') return FRESTA_USINA.includes(s);
  return false;
}
function podeEditarGeral(id){
  const s = String(id);
  return isAdmin(s) || [...FRESTA_ELETRICA,...FRESTA_MINA,...FRESTA_USINA].includes(s);
}

// ===== GOOGLE SHEETS =====
async function getAuth(){
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return auth.getClient();
}
async function getSheetData(aba){
  const auth = await getAuth();
  const sheets = google.sheets({version:'v4', auth});
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${aba}!A:Z`
  });
  return res.data.values || [];
}
async function updateStatusProgramacao(os, novoStatus){
  const auth = await getAuth();
  const sheets = google.sheets({version:'v4', auth});
  const rows = await getSheetData(ABA_PROGRAMACAO);
  const idx = rows.findIndex((r,i)=> i>0 && String(r[0]).trim()===String(os).trim());
  if(idx===-1) return false;
  // coluna G = 7ª letra = status
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_PROGRAMACAO}!G${idx+1}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[novoStatus]] }
  });
  return true;
}

// ===== HELPERS =====
function parseDataBR(v){
  if(!v) return null;
  if(v instanceof Date) return v;
  const s = String(v).trim();
  if(s.includes('/')){
    const [d,m,y] = s.split('/').map(x=>parseInt(x));
    return new Date(y<100?2000+y:y, (m||1)-1, d||1);
  }
  return new Date(v);
}
function hojeZerado(){ const d=new Date(); d.setHours(0,0,0,0); return d; }

// Busca setor original da OS na aba BASE (MINA/USINA)
let cacheBase = null;
async function getSetorOriginalDaOS(os){
  if(!cacheBase){
    const rows = await getSheetData(ABA_BASE);
    cacheBase = rows;
  }
  const r = cacheBase.find(x=> String(x[0]).includes(String(os)) );
  if(!r) return 'DESCONHECIDO';
  // supondo que coluna GRUPO seja coluna B ou C - ajuste se precisar
  return String(r[2]||'').toUpperCase().includes('MINA')? 'MINA' : 'USINA';
}

async function getProgramacao(){
  const rows = await getSheetData(ABA_PROGRAMACAO);
  if(rows.length<=1) return [];
  // OS | SETOR_PROG | DATA_INI | DATA_FIM | TURNO | RESPONSAVEL | STATUS | PRIORIDADE | OBS
  const dados = [];
  for(let i=1;i<rows.length;i++){
    const r = rows[i];
    if(!r[0]) continue;
    dados.push({
      os: String(r[0]).trim(),
      setorProg: String(r[1]||'').toUpperCase().trim(),
      dataIni: parseDataBR(r[2]),
      dataFim: parseDataBR(r[3])||parseDataBR(r[2]),
      turno: r[4]||'',
      responsavel: r[5]||'',
      status: String(r[6]||'').toUpperCase().trim(),
      prioridade: r[7]||'',
      obs: r[8]||'',
      linha: i+1
    });
  }
  return dados;
}
function filtraPorPeriodo(prog, tipo){
  const h = hojeZerado();
  if(tipo==='hoje'){
    return prog.filter(p=> p.dataIni && p.dataIni.getTime()===h.getTime() || (p.dataIni<=h && p.dataFim>=h));
  }
  if(tipo==='semana'){
    const ini = new Date(h); ini.setDate(h.getDate()-h.getDay()+1); // segunda
    const fim = new Date(ini); fim.setDate(ini.getDate()+6);
    return prog.filter(p=> p.dataIni>=ini && p.dataIni<=fim);
  }
  return prog;
}
function statusIcon(s){
  s = (s||'').toUpperCase();
  if(s.includes('AGUARDANDO')) return '🟡';
  if(s.includes('EM MANUTENCAO')) return '🔵';
  if(s.includes('INTERROMPIDO')) return '🟠';
  if(s.includes('CANCELADO')) return '🔴';
  if(s.includes('CONCLUIDO')) return '🟢';
  return '⚪';
}

// ===== MENU PRINCIPAL =====
bot.start(async (ctx)=>{
  if(!podeVer(ctx.from.id)) return ctx.reply('⛔ Acesso não liberado. Fale com o administrador.');
  await ctx.reply(
    `👋 Olá ${ctx.from.first_name}!\n\nBot Manutenção V13.8`,
    Markup.keyboard([
      ['📦 Material Faltante', '🏢 Setores'],
      ['📅 Programação', '📊 Dashboard'],
      ['🧹 Limpar Filtros']
    ]).resize()
  );
});

bot.hears('📅 Programação', async (ctx)=> mostrarMenuProgramacao(ctx));
bot.action('menu_programacao', async (ctx)=> mostrarMenuProgramacao(ctx));

async function mostrarMenuProgramacao(ctx){
  if(!podeVer(ctx.from?.id)) return ctx.answerCbQuery('Sem acesso');
  const prog = await getProgramacao();
  const qtdEle = prog.filter(p=>p.setorProg==='ELETRICA').length;
  const qtdMina = prog.filter(p=>p.setorProg==='MECANICA MINA').length;
  const qtdUsina = prog.filter(p=>p.setorProg==='MECANICA USINA').length;

  const text = `📅 *PROGRAMAÇÃO*\nTotal: ${prog.length} OS programadas\n\n⚡ ELETRICA (${qtdEle}) - atende MINA e USINA\n⛏️ MEC MINA (${qtdMina})\n🏭 MEC USINA (${qtdUsina})`;

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback(`⚡ ELETRICA (${qtdEle})`, 'prog_setor_ELETRICA')],
    [Markup.button.callback(`⛏️ MECANICA MINA (${qtdMina})`, 'prog_setor_MECANICA MINA')],
    [Markup.button.callback(`🏭 MECANICA USINA (${qtdUsina})`, 'prog_setor_MECANICA USINA')],
    [Markup.button.callback('📅 Hoje', 'prog_hoje'), Markup.button.callback('📅 Semana', 'prog_semana')],
    [Markup.button.callback('🚦 Por Status', 'prog_status_menu')],
  ]);

  if(ctx.callbackQuery) await ctx.editMessageText(text, {parse_mode:'Markdown',...kb});
  else await ctx.reply(text, {parse_mode:'Markdown',...kb});
}

bot.action(/prog_setor_(.+)/, async (ctx)=>{
  const setor = ctx.match[1];
  const prog = await getProgramacao();
  let filtrada = prog.filter(p=>p.setorProg===setor);

  let txt = `*${setor}* - ${filtrada.length} OS\n\n`;
  filtrada.slice(0,20).forEach(p=>{
    txt+=`${statusIcon(p.status)} OS ${p.os} | ${p.dataIni?.toLocaleDateString('pt-BR')} - ${p.dataFim?.toLocaleDateString('pt-BR')} | ${p.status}\n👷 ${p.responsavel||'-'} | ${p.turno||''} ${p.prioridade? '| '+p.prioridade:''}\n\n`;
  });
  if(filtrada.length===0) txt+='Nenhuma OS neste setor.';

  const botoes = filtrada.slice(0,8).map(p=> [Markup.button.callback(`${statusIcon(p.status)} OS ${p.os}`, `prog_os_${p.os}`)]);

  await ctx.editMessageText(txt, {
    parse_mode:'Markdown',
   ...Markup.inlineKeyboard([...botoes, [Markup.button.callback('🔙 Voltar','menu_programacao')]])
  });
});

bot.action(/prog_os_(\d+)/, async (ctx)=>{
  const os = ctx.match[1];
  const prog = await getProgramacao();
  const item = prog.find(p=>p.os===os);
  if(!item) return ctx.answerCbQuery('OS não encontrada');

  const podeEditar = podeEditarGeral(ctx.from.id) && (podeEditarSetor(ctx.from.id, item.setorProg) || isAdmin(ctx.from.id));

  let txt = `*OS ${item.os}*\nSetor Prog: ${item.setorProg}\nPeríodo: ${item.dataIni?.toLocaleDateString()} a ${item.dataFim?.toLocaleDateString()}\nStatus: ${statusIcon(item.status)} ${item.status}\nResp: ${item.responsavel}\nTurno: ${item.turno}\nObs: ${item.obs||'-'}`;

  const kb = podeEditar? Markup.inlineKeyboard([
    [Markup.button.callback('▶️ Em Manutenção','upd_'+os+'_EM MANUTENCAO'), Markup.button.callback('⏸️ Interromper','upd_'+os+'_INTERROMPIDO')],
    [Markup.button.callback('✅ Concluir','upd_'+os+'_CONCLUIDO'), Markup.button.callback('❌ Cancelar','upd_'+os+'_CANCELADO')],
    [Markup.button.callback('🟡 Aguardando','upd_'+os+'_AGUARDANDO MANUTENCAO')],
    [Markup.button.callback('🔙 Voltar','menu_programacao')]
  ]) : Markup.inlineKeyboard([[Markup.button.callback('🔙 Voltar','menu_programacao')]]);

  await ctx.editMessageText(txt, {parse_mode:'Markdown',...kb});
});

bot.action(/upd_(\d+)_(.+)/, async (ctx)=>{
  const os = ctx.match[1];
  const novoStatus = ctx.match[2];
  if(!podeEditarGeral(ctx.from.id)) return ctx.answerCbQuery('⛔ Sem permissão');

  await updateStatusProgramacao(os, novoStatus);
  await ctx.answerCbQuery(`OS ${os} -> ${novoStatus}`);
  await ctx.editMessageText(`✅ OS ${os} atualizada para *${novoStatus}*`, {parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔙 Voltar','menu_programacao')]])});
});

bot.action('prog_hoje', async (ctx)=>{
  const prog = await getProgramacao();
  const filtrada = filtraPorPeriodo(prog,'hoje');
  let txt = `*HOJE - ${hojeZerado().toLocaleDateString('pt-BR')}* - ${filtrada.length} OS\n\n`;
  filtrada.forEach(p=> txt+=`${statusIcon(p.status)} [${p.setorProg}] OS ${p.os} - ${p.status} - ${p.responsavel}\n`);
  if(filtrada.length===0) txt+='Nenhuma OS pra hoje.';
  await ctx.editMessageText(txt, {parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔙 Voltar','menu_programacao')]])});
});

bot.action('prog_semana', async (ctx)=>{
  const prog = await getProgramacao();
  const filtrada = filtraPorPeriodo(prog,'semana');
  let txt = `*SEMANA* - ${filtrada.length} OS\n\n`;
  filtrada.forEach(p=> txt+=`${statusIcon(p.status)} ${p.dataIni?.toLocaleDateString()} [${p.setorProg}] OS ${p.os} - ${p.status}\n`);
  await ctx.editMessageText(txt, {parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔙 Voltar','menu_programacao')]])});
});

bot.action('prog_status_menu', async (ctx)=>{
  await ctx.editMessageText('Filtrar por status:', Markup.inlineKeyboard([
    [Markup.button.callback('🟡 Aguardando','prog_fstatus_AGUARDANDO'), Markup.button.callback('🔵 Em Manut','prog_fstatus_EM MANUTENCAO')],
    [Markup.button.callback('🟠 Interrompido','prog_fstatus_INTERROMPIDO'), Markup.button.callback('🔴 Cancelado','prog_fstatus_CANCELADO')],
    [Markup.button.callback('🟢 Concluído','prog_fstatus_CONCLUIDO')],
    [Markup.button.callback('🔙 Voltar','menu_programacao')]
  ]));
});

bot.action(/prog_fstatus_(.+)/, async (ctx)=>{
  const f = ctx.match[1];
  const prog = await getProgramacao();
  const filtrada = prog.filter(p=> p.status.includes(f));
  let txt = `*Status: ${f}* - ${filtrada.length} OS\n\n`;
  filtrada.slice(0,20).forEach(p=> txt+=`${statusIcon(p.status)} [${p.setorProg}] OS ${p.os} - ${p.dataIni?.toLocaleDateString()} - ${p.responsavel}\n`);
  await ctx.editMessageText(txt, {parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔙 Voltar','prog_status_menu')]])});
});

// ===== DASHBOARD WEB =====
app.get('/dashboard', async (req,res)=>{
  const prog = await getProgramacao();
  const porSetor = {
    ELETRICA: prog.filter(p=>p.setorProg==='ELETRICA').length,
    MINA: prog.filter(p=>p.setorProg==='MECANICA MINA').length,
    USINA: prog.filter(p=>p.setorProg==='MECANICA USINA').length,
  };
  const porStatus = {};
  prog.forEach(p=>{ porStatus[p.status]=(porStatus[p.status]||0)+1; });

  res.send(`
  <html><head><title>Dashboard V13.8</title>
  <style>body{font-family:Arial;padding:20px}.card{border:1px solid #ddd;padding:15px;border-radius:10px;display:inline-block;margin:10px;min-width:180px}</style>
  </head><body>
  <h2>Dashboard Programação V13.8</h2>
  <div class="card"><h3>⚡ ELÉTRICA</h3><b>${porSetor.ELETRICA}</b> OS<br>Atende MINA e USINA</div>
  <div class="card"><h3>⛏️ MEC MINA</h3><b>${porSetor.MINA}</b> OS</div>
  <div class="card"><h3>🏭 MEC USINA</h3><b>${porSetor.USINA}</b> OS</div>
  <h3>Por Status</h3>
  <pre>${JSON.stringify(porStatus,null,2)}</pre>
  <h3>Detalhe</h3>
  <table border=1 cellpadding=5><tr><th>OS</th><th>SetorProg</th><th>Data</th><th>Status</th><th>Resp</th></tr>
  ${prog.map(p=>`<tr><td>${p.os}</td><td>${p.setorProg}</td><td>${p.dataIni?.toLocaleDateString()}</td><td>${p.status}</td><td>${p.responsavel}</td></tr>`).join('')}
  </table>
  </body></html>
  `);
});

app.get('/', (req,res)=> res.send('Bot V13.8 online'));

bot.launch();
app.listen(PORT, ()=> console.log('V13.8 rodando na porta '+PORT));