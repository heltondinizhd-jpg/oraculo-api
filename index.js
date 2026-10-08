bot.command('alertas', async (ctx) => {
  const { dados } = await lerPlanilhaCompleta();
  
  const imediatas = dados.filter(d=>d._leadTime >= 180).sort((a,b)=>b._leadTime - a._leadTime);
  const urgentes = dados.filter(d=>d._leadTime >= 150 && d._leadTime < 180).sort((a,b)=>b._leadTime - a._leadTime);
  const prioritarias = dados.filter(d=>d._leadTime >= 120 && d._leadTime < 150).sort((a,b)=>b._leadTime - a._leadTime);
  
  const total = imediatas.length + urgentes.length + prioritarias.length;
  
  if (total === 0) {
    await ctx.reply(`✅ Nenhuma OS com mais de 120 dias!`, {...menuFiltros});
    return;
  }

  let txt = `🚨 *ALERTAS LEAD > 120 DIAS: ${total} OS*\n━━━━━━━━━━━━\n`;

  if (imediatas.length > 0) {
    txt += `\n🔴 *TRATATIVA IMEDIATA (>=180d): ${imediatas.length} OS*\n`;
    imediatas.slice(0,15).forEach(o=>{ txt+=`• OS ${o['OS']} | COD ${o['CODIGO']} | ${o._leadTime}d | ${o['SETOR']}\n`; });
    if (imediatas.length > 15) txt += `... e mais ${imediatas.length - 15}\n`;
  }
  if (urgentes.length > 0) {
    txt += `\n🟠 *URGENTE (150-179d): ${urgentes.length} OS*\n`;
    urgentes.slice(0,15).forEach(o=>{ txt+=`• OS ${o['OS']} | COD ${o['CODIGO']} | ${o._leadTime}d | ${o['SETOR']}\n`; });
    if (urgentes.length > 15) txt += `... e mais ${urgentes.length - 15}\n`;
  }
  if (prioritarias.length > 0) {
    txt += `\n🟡 *PRIORITÁRIO (120-149d): ${prioritarias.length} OS*\n`;
    prioritarias.slice(0,15).forEach(o=>{ txt+=`• OS ${o['OS']} | COD ${o['CODIGO']} | ${o._leadTime}d | ${o['SETOR']}\n`; });
    if (prioritarias.length > 15) txt += `... e mais ${prioritarias.length - 15}\n`;
  }

  // Envia dividido se for muito grande
  if (txt.length > 4000) {
    const partes = txt.match(/.{1,4000}/gs);
    for (const p of partes) await ctx.reply(p, { parse_mode: 'Markdown' });
    await ctx.reply(`Resumo: Imediata ${imediatas.length} | Urgente ${urgentes.length} | Prioritária ${prioritarias.length}`, menuFiltros);
  } else {
    await ctx.reply(txt, { parse_mode: 'Markdown',...menuFiltros });
  }
});