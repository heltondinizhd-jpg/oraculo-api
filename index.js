const express = require('express');
const app = express();
app.use(express.json());

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const ABA_ORDENS = process.env.ABA_ORDENS || 'BD_OS'; // primeira aba - se der erro troca pra 'Página1' ou 'Ordens'
const ABA_MATERIAIS = 'BD_MAT';

function parseCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^"|"$/g,'').trim());
    const obj = {};
    headers.forEach((h,i) => obj[h] = values[i] || '');
    return obj;
  });
}

async function getSheet(aba) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(aba)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Aba ${aba} não encontrada`);
  const csv = await res.text();
  return parseCSV(csv);
}

function findCol(obj, nomes) {
  const keys = Object.keys(obj);
  for (let n of nomes) {
    const found = keys.find(k => k.includes(n));
    if (found) return obj[found];
  }
  return '';
}

function gerarResumo(ordens) {
  const porSetor = {};
  ordens.forEach(o => {
    const setor = findCol(o, ['setor', 'area', 'departamento']) || 'SEM SETOR';
    porSetor[setor.toUpperCase()] = (porSetor[setor.toUpperCase()] || 0) + 1;
  });
  let txt = `🔮 *RESUMO POR SETOR* (${ordens.length} OS no total)\n\n`;
  Object.entries(porSetor).sort((a,b)=>b[1]-a[1]).forEach(([setor, qtd]) => {
    txt += `▪️ ${setor}: *${qtd}* OS\n`;
  });
  txt += `\nDigite "setor NOME" para listar. Ex: setor pintura`;
  return txt;
}

function listarPorSetor(ordens, setorBusca) {
  const filtradas = ordens.filter(o => {
    const setor = (findCol(o, ['setor','area','departamento']) || '').toLowerCase();
    return setor.includes(setorBusca.toLowerCase());
  });
  if (!filtradas.length) return `Nenhuma OS encontrada no setor "${setorBusca}"`;
  let txt = `📋 *SETOR ${setorBusca.toUpperCase()}* - ${filtradas.length} OS\n\n`;
  filtradas.slice(0,30).forEach(o => {
    const os = findCol(o, ['os','ordem','nº','numero']) || '?';
    const cliente = findCol(o, ['cliente','nome']) || '';
    const status = findCol(o, ['status','situação','situacao']) || '';
    txt += `• OS ${os} - ${cliente} (${status})\n`;
  });
  if (filtradas.length > 30) txt += `\n...e mais ${filtradas.length-30} OS`;
  return txt;
}

function formatarOrdemCompleta(ordem, materiais) {
  if (!ordem) return `❌ OS não encontrada na planilha.`;
  const os = findCol(ordem, ['os','ordem','nº','numero']);
  const cliente = findCol(ordem, ['cliente','nome']);
  const setor = findCol(ordem, ['setor','area']);
  const status = findCol(ordem, ['status','situação']);
  const carro = findCol(ordem, ['veiculo','carro','modelo','placa']) || '';

  let txt = `🔧 *ORDEM ${os}*\n`;
  txt += `👤 Cliente: ${cliente}\n`;
  if (carro) txt += `🚗 Veículo: ${carro}\n`;
  if (setor) txt += `🏭 Setor: ${setor}\n`;
  if (status) txt += `📊 Status: ${status}\n`;

  if (materiais.length) {
    txt += `\n📦 *MATERIAIS (${materiais.length} itens) - BD_MAT:*\n`;
    materiais.forEach(m => {
      const item = findCol(m, ['material','item','descricao','descrição','peça','peca']) || JSON.stringify(m);
      const qtd = findCol(m, ['qtd','quantidade','qtde']) || '1';
      const valor = findCol(m, ['valor','preço','preco','custo']) || '';
      txt += `• ${item} - Qtd: ${qtd} ${valor? ` - R$ ${valor}` : ''}\n`;
    });
  } else {
    txt += `\n📦 Nenhum material lançado para essa OS na aba BD_MAT`;
  }
  return txt;
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
  });
}

app.get('/', (req,res) => res.send('Oráculo online 🔮 v2 com BD_MAT'));

app.post('/webhook/telegram', async (req,res) => {
  try {
    const msg = req.body.message;
    if (!msg ||!msg.text) return res.sendStatus(200);

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    const ordens = await getSheet(ABA_ORDENS).catch(async () => {
      // fallback se nome da primeira aba estiver diferente
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
      const r = await fetch(url);
      return parseCSV(await r.text());
    });

    let resposta = '';

    if (lower.includes('resumo') || lower === 'setores' || lower === '/resumo' || lower === '/setores') {
      resposta = gerarResumo(ordens);
    } else if (lower.startsWith('setor') || lower.startsWith('/setor')) {
      const setorBusca = text.replace(/\/setor|setor/gi,'').trim();
      if (!setorBusca) {
        resposta = gerarResumo(ordens);
      } else {
        resposta = listarPorSetor(ordens, setorBusca);
      }
    } else {
      // tenta achar OS numérica
      const numMatch = text.match(/\d+/);
      if (numMatch) {
        const osBusca = numMatch[0];
        const ordem = ordens.find(o => Object.values(o).some(v => v == osBusca));
        let materiais = [];
        try {
          const mats = await getSheet(ABA_MATERIAIS);
          materiais = mats.filter(m => Object.values(m).some(v => v == osBusca));
        } catch(e) {
          console.log('Erro BD_MAT:', e.message);
        }
        resposta = formatarOrdemCompleta(ordem, materiais);
      } else {
        resposta = `🤖 *Oráculo Oficina*\n\nComandos:\n• Digite o número da OS (ex: 1025)\n• "setor pintura" - lista OS do setor\n• "resumo" - resumo por setor\n• "/setores" - total por setor`;
      }
    }

    await sendTelegram(chatId, resposta);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Rodando na porta', PORT));