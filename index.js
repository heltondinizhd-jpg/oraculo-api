const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID || '7649089144'; // SEU ID

if (!BOT_TOKEN) { console.log('FALTA BOT_TOKEN'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// --- MEMÓRIA ---
global.SOLICITACOES = global.SOLICITACOES || [];
let estado = {};
let OS_LISTA = [
  { _os: '25291524', desc: 'BRITAGEM - Exemplo' },
  { _os: '25291525', desc: 'MOAGEM - Exemplo' }
];

const menu = Markup.keyboard([['📋 OS Pendentes'],['📋 Solicitações']]).resize();

bot.start((ctx)=>{
  ctx.reply('Bem vindo ao Cansl Oráculo! Escolha:', menu);
});

bot.hears('📋 OS Pendentes', async (ctx)=>{
  let txt = 'OS Pendentes:\n';
  const botoes = OS_LISTA.map(it=>[
    Markup.button.callback(`${it._os} - ${it.desc}`, `os:${it._os}`)
  ]);
  await ctx.reply(txt, Markup.inlineKeyboard(botoes));
});

bot.action(/os:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  const os = ctx.match[1];
  const it = OS_LISTA.find(o=>o._os===os) || {_os:os};
  await ctx.reply(`OS: ${it._os}\n${it.desc||''}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Ver pendências','pend:'+it._os)],
      [Markup.button.callback('📋 Solicitar Info','solicitar:'+it._os)]
    ])
  );
});

bot.action(/pend:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  ctx.reply('Pendências da OS '+ctx.match[1]+':\n- Exemplo pend 1\n- Exemplo pend 2');
});

// --- SOLICITAR ---
bot.action(/solicitar:(.+)/, async (ctx)=>{
  try{
    await ctx.answerCbQuery();
    const os = ctx.match[1];
    estado[ctx.from.id] = 'SOLICITA_'+os;
    await ctx.reply(`📋 OS ${os}\nO que você precisa saber?\n\nDigite sua dúvida (ex: foto, medida, status):`);
  }catch(e){}
});

bot.command('solicitacoes', async (ctx)=>{
  if(String(ctx.from.id)!== String(OWNER_ID)) return ctx.reply('Apenas admin.');
  if(!global.SOLICITACOES.length) return ctx.reply('Nenhuma solicitação aberta.');
  let txt = '📋 FILA DE SOLICITAÇÕES (10 últimas)\n\n';
  global.SOLICITACOES.slice(0,10).forEach(s=>{
    txt+=`ID:${s.id}\nOS:${s.os} | ${s.quem}\n"${s.texto}"\nStatus: ${s.status}\n/resp ${s.id} sua resposta\n\n`;
  });
  ctx.reply(txt);
});

bot.command('resp', async (ctx)=>{
  if(String(ctx.from.id)!== String(OWNER_ID)) return;
  const args = ctx.message.text.split(' ');
  const id = args[1];
  const resposta = args.slice(2).join(' ');
  if(!id ||!resposta) return ctx.reply('Uso: /resp ID resposta');
  const sol = global.SOLICITACOES.find(s=>String(s.id)===String(id));
  if(!sol) return ctx.reply('ID não encontrado');
  sol.status='respondida';
  try{
    await bot.telegram.sendMessage(sol.quemId, `✅ RESPOSTA OS ${sol.os}\n\nSeu pedido: "${sol.texto}"\nResposta: ${resposta}`);
    ctx.reply('✅ Enviado para '+sol.quem);
  }catch(e){ ctx.reply('Erro: '+e.message); }
});

bot.action(/resp:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  if(String(ctx.from.id)!== String(OWNER_ID)) return;
  const id = ctx.match[1];
  estado[ctx.from.id]='RESPONDENDO_'+id;
  ctx.reply(`Digite a resposta para ID ${id}:`);
});

bot.hears('📋 Solicitações', (ctx)=>{
  if(String(ctx.from.id)!== String(OWNER_ID)) return ctx.reply('Apenas admin pode ver a fila.');
  ctx.reply('Use /solicitacoes para ver a fila');
});

// --- CAPTURA DE TEXTO GERAL ---
bot.on('text', async (ctx)=>{
  const uid = ctx.from.id;
  const t = ctx.message.text;

  if(estado[uid] && estado[uid].startsWith('RESPONDENDO_')){
    const id = estado[uid].split('_')[1];
    const sol = global.SOLICITACOES.find(s=>String(s.id)===String(id));
    if(sol){
      sol.status='respondida';
      estado[uid]=null;
      await bot.telegram.sendMessage(sol.quemId, `✅ RESPOSTA OS ${sol.os}\n\nSeu pedido: "${sol.texto}"\nResposta: ${t}`);
      return ctx.reply('✅ Enviado para '+sol.quem, menu);
    }
  }

  if(estado[uid] && estado[uid].startsWith('SOLICITA_')){
    const os = estado[uid].split('_')[1];
    const nova = {
      id: Date.now(),
      os: os,
      quem: ctx.from.first_name + (ctx.from.username? ' @'+ctx.from.username : ''),
      quemId: uid,
      texto: t,
      data: new Date().toLocaleString('pt-BR'),
      status: 'aberta'
    };
    global.SOLICITACOES.unshift(nova);
    estado[uid]=null;
    await ctx.reply(`✅ Solicitação OS ${os} enviada pro Cansl Oráculo!\n\n"${t}"`, menu);
    try{
      await bot.telegram.sendMessage(OWNER_ID,
        `🔔 NOVA SOLICITAÇÃO\n\nOS: ${os}\nQuem: ${nova.quem} (ID:${uid})\nPedido: ${t}\n\nID: ${nova.id}\nResponda: /resp ${nova.id} sua resposta`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ Responder','resp:'+nova.id)]])
      );
    }catch(e){}
    return;
  }
});

// --- EXPRESS ---
app.use(express.json());
app.get('/', (req,res)=> res.send('Cansl Oráculo V13.7 Online'));
app.get('/api/solicitacoes', (req,res)=> res.json(global.SOLICITACOES));

app.post(`/bot${BOT_TOKEN}`, (req,res)=>{ bot.handleUpdate(req.body); res.sendStatus(200); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, async ()=>{
  console.log('Rodando porta '+PORT);
  try{
    const url = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
    await bot.telegram.setWebhook(`${url}/bot${BOT_TOKEN}`);
    console.log('Webhook set: '+url);
  }catch(e){ console.log('Erro webhook', e.message); }
});