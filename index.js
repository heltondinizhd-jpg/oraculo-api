const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN;
const SHEET_ID = '1OENZXXBhbfVxpsTNTyv5ZVBBjN-NooveITz3kr5U9PE';

console.log('Iniciando Oráculo... Sheet:', SHEET_ID);

const bot = new Telegraf(BOT_TOKEN);

async function buscarNaPlanilha(codigoBuscado) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
    const { data } = await axios.get(url);
    const linhas = data.split('\n').map(l => l.trim()).filter(l => l);

    if (linhas.length < 2) return null;

    const cabecalho = linhas[0].split(',').map(h => h.replace(/"/g,'').trim());

    for (let i = 1; i < linhas.length; i++) {
      // Divide respeitando aspas
      const colunas = linhas[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || linhas[i].split(',');
      const limpas = colunas.map(c => c.replace(/^"|"$/g, '').trim());

      // Verifica se o código está em QUALQUER coluna
      const textoLinha = limpas.join(' ').toLowerCase();
      if (textoLinha.includes(codigoBuscado.toLowerCase())) {
        let resposta = `🔮 *ORÁCULO - CÓDIGO ${codigoBuscado}*\n\n`;
        cabecalho.forEach((nome, idx) => {
          if (limpas[idx]) {
            resposta += `*${nome}:* ${limpas[idx]}\n`;
          }
        });
        return resposta;
      }
    }
    return null;
  } catch (err) {
    console.log('Erro ao buscar planilha:', err.message);
    return 'ERRO_PLANILHA: ' + err.message;
  }
}

bot.start((ctx) => ctx.reply('🔮 Oráculo da Manutenção Online!\n\nMe mande o código da falha (ex: 25295069) que eu busco na planilha.'));

bot.on('text', async (ctx) => {
  const codigo = ctx.message.text.trim();
  if (codigo.length < 2) return;

  await ctx.reply(`🔧 Buscando *${codigo}* na planilha...`, { parse_mode: 'Markdown' });

  const resultado = await buscarNaPlanilha(codigo);

  if (!resultado) {
    await ctx.reply(`❌ Código *${codigo}* não encontrado.\n\nConfira se digitou certo ou se o código existe na planilha.`, { parse_mode: 'Markdown' });
  } else if (resultado.startsWith('ERRO_PLANILHA')) {
    await ctx.reply(`⚠️ Erro ao ler a planilha. Verifique se o link está público.\n${resultado}`);
  } else {
    await ctx.reply(resultado, { parse_mode: 'Markdown' });
  }
});

app.get('/', (req, res) => res.json({ status: 'online', sheet: SHEET_ID }));
app.get('/health', (req, res) => res.json({ ok: true }));

app.use(bot.webhookCallback('/telegram'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('API na porta ' + PORT);
  try {
    const webhookUrl = `https://oraculo-api-7ozv.onrender.com/telegram`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log('Webhook OK: ' + webhookUrl);
  } catch (e) {
    console.log('Erro webhook:', e.message);
  }
});