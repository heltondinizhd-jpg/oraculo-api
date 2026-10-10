// ADICIONA NO MENU - linha nova
const menu=Markup.keyboard([
  ['🔍 Buscar OS','📦 Materiais OS'],
  ['📊 Resumo','📈 Dashboard'],
  ['🏢 Setores','🧹 Limpar']
]).resize();

// ADICIONA ESSES 2 HANDLERS NOVOS DEPOIS DO bot.hears(/Resumo/...

bot.hears(/Setores/, async function(ctx){
  const d=await lerPlanilha();
  const setores=Object.keys(d.porSetor).sort();
  if(!setores.length) return ctx.reply('Nenhum setor encontrado',menu);
  const botoes=setores.map(function(s){
    return [Markup.button.callback(s+' ('+d.porSetor[s]+')','setor:'+s+':0')];
  });
  await ctx.reply('🏢 Escolha o setor:', Markup.inlineKeyboard(botoes));
});

bot.action(/setor:(.+):(\d+)/, async function(ctx){
  await ctx.answerCbQuery();
  const parts=ctx.match[1].split(':');
  // corrige quando setor tem : no nome
  let setor, page;
  if(ctx.match[0].includes(':')){
    const m=ctx.match[0].match(/setor:(.+):(\d+)/);
    setor=m[1]; page=parseInt(m[2])||0;
  } else { setor=parts[0]; page=parseInt(parts[1])||0; }
  // fallback
  if(!setor){ setor=ctx.match[1]; page=parseInt(ctx.match[2])||0; }
  // pega da callback original
  const raw=ctx.callbackQuery.data;
  const lastColon=raw.lastIndexOf(':');
  const pageNum=parseInt(raw.substring(lastColon+1))||0;
  const setorNome=raw.substring(6,lastColon);

  const d=await lerPlanilha(); const m=await lerMateriais();
  const lista=d.dadosFull.filter(function(x){ return x._setor===setorNome; });
  // remove duplicadas por OS
  const unicas={}; lista.forEach(function(it){ unicas[it._os]=it; });
  const ordens=Object.values(unicas);

  const porPagina=10;
  const totalPag=Math.ceil(ordens.length/porPagina);
  const inicio=pageNum*porPagina;
  const slice=ordens.slice(inicio,inicio+porPagina);

  if(!slice.length) return ctx.reply('Nada para setor '+setorNome,menu);

  let txt='🏢 SETOR: '+setorNome+'\nTotal: '+ordens.length+' ordens | Pag '+(pageNum+1)+'/'+totalPag+'\n\n';
  slice.forEach(function(it,i){
    const qTot=m.porOS[it._os]?.length||0;
    const qPend=m.porOSPend[it._os]?.length||0;
    txt+=(inicio+i+1)+') OS:'+it._os+' | '+it._familia+' | '+it._macro+' | Pend:'+qPend+'/'+qTot+'\n';
  });

  const nav=[];
  if(pageNum>0) nav.push(Markup.button.callback('⬅️ Anterior','setor:'+setorNome+':'+(pageNum-1)));
  if(pageNum<totalPag-1) nav.push(Markup.button.callback('Próxima ➡️','setor:'+setorNome+':'+(pageNum+1)));

  const teclado=nav.length?[nav]:[];
  // adiciona botão de ver detalhes da OS clicando
  const botoesOS=slice.slice(0,5).map(function(it){
    return [Markup.button.callback('📋 Ver OS '+it._os,'detos:'+it._os)];
  });

  await ctx.reply(txt, Markup.inlineKeyboard([...botoesOS,...teclado]));
});

// aproveita o botão de ver OS detalhada
bot.action(/detos:(.+)/, async function(ctx){
  await ctx.answerCbQuery();
  const os=ctx.match[1];
  const d=await lerPlanilha(); const m=await lerMateriais();
  const ach=d.dadosFull.filter(function(x){ return x._os===os; });
  if(!ach.length) return ctx.reply('OS '+os+' não encontrada',menu);
  const it=ach[0];
  let det='📋 OS:'+it._os+' Macro:'+it._macro+'\n🏢 Setor:'+it._setor+'\n👪 Familia:'+it._familia+'\n';
  for(const kv of Object.entries(it._row)){ if(kv[1]) det+=kv[0]+':'+kv[1]+'\n'; }
  const qTot=m.porOS[it._os]?.length||0; const qPend=m.porOSPend[it._os]?.length||0;
  det+='\n📦 BD_MAT total '+qTot+' pend '+qPend;
  if(qPend>0) await ctx.reply(det.substring(0,3900), Markup.inlineKeyboard([[Markup.button.callback('📦 Ver '+qPend+' pend','pend:'+os)]]));
  else await ctx.reply(det.substring(0,4000),menu);
});