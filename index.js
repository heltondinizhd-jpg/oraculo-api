const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN;
const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const GROQ_KEY = process.env.GROQ_API_KEY;

const bot = new Telegraf(BOT_TOKEN);
let cachePlanilha = { dados: null, hora: 0 };

async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) return cachePlanilha.dados;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sheet1`;
  try {
    const { data } = await axios.get(url);
    const linhas = data.split('\n').filter(l => l.trim());
    const cabecalho = linhas[0].split(',').map(h => h.replace(/"/g,'').trim());
    const dados = [];
    for(let i=1; i < linhas.length; i++) {
      const cols = linhas[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g,'').trim());
      let obj = {};
      cabecalho.forEach((h, idx) => obj[h] = cols[idx] || '');
      obj._textoBusca = cols.join(' ').toLowerCase();
      dados.push(obj);
    }
    const res = { cabecalho, dados, csv: data.substring(0,15000) };
    cachePlanilha = { dados: res, hora: Date.now() };
    return res;
  } catch(e) { if(cachePlanilha.dados) return cachePlanilha.dados; throw e; }
}

const menuPrincipal = Markup.inlineKeyboard([
  [Markup.button.callback('🔧 Buscar por Código', 'buscar_codigo')],
  [Markup.button.callback('📝 Buscar por Sintoma', 'buscar_sintoma')],
  [Markup.button.callback('📊 Últimas 5 OS', 'ultimas')],
  [Markup.button.callback('🆘 Ajuda', 'ajuda')]
]);

bot.start(async (ctx) => {
  await ctx.reply(`🔮 *ORÁCULO DA MANUTENÇÃO*\n\nFala ${ctx.from.first_name}! Sou seu assistente técnico.\nO que você precisa hoje?`, { parse_mode: 'Markdown',...menuPrincipal });
});

bot.action('buscar_codigo', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🔧 *Me manda o número da OS ou do código da falha:*\nEx: 25295069', { parse_mode: 'Markdown' });
});

bot.action('buscar_sintoma', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📝 *Descreva o que está acontecendo:*\nEx: motor da ponte não liga, faz barulho\n\nPode escrever do seu jeito que eu entendo!', { parse_mode: 'Markdown' });
});

bot.action('ultimas', async (ctx) => {
  await ctx.answerCbQuery();
  const { dados } = await lerPlanilhaCompleta();
  const ultimas = dados.slice(-5).reverse();
  let resp = `📊 *ÚLTIMAS 5 OS CADASTRADAS:*\n\n`;
  ultimas.forEach((os,i) => {
    const codigo = Object.values(os)[0] || 'Sem código';
    resp += `${i+1}. ${codigo} - ${os._textoBusca.substring(0,60)}...\n`;
  });
  await ctx.reply(resp, { parse_mode: 'Markdown',...menuPrincipal });
});

bot.action('ajuda', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`🆘 *COMO USAR O ORÁCULO:*\n\n1️⃣ Clique em Buscar por Código se tiver o número\n2️⃣ Clique em Buscar por Sintoma se não tiver\n3️⃣ Eu busco na planilha e te dou a solução\n\n*Dica:* Pode mandar áudio? Ainda não, mas em breve!\n\nQuer falar com um humano? Digite: especialista`, { parse_mode: 'Markdown',...menuPrincipal });
});

bot.on('text', async (ctx) => {
  const textoOriginal = ctx.message.text.trim();
  if(textoOriginal.startsWith('/')) return;
  const texto = textoOriginal.toLowerCase();

  if (texto.includes('especialista') || texto.includes('humano')) {
    return ctx.reply('🆘 *Acionando especialista...*\n\nEnquanto isso, me conta qual equipamento e qual falha que eu já vou adiantando a busca.', { parse_mode: 'Markdown' });
  }

  await ctx.sendChatAction('typing');
  const { dados } = await lerPlanilhaCompleta();
  let encontradas = dados.filter(d => d._textoBusca.includes(texto)).slice(0, 3);

  if (encontradas.length === 0) {
    const palavras = texto.split(' ').filter(p => p.length > 2);
    encontradas = dados.filter(d => palavras.some(p => d._textoBusca.includes(p))).slice(0, 3);
  }

  if (encontradas.length > 0) {
    for (const os of encontradas) {
      let resp = `✅ *ENCONTREI ESSA OS:*\n\n`;
      Object.entries(os).forEach(([k,v]) => { if(k!=='_textoBusca' && v) resp += `*${k}:* ${v}\n`; });
      resp += `\n`;
      await ctx.reply(resp, { parse_mode: 'Markdown' });

      await ctx.reply('Essa solução resolveu?', Markup.inlineKeyboard([
        [Markup.button.callback('✅ Sim, resolveu!', 'resolveu'), Markup.button.callback('❌ Não resolveu', 'n_resolveu')],
        [Markup.button.callback('🔙 Menu', 'menu')]
      ]));
    }
  } else {
    await ctx.reply(`🤔 *Não achei "${textoOriginal}" exato na planilha.*\n\nQuer tentar de outro jeito ou quer que eu acione a IA para diagnosticar?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🤖 Tentar com IA', 'usar_ia')],
        [Markup.button.callback('🔙 Voltar ao Menu', 'menu')]
      ])
    );
    // Guarda a pergunta pra usar com IA depois
    ctx.session = { ultimaPergunta: textoOriginal };
  }
});

bot.action('menu', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🔮 Menu principal:', menuPrincipal);
});

bot.action('resolveu', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🎉 *Ótimo!* Fico feliz em ajudar!\n\nPrecisa de mais alguma coisa?', menuPrincipal);
});

bot.action('n_resolveu', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('😕 Entendi. Vou buscar outras OS parecidas ou acionar um especialista.\n\nMe descreve melhor o que acontece?', { parse_mode: 'Markdown' });
});

bot.action('usar_ia', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🤖 Acionando IA... (coloque a GROQ_API_KEY no Render para ativar)');
});

app.get('/', (req, res) => res.json({ ok: true }));
app.use(bot.webhookCallback('/telegram'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await bot.telegram.setWebhook(`https://oraculo-api-7ozv.onrender.com/telegram`);
  console.log('Oráculo Interativo Online');
});