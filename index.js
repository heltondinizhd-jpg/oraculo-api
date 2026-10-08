bot.on('text', async (ctx) => {
  const textoOriginal = ctx.message.text.trim();
  if (textoOriginal.startsWith('/')) return;
  const id = ctx.from.id;
  const texto = textoOriginal.toLowerCase();
  const { cabecalho, dados } = await lerPlanilhaCompleta();
  const filtroAtivo = esperandoFiltro[id];
  let encontradas = [];

  if (filtroAtivo && cabecalho.includes(filtroAtivo)) {
    encontradas = dados.filter(d => (d[filtroAtivo]||'').toLowerCase().includes(texto));
    delete esperandoFiltro[id];
  } else {
    encontradas = dados.filter(d => d._textoBusca.includes(texto));
  }

  if (encontradas.length === 0) {
    await ctx.reply(`❌ Nenhuma OS para "${textoOriginal}" em ${filtroAtivo || 'GERAL'}`, {...menuFiltros});
    return;
  }

  // 1 OS = FICHA COMPLETA
  if (encontradas.length === 1) {
    const os = encontradas[0];
    let r = `🔍 *FICHA COMPLETA OS ${os['OS']}*\n━━━━━━━━━━━━━━━\n`;
    cabecalho.forEach(col => {
      if(col.startsWith('_')) return;
      r += `*${col}:* ${os[col] || '-'}\n`;
    });
    r += `*LEAD TIME:* ${os._leadTime} dias (${os._emissaoRaw})\n`;
    await ctx.reply(r.substring(0,4000), { parse_mode: 'Markdown',...menuFiltros });
    if (r.length > 4000) await ctx.reply(r.substring(4000), { parse_mode: 'Markdown' });
    return;
  }

  // VÁRIAS OS = LISTA TODAS (SEM CORTAR EM 5)
  await ctx.reply(`✅ *${encontradas.length} OS ENCONTRADAS EM ${filtroAtivo || 'GERAL'} para "${textoOriginal}":*`, { parse_mode: 'Markdown' });

  // Manda de 10 em 10 pra não travar o Telegram
  for (let i = 0; i < encontradas.length; i += 10) {
    const lote = encontradas.slice(i, i+10);
    let msg = '';
    lote.forEach((os, idx) => {
      msg += `${i+idx+1}. *OS ${os['OS']}* | COD ${os['CODIGO']} | ${os['SETOR']} | ${os['FAMILIA']} | LEAD ${os._leadTime}d | ${os['STATUS']}\n`;
    });
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  }
  await ctx.reply(`Fim da lista: ${encontradas.length} OS no total.`, menuFiltros);
});