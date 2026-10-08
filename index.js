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
    // Calcula Lead Time
    try {
      const emissaoStr = obj['EMISSÃO'] || obj['EMISSAO'] || '';
      const dataEmissao = new Date(emissaoStr.split('/').reverse().join('-') || emissaoStr);
      if (!isNaN(dataEmissao)) {
        const diff = Math.floor((new Date() - dataEmissao) / (1000*60*60*24));
        obj._leadTime = diff;
        obj._dataEmissao = dataEmissao;
      } else { obj._leadTime = 0; }
    } catch { obj._leadTime = 0; }
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
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,10);
}

const menuFiltros = Markup.inlineKeyboard([
  [Markup.button.callback('🔢 OS', 'filtro_OS'), Markup.button.callback('🏭 SETOR', 'filtro_SETOR')],
  [Markup.button.callback('👥 GRUPO', 'filtro_GRUPO'), Markup.button.callback('🔧 CODIGO', 'filtro_CODIGO')],
  [Markup.button.callback('📦 FAMILIA', 'filtro_FAMILIA')],
  [Markup.button.callback('📊 RESUMO', 'resumo'), Markup.button.callback('🚨 ALERTAS', 'alertas')],
]);

bot.start(async (ctx) => {
  await ctx.reply(`🔮 *ORÁCULO DA MANUTENÇÃO*\n\nEscolha:`, { parse_mode: 'Markdown',...menuFiltros });
});

bot.command('resumo', async (ctx) => gerarResumo(ctx));
bot.command('alertas', async (ctx) => gerarAlertas(ctx));
bot.action('resumo', async (ctx) => { await ctx.answerCbQuery(); gerarResumo(ctx); });
bot.action('alertas', async (ctx) => { await ctx.answerCbQuery(); gerarAlertas(ctx); });

async function gerarResumo(ctx) {
  await ctx.sendChatAction('typing');
  const { dados } = await lerPlanilhaCompleta();
  const total = dados.length;
  const porSetor = contarPorCampo(dados, 'SETOR');
  const porGrupo = contarPorCampo(dados, 'GRUPO');
  const porFamilia = contarPorCampo(dados, 'FAMILIA');
  const porStatus = contarPorCampo(dados, 'STATUS');

  let resp = `📊 *DASHBOARD - RESUMO GERAL*\n*Total:* ${total} | *Atualizado:* ${new Date().toLocaleDateString('pt-BR')}\n━━━━━━━━━━━━━━━\n\n`;
  resp += `*🏭 SETORES:*\n`; porSetor.forEach(([k,v])=> resp+=`• ${k}: ${v}\n`);
  resp += `\n*👥 GRUPOS:*\n`; porGrupo.forEach(([k,v])=> resp+=`• ${k}: ${v}\n`);
  resp += `\n*📦 FAMÍLIAS:*\n`; porFamilia.forEach(([k,v])=> resp+=`• ${k}: ${v}\n`);
  resp += `\n*📌 STATUS:*\n`; porStatus.forEach(([k,v])=> resp+=`• ${k}: ${v}\n`);
  await ctx.reply(resp, { parse_mode: 'Markdown',...menuFiltros });
}

