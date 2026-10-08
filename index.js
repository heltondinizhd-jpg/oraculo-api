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

async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sheet1`;
  const { data } = await axios.get(url);
  const linhas = data.split('\n').filter(l => l.trim());
  const cabecalho = linhas[0].split(',').map(h => h.replace(/"/g,'').trim().toUpperCase());
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

function contarPorCampo(dados, campo) {
  const map = {};
  dados.forEach(d => {
    const v = (d[campo] || 'NÃO INFORMADO').trim().toUpperCase();
    if(v) map[v] = (map[v] || 0) + 1;
  });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,10); // top 10
}

const menuFiltros = Markup.inlineKeyboard([
  [Markup.button.callback('🔢 OS', 'filtro_OS'), Markup.button.callback('🏭 SETOR', 'filtro_SETOR')],
  [Markup.button.callback('👥 GRUPO', 'filtro_GRUPO'), Markup.button.callback('🔧 CODIGO', 'filtro_CODIGO')],
  [Markup.button.callback('📦 FAMILIA', 'filtro_FAMILIA'), Markup.button.callback('🔍 SUBCONJUNTO', 'filtro_SUBCONJUNTO')],
  [Markup.button.callback('📊 DASHBOARD / RESUMO', 'resumo')],
]);

bot.start(async (ctx) => {
  await ctx.reply(`🔮 *ORÁCULO DA MANUTENÇÃO*\n\nBem-vindo ${ctx.from.first_name}!\n\nEscolha um filtro ou veja o dashboard geral:`, { parse_mode: 'Markdown',...menuFiltros });
});

bot.command('resumo', async (ctx) => { return gerarResumo(ctx); });
bot.action('resumo', async (ctx) => {
  await ctx.answerCbQuery();
  return gerarResumo(ctx);
});

async function gerarResumo(ctx) {
  await ctx.sendChatAction('typing');
  await ctx.reply('📊 *Gerando Dashboard... analisando toda a planilha*', { parse_mode: 'Markdown' });
  const { dados } = await lerPlanilhaCompleta();
  const total = dados.length;

  const porSetor = contarPorCampo(dados, 'SETOR');
  const porGrupo = contarPorCampo(dados, 'GRUPO');
  const porFamilia = contarPorCampo(dados, 'FAMILIA');
  const porStatus = contarPorCampo(dados, 'STATUS');

  let resp = `📊 *DASHBOARD - RESUMO GERAL*\n`;
  resp += `*Total de OS:* ${total}\n`;
  resp += `*Atualizado:* ${new Date().toLocaleString('pt-BR')}\n`;
  resp += `━━━━━━━━━━━━━━━\n\n`;

  resp += `*🏭 TOP SETORES:*\n`;
  porSetor.forEach(([k,v]) => { resp += `• ${k}: ${v} OS (${Math.round(v/total*100)}%)\n`; });

  resp += `\n*👥 TOP GRUPOS:*\n`;
  porGrupo.forEach(([k,v]) => { resp += `• ${k}: ${v}\n`; });

  resp += `\n*📦 TOP FAMÍLIAS:*\n`;
  porFamilia.forEach(([k,v]) => { resp += `• ${k}: ${v}\n`; });

  resp += `\n*📌 STATUS:*\n`;
  porStatus.forEach(([k,v]) => { resp += `• ${k}: ${v}\n`; });

  resp += `\n━━━━━━━━━━━━━━━\n_Digite /resumo a qualquer hora para atualizar_`;

  // Se ficar muito grande, quebra em 2
  if (resp.length > 4000) {
    await ctx.reply(resp.substring(0,4000), { parse_mode: 'Markdown' });
    await ctx.reply(resp.substring(4000), { parse_mode: 'Markdown',...menuFiltros });
  } else {
    await ctx.reply(resp, { parse_mode: 'Markdown',...menuFiltros });
  }
}

bot.action(/filtro_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const tipo = ctx.match[1];
  esperandoFiltro[ctx.from.id] = tipo;
  await ctx.reply(`🔍 *Filtro: ${tipo}*\n\nDigite o valor de *${tipo}*:`, { parse_mode: 'Markdown' });
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
      await ctx.reply(`✅ *${encontradas.length} ENCONTRADAS EM ${filtroAtivo || 'GERAL'}*`, { parse_mode: 'Markdown' });
      for (const os of encontradas) {
        let r = `*━━━━━━━━━━━━━━━*\n`;
        r += `*OS:* ${os['OS']} | *CODIGO:* ${os['CODIGO']}\n`;
        r += `*SUBCONJUNTO:* ${os['SUBCONJUNTO']}\n`;
        r += `*GRUPO:* ${os['GRUPO']} | *FAMILIA:* ${os['FAMILIA']}\n`;
        r += `*SETOR:* ${os['SETOR']} | *STATUS:* ${os['STATUS']}\n`;
        await ctx.reply(r, { parse_mode: 'Markdown' });
      }
      await ctx.reply('Nova busca?', menuFiltros);
    } else {
      await ctx.reply(`❌ Nada em ${filtroAtivo || 'GERAL'} para "${textoOriginal}"`, {...menuFiltros});
      delete esperandoFiltro[id];
    }
  } catch (e) { await ctx.reply('⚠️ ' + e.message); }
});

app.get('/', (req, res) => res.json({ ok: true }));
app.use(bot.webhookCallback('/telegram'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await bot.telegram.setWebhook(`https://oraculo-api-7ozv.onrender.com/telegram`);
  console.log('Oráculo com DASHBOARD online');
});