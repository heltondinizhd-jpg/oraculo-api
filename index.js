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

// --- SUAS OS - mantém igual, só exemplo ---
let OS_LISTA = [
  { _os: '25291524', desc: 'BRITAGEM' },
  { _os: '25291525', desc: 'MOAGEM' }
];

// Menu principal - MANTIDO
const menu = Markup.keyboard([['📋 OS Pendentes'], ['📋 Minhas Solicitações']]).resize();

bot.start((ctx)=>{
  estado[ctx.from.id]=null;
  ctx.reply('🔱 Cansl Oráculo V13.8 Online!\nEscolha:', menu);
});

bot.hears('📋 OS Pendentes', async (ctx)=>{
  let botoes = OS_LISTA.map(it=>[
    Markup.button.callback(`${it._os}`, `os:${it._os}`)
  ]);
  await ctx.reply('📋 Selecione a OS:', Markup.inlineKeyboard(botoes));
});

bot.hears('📋 Minhas Solicitações', async (ctx)=>{
  const minhas = global.SOLICITACOES.filter(s=>s.quemId===ctx.from.id);
  if(!minhas.length) return ctx.reply('Você não tem solicitações.', menu);
  let txt='📋 Suas solicitações:\n\n';
  minhas.slice(0,10).forEach(s=> txt+=`OS:${s.os} - ${s.status}\n"${s.texto}"\n${s.resposta?'Resp: '+s.resposta:''}\n\n`);
  ctx.reply(txt, menu);
});

// Ação OS
bot.action(/os:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  const os = ctx.match[1];
  await ctx.reply(`OS: ${os}\nO que deseja?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Ver pendências','pend:'+os)],
      [Markup.button.callback('📋 Solicitar Info','solicitar:'+os)]
    ])
  );
});

bot.action(/pend:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  ctx.reply(`Pendências OS ${ctx.match[1]}:\n- Pend 1\n- Pend 2\n( aqui mantém sua lógica original )`);
});

// ===== NOVA FUNÇÃO - SOLICITAR =====
bot.action(/solicitar:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  const os = ctx.match[1];
  estado[ctx.from.id] = 'SOLICITA_'+os;
  ctx.reply(`📋 OS ${os}\nO que você precisa saber?\nDigite sua dúvida (foto, medida, status):`);
});

bot.command('solicitacoes', async (ctx)=>{
  if(String(ctx.from.id)!== String(OWNER_ID)) return ctx.reply('Apenas admin.');
  if(!global.SOLICITACOES.length) return ctx.reply('Fila vazia.');
  let txt='📋 FILA DE SOLICITAÇÕES\n\n';
  global.SOLICITACOES.slice(0,15).forEach(s=>{
    txt+=`ID:${s.id}\nOS:${s.os} | ${s.quem} | ID:${s.quemId}\n"${s.texto}"\nStatus:${s.status}\n/resp ${s.id} sua resposta\n\n`;
  });
  ctx.reply(txt);
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
    ctx.reply('✅ Resposta enviada para '+sol.quem);
  }catch(e){ ctx.reply('Erro: '+e.message); }
});

bot.action(/resp:(.+)/, async (ctx)=>{
  await ctx.answerCbQuery();
  if(String(ctx.from.id)!== String(OWNER_ID)) return;
  estado[ctx.from.id]='RESPONDENDO_'+ctx.match[1];
  ctx.reply(`Digite a resposta para ID ${ctx.match[1]}:`);
});
// ===== FIM NOVA FUNÇÃO =====

// Captura texto
bot.on('text', async (ctx)=>{
  const uid = ctx.from.id; const t = ctx.message.text;

  // Resposta do admin
  if(estado[uid] && String(estado[uid]).startsWith('RESPONDENDO_')){
    const id = String(estado[uid]).split('_')[1];
    const sol = global.SOLICITACOES.find(s=>String(s.id)===String(id));
    if(sol){
      sol.status='respondida'; sol.resposta=t; estado[uid]=null;
      await bot.telegram.sendMessage(sol.quemId, `✅ RESPOSTA OS ${sol.os}\n\nSeu pedido: "${sol.texto}"\nResposta: ${t}`);
      return ctx.reply('✅ Enviado!', menu);
    }
  }

  // Solicitação do usuário
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
    await ctx.reply(`✅ Solicitação OS ${os} enviada para o Cansl Oráculo!\n\n"${t}"\n\nTe respondemos aqui mesmo.`, menu);
    try{
      await bot.telegram.sendMessage(OWNER_ID,
        `🔔 NOVA SOLICITAÇÃO\n\nOS: ${os}\nQuem: ${nova.quem} (ID:${uid})\nPedido: ${t}\n\nID: ${nova.id}\nComando: /resp ${nova.id} sua resposta`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ Responder','resp:'+nova.id)]])
      );
    }catch(e){}
    return;
  }

  // --- AQUI MANTÉM SUAS OUTRAS LÓGICAS ANT