async function gerarAlertas(ctx) {
  await ctx.sendChatAction('typing');
  await ctx.reply('🚨 *Analisando alertas críticos...*', { parse_mode: 'Markdown' });
  const { cabecalho, dados } = await lerPlanilhaCompleta();

  // 1. MAIOR LEAD TIME - top 10 mais antigas
  const maisAntigas = [...dados].filter(d=>d._leadTime>0).sort((a,b)=>b._leadTime - a._leadTime).slice(0,10);

  // 2. 100% MATERIAL - procura coluna que tenha MATERIAL ou 100%
  const colMaterial = cabecalho.find(c=> c.includes('MATERIAL') || c.includes('%') || c.includes('PERC'));
  let com100 = [];
  if (colMaterial) {
    com100 = dados.filter(d=> (d[colMaterial]||'').toString().includes('100')).slice(0,10);
  }
  // Fallback: STATUS = AGUARDA MONTAGEM = geralmente 100% material
  if (com100.length === 0) {
    com100 = dados.filter(d=> (d['STATUS']||'').toUpperCase().includes('AGUARDA MONTAGEM')).slice(0,10);
  }

  let resp = `🚨 *ALERTAS SEMANAIS - ${new Date().toLocaleDateString('pt-BR')}*\n`;
  resp += `━━━━━━━━━━━━━━━\n\n`;

  resp += `⏳ *TOP 10 - MAIOR LEAD TIME (Mais antigas):*\n`;
  if (maisAntigas.length>0) {
    maisAntigas.forEach((os,i)=>{
      resp += `${i+1}. OS ${os['OS']} - ${os._leadTime} dias | SETOR ${os['SETOR']} | ${os['FAMILIA']}\n`;
    });
  } else { resp += `Nenhuma data de emissão encontrada para calcular.\n`; }

  resp += `\n━━━━━━━━━━━━━━━\n\n`;
  resp += `✅ *OS COM 100% MATERIAL / PRONTAS P/ MONTAGEM (${com100.length}):*\n`;
  if (com100.length>0) {
    com100.forEach((os,i)=>{
      resp += `${i+1}. OS ${os['OS']} - ${os['CODIGO']} | ${os['SETOR']} | Lead: ${os._leadTime || '?'} dias\n`;
    });
    resp += `\n💡 *Ação sugerida:* Priorizar montagem dessas ${com100.length} OS e liberar espaço.\n`;
  } else { resp += `Nenhuma OS encontrada com 100%. Verifique se existe coluna % MATERIAL na planilha.\n`; }

  resp += `\n━━━━━━━━━━━━━━━\n`;
  resp += `🤖 Alerta automático toda Segunda às 08:00`;

  await ctx.reply(resp, { parse_mode: 'Markdown',...menuFiltros });
}

bot.action(/filtro_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  esperandoFiltro[ctx.from.id] = ctx.match[1];
  await ctx.reply(`🔍 *Filtro: ${ctx.match[1]}*\nDigite o valor:`, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
  const textoOriginal = ctx.message.text.trim();
  if (textoOriginal.startsWith('/')) return;
  const id = ctx.from.id;
  const texto = textoOriginal.toLowerCase();
  const { cabecalho, dados } = await lerPlanilhaCompleta();
  const filtroAtivo = esperandoFiltro[id];
  let encontradas = [];
  if (filtroAtivo && cabecalho.includes(filtroAtivo)) {
    encontradas = dados.filter(d => (d[filtroAtivo]||'').toLowerCase().includes(texto)).slice(0,5);
    delete esperandoFiltro[id];
  } else {
    encontradas = dados.filter(d => d._textoBusca.includes(texto)).slice(0,5);
  }
  if (encontradas.length>0) {
    for (const os of encontradas) {
      await ctx.reply(`*OS:* ${os['OS']} | *CODIGO:* ${os['CODIGO']}\n*SETOR:* ${os['SETOR']} | *FAMILIA:* ${os['FAMILIA']}\n*STATUS:* ${os['STATUS']} | *LEAD:* ${os._leadTime||0} dias`, { parse_mode: 'Markdown' });
    }
    await ctx.reply('Nova busca?', menuFiltros);
  } else {
    await ctx.reply(`❌ Nada para "${textoOriginal}"`, {...menuFiltros});
    delete esperandoFiltro[id];
  }
});

// ENVIO AUTOMÁTICO SEMANAL - Se quiser ativar, configure CRON no Render
app.get('/disparo-semanal', async (req,res)=>{
  const { dados } = await lerPlanilhaCompleta();
  const maisAntigas = [...dados].filter(d=>d._leadTime>0).sort((a,b)=>b._leadTime - a._leadTime).slice(0,5);
  let msg = `🚨 *ALERTA AUTOMÁTICO SEMANAL*\n\n⏳ Maior Lead Time:\n`;
  maisAntigas.forEach(os=> msg+=`• OS ${os['OS']} - ${os._leadTime} dias - ${os['SETOR']}\n`);
  // Envia para você - COLOQUE SEU CHAT_ID aqui
  const CHAT_ID = process.env.ADMIN_CHAT_ID;
  if(CHAT_ID) await bot.telegram.sendMessage(CHAT_ID, msg, {parse_mode:'Markdown'});
  res.json({ok:true, enviadas: maisAntigas.length});
});

app.get('/', (req, res) => res.json({ ok: true }));
app.use(bot.webhookCallback('/telegram'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await bot.telegram.setWebhook(`https://oraculo-api-7ozv.onrender.com/telegram`);
  console.log('Oráculo com ALERTAS online');
});