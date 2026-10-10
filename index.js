const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID || '7649089144';
if (!BOT_TOKEN) { console.log('FALTA BOT_TOKEN'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
global.SOLICITACOES = global.SOLICITACOES || [];
global.estado = global.estado || {};
let estado = global.estado;

let OS_LISTA = [
  { _os: '25291524', desc: 'BRITAGEM' },
  { _os: '25291525', desc: 'MOAGEM' }
];

const menu = Markup.keyboard([['📋 OS Pendentes'], ['📋 Minhas Solicitações']]).resize();

bot.start((ctx)=>{
  estado[ctx.from.id]=null;
  return ctx.reply('🔱 Cansl Oráculo V13.8 Online!\nEscolha:', menu);
});

bot.hears('📋 OS Pendentes', async (ctx)=>{
  let botoes = OS_LISTA.map(it=>[
    Markup.button.callback(it._os, `os:${it._os}`)
  ]);
  return ctx.reply('📋 Selecione a OS:', Markup.inlineKeyboard(botoes));
});

bot.hears('📋 Minhas Solicitações', async (ctx)=>{
  const minhas = global.SOLICITACOES.filter(s=>s.quemId===ctx.from.id);
  if(!minhas.length) return ctx.reply('Você não tem solicitações.', menu);
  let txt='📋 Suas solicitações:\n\n';
  minhas.slice(0,10).forEach(s=>{ txt+=`OS:${s.os} - ${s.status}\n"${s.texto}"\n${s.resposta?'Resp: '+s.resposta:''}\n\n`; });
  return ctx.reply(txt, menu);
});

bot.action(/os:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  const os = ctx.match[1];
  return ctx.reply(`OS: ${os}\nO que deseja?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Ver pendências','pend:'+os)],
      [Markup.button.callback('📋 Solicitar Info','solicitar:'+os)]
    ])
  );
});

bot.action(/pend:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  return ctx.reply(`Pendências OS ${ctx.match[1]}:\n- Pend 1\n- Pend 2`);
});

bot.action(/solicitar:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  const os = ctx.match[1];
  estado[ctx.from.id] = 'SOLICITA_'+os;
  return ctx.reply(`📋 OS ${os}\nO que você precisa saber?\nDigite sua dúvida:`);
});

bot.command('solicitacoes', async (ctx)=>{
  if(String(ctx.from.id)!== String(OWNER_ID)) return ctx.reply('Apenas admin.');
  if(!global.SOLICITACOES.length) return ctx.reply('Fila vazia.');
  let txt='📋 FILA DE SOLICITAÇÕES\n\n';
  global.SOLICITACOES.slice(0,15).forEach(s=>{
    txt+=`ID:${s.id}\nOS:${s.os} | ${s.quem}\n"${s.texto}"\nStatus:${s.status}\n/resp ${s.id} sua resposta\n\n`;
  });
  return ctx.reply(txt);
});

bot.command('resp', async (ctx)=>{
  if(String(ctx.from.id)!== String(OWNER_ID)) return;
  const args = ctx.message.text.split(' ');
  const id = args[1]; const resposta = args.slice(2).join(' ');
  if(!id||!resposta) return ctx.reply('Uso: /resp ID texto');
  const sol = global.SOLICITACOES.find(s=>String(s.id)===String(id));
  if(!sol) return ctx.reply('ID não encontrado');
  sol.status='respondida'; sol.resposta=resposta;
  try{
    await bot.telegram.sendMessage(sol.quemId, `✅ RESPOSTA OS ${sol.os}\n\nSeu pedido: "${sol.texto}"\nResposta do time Cansl: ${resposta}`);
    return ctx.reply('✅ Enviado para '+sol.quem);
  }catch(e){ return ctx.reply('Erro: '+e.message); }
});

bot.action(/resp:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  if(String(ctx.from.id)!== String(OWNER_ID)) return;
  estado[ctx.from.id]='RESPONDENDO_'+ctx.match[1];
  return ctx.reply(`Digite a resposta para ID ${ctx.match[1]}:`);
});

bot.on('text', async (ctx)=>{
  const uid = ctx.from.id; const t = ctx.message.text;
  if(estado[uid] && String(estado[uid]).startsWith('RESPONDENDO_')){
    const id = String(estado[uid]).split('_')[1];
    const sol = global.SOLICITACOES.find(s=>String(s.id)===String(id));
    if(sol){
      sol.status='respondida'; sol.resposta=t; estado[uid]=null;
      await bot.telegram.sendMessage(sol.quemId, `✅ RESPOSTA OS ${sol.os}\n\nSeu pedido: "${sol.texto}"\nResposta: ${t}`);
      return ctx.reply('✅ Enviado!', menu);
    }
  }
  if(estado[uid] && String(estado[uid]).startsWith('SOLICITA_')){
    const os = String(estado[uid]).split('_')[1];
    const nova = {
      id: Date.now(),
      os: os,
      quem: ctx.from.first_name + (ctx.from.username?' @'+ctx.from.username:''),
      quemId: uid,
      texto: t,
      data: new Date().toLocaleString('pt-BR'),
      status: 'aberta'
    };
    global.SOLICITACOES.unshift(nova);
    estado[uid]=null;
    await ctx.reply(`✅ Solicitação OS ${os} enviada para o Cansl Oráculo!\n\n"${t}"`, menu);
    try{
      await bot.telegram.sendMessage(OWNER_ID, `🔔 NOVA SOLICITAÇÃO\nOS:${os}\nQuem:${nova.quem} ID:${uid}\n${t}\n\nID:${nova.id}\n/resp ${nova.id} sua resposta`, Markup.inlineKeyboard([[Markup.button.callback('✅ Responder','resp:'+nova.id)]]));
    }catch(e){}
    return;
  }
});

app.use(express.json());
app.get('/', (req,res)=> res.send('Cansl Oráculo V13.8 Online - SEM ERRO'));
app.get('/api/solicitacoes', (req,res)=> res.json(global.SOLICITACOES));
app.post(`/bot${BOT_TOKEN}`, (req,res)=>{ bot.handleUpdate(req.body); res.sendStatus(200); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, async ()=>{
  console.log('Rodando porta '+PORT);
  try{
    const url = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
    await bot.telegram.setWebhook(`${url}/bot${BOT_TOKEN}`);
    console.log('Webhook: '+url);
  }catch(e){ console.log('Erro webhook', e.message); }
});