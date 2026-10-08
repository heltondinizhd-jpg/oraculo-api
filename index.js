const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN;
const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';
const GROQ_KEY = process.env.GROQ_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const bot = new Telegraf(BOT_TOKEN);

let cachePlanilha = { dados: null, hora: 0 };

async function lerPlanilhaCompleta() {
  if (cachePlanilha.dados && Date.now() - cachePlanilha.hora < 5*60*1000) {
    return cachePlanilha.dados;
  }
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sheet1`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`
  ];
  for (const url of urls) {
    try {
      const { data } = await axios.get(url, { timeout: 8000 });
      if (!data || data.includes('<!DOCTYPE')) continue;
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
      const resultado = { cabecalho, dados, csv: data.substring(0,15000) };
      cachePlanilha = { dados: resultado, hora: Date.now() };
      return resultado;
    } catch (e) { continue; }
  }
  if (cachePlanilha.dados) return cachePlanilha.dados;
  throw new Error('Planilha offline');
}

async function buscarComIA(pergunta, dadosPlanilha) {
  const apiKey = GROQ_KEY || OPENAI_KEY;
  if (!apiKey) return null;
  const isGroq =!!GROQ_KEY;
  const url = isGroq? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = isGroq? 'llama-3.1-8b-instant' : 'gpt-4o-mini';
  const prompt = `Você é o ORÁCULO DA MANUTENÇÃO. Usuário perguntou: "${pergunta}". Dados da planilha: ${dadosPlanilha.csv}. Ache o mais parecido.`;
  try {
    const { data } = await axios.post(url, {
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2, max_tokens: 600
    }, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    return data.choices[0].message.content;
  } catch (e) { return null; }
}

bot.start((ctx) => ctx.reply('🔮 *Oráculo V3 - Busca Múltipla*\nMande código ou descrição', { parse_mode: 'Markdown' }));

bot.on('text', async (ctx) => {
  const textoOriginal = ctx.message.text.trim();
  const texto = textoOriginal.toLowerCase();

  await ctx.reply(`🔧 Buscando *${textoOriginal}*...`, { parse_mode: 'Markdown' });

  try {
    const { dados } = await lerPlanilhaCompleta();

    // PEGA TODAS QUE CONTÉM
    let encontradas = dados.filter(d => d._textoBusca.includes(texto)).slice(0, 5);

    // Se não achou, tenta por palavras separadas
    if (encontradas.length === 0) {
      const palavras = texto.split(' ').filter(p => p.length > 2);
      encontradas = dados.filter(d => palavras.some(p => d._textoBusca.includes(p))).slice(0, 5);
    }

    if (encontradas.length > 0) {
      let resp = `✅ *${encontradas.length} OS ENCONTRADAS*\n\n`;
      encontradas.forEach((os, i) => {
        resp += `*--- OS ${i+1} ---*\n`;
        Object.entries(os).forEach(([k,v]) => { if(k!=='_textoBusca' && v) resp += `*${k}:* ${v}\n`; });
        resp += `\n`;
      });
      if (resp.length > 3800) {
        await ctx.reply(resp.substring(0,3800), { parse_mode: 'Markdown' });
        await ctx.reply(resp.substring(3800, 7600), { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(resp, { parse_mode: 'Markdown' });
      }
      return;
    }

    await ctx.reply(`🤖 Não achei exato, tentando com IA...`, { parse_mode: 'Markdown' });
    const rIA = await buscarComIA(textoOriginal, await lerPlanilhaCompleta());
    if (rIA) ctx.reply(rIA, { parse_mode: 'Markdown' });
    else ctx.reply(`❌ Nenhuma OS para *${textoOriginal}*`, { parse_mode: 'Markdown' });

  } catch (e) {
    ctx.reply('⚠️ Erro: ' + e.message);
  }
});

app.get('/', (req, res) => res.json({ ok: true }));
app.use(bot.webhookCallback('/telegram'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await bot.telegram.setWebhook(`https://oraculo-api-7ozv.onrender.com/telegram`);
  console.log('Oráculo V3 Online - Multi busca');
});