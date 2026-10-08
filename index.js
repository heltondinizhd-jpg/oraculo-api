const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN;
const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const bot = new Telegraf(BOT_TOKEN);

let cachePlanilha = { dados: null, hora: 0 };
let esperandoFiltro = {};

// Lê planilha
async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sheet1`;
  const { data } = await axios.get(url);
  const linhas = data.split('\n').filter(l => l.trim());
  const cabecalho = linhas[0].split(',').map(h => h.replace(/"/g,'').trim().toUpperCase()); // tudo maiúsculo igual seu print
  const dados = [];
  for(let i=1; i < linhas.length; i++) {
    const cols = linhas[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g,'').trim());
    let obj = {};
    cabecalho.forEach((h, idx) => obj[h] = cols[idx] || '');
    obj._textoBusca = Object.values(obj).join(' ').toLowerCase();
    dados.push(obj);
  }
  const res = { cabecalho, dados };
  cachePlanilha = { dados: res, hora: Date.now() };
  return res;
}

const menuFiltros = Markup.inlineKeyboard([
  [Markup.button.callback('🔢 OS', 'filtro_OS'), Markup.button.callback('🏭 SETOR', 'filtro_SETOR')],
  [Markup.button.callback('👥 GRUPO', 'filtro_GRUPO'), Markup.button.callback('🔧 CODIGO', 'filtro_CODIGO')],
  [Markup.button.callback('📦 FAMILIA', 'filtro_FAMILIA'), Markup.button.callback('🔍 SUBCONJUNTO', 'filtro_SUBCONJUNTO')],
  [Markup.button.callback('📊 MENU', 'menu_todos')]
]);

bot.start(async (ctx) => {
  await ctx.reply(`🔮 *ORÁCULO DA MANUTENÇÃO*\n\nFala ${ctx.from.first_name}! Planilha conectada ✅\n\n*Colunas detectadas:*\nOS | CODIGO | GRUPO | FAMILIA | SETOR\n\nComo quer buscar?`, { parse_mode: 'Markdown',...menuFiltros });
});

bot.action('menu_todos', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Escolha o filtro:', menuFiltros);
});

bot.action(/filtro_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const tipo = ctx.match[1]; // OS, SETOR, etc - já em maiúsculo
  esperandoFiltro[ctx.from.id] = tipo;
  await ctx.reply(`🔍 *Filtro: ${tipo}*\n\nDigite o que quer buscar em *${tipo}*:\nEx: se escolheu SETOR, digite BRITAGEM ou TAMBOR`, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
  const id = ctx.from.id;
  const textoOriginal = ctx.message.text.trim();
  if (textoOriginal.startsWith('/')) return;
  const texto = textoOriginal.toLowerCase();

  try {
    const { cabecalho, dados } = await lerPlanilhaCompleta();
    const filtroAtivo = esperandoFiltro[id];
    let encontradas = [];

    if (filtroAtivo && cabecalho.includes(filtroAtivo)) {
      encontradas = dados.filter(d => (d[filtroAtivo] || '').toLowerCase().includes(texto)).slice(0, 5);
      delete esperandoFiltro[id];
    } else {
      encontradas = dados.filter(d => d._textoBusca.includes(texto)).slice(0, 5);
    }

    if (encontradas.length > 0) {
      await ctx.reply(`✅ *${encontradas.length} ENCONTRADAS EM ${filtroAtivo || 'GERAL'}: ${textoOriginal.toUpperCase()}*`, { parse_mode: 'Markdown' });
      for (const os of encontradas) {
        let resp = `*━━━━━━━━━━━━━━━*\n`;
        resp += `*OS:* ${os['OS'] || '-'}\n`;
        resp += `*CODIGO:* ${os['CODIGO'] || '-'}\n`;
        resp += `*SUBCONJUNTO:* ${os['SUBCONJUNTO'] || '-'}\n`;
        resp += `*GRUPO:* ${os['GRUPO'] || '-'} | *FAMILIA:* ${os['FAMILIA'] || '-'}\n`;
        resp += `*SETOR:* ${os['SETOR'] || '-'}\n`;
        resp += `*STATUS:* ${os['STATUS'] || '-'}\n`;
        resp += `*EMISSÃO:* ${os['EMISSÃO'] || os['EMISSAO'] || '-'}\n`;
        await ctx.reply(resp, { parse_mode: 'Markdown' });
      }
      await ctx.reply('Fazer nova busca?', menuFiltros);
    } else {
      await ctx.reply(`❌ Nenhuma OS com *${filtroAtivo || ''} = ${textoOriginal}*\n\nTente outro termo:`, { parse_mode: 'Markdown',...menuFiltros });
      delete esperandoFiltro[id];
    }
  } catch (e) {
    await ctx.reply('⚠️ Erro: ' + e.message);
  }
});

app.get('/', (req, res) => res.json({ ok: true }));
app.use(bot.webhookCallback('/telegram'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await bot.telegram.setWebhook(`https://oraculo-api-7ozv.onrender.com/telegram`);
  console.log('Oráculo com filtros OFICIAIS online');
});