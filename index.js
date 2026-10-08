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

  if (encontradas.length > 0) {

    // SE FOR 1 OS SÓ -> MOSTRA TUDO
    if (encontradas.length === 1) {
      const os = encontradas[0];
      let r = `🔍 *FICHA COMPLETA DA OS ${os['OS']}*\n`;
      r += `━━━━━━━━━━━━━━━━━━━━━\n`;
      // Mostra TODAS as colunas da planilha
      cabecalho.forEach(col => {
        if (col.startsWith('_')) return; // ignora interno
        const valor = os[col] || '-';
        r += `*${col}:* ${valor}\n`;
      });
      r += `━━━━━━━━━━━━━━━━━━━━━\n`;
      r += `*LEAD TIME CALCULADO:* ${os._leadTime || 0} dias\n`;

      // Quebra se for muito grande (Telegram limite 4096)
      if (r.length > 4000) {
        await ctx.reply(r.substring(0,4000), { parse_mode: 'Markdown' });
        await ctx.reply(r.substring(4000), { parse_mode: 'Markdown',...menuFiltros });
      } else {
        await ctx.reply(r, { parse_mode: 'Markdown',...menuFiltros });
      }

    } else {
      // SE FOR VÁRIAS -> MOSTRA RESUMO (5 primeiras)
      const paraMostrar = encontradas.slice(0,5);
      await ctx.reply(`✅ *${encontradas.length} ENCONTRADAS - Mostrando ${paraMostrar.length}:*`, { parse_mode: 'Markdown' });
      for (const os of paraMostrar) {
        await ctx.reply(`*OS:* ${os['OS']} | *CODIGO:* ${os['CODIGO']}\n*SETOR:* ${os['SETOR']} | *FAMILIA:* ${os['FAMILIA']}\n*STATUS:* ${os['STATUS']} | *LEAD:* ${os._leadTime||0} dias\n_Digite a OS exata para ver ficha completa_`, { parse_mode: 'Markdown' });
      }
      if (encontradas.length > 5) {
        await ctx.reply(`... e mais ${encontradas.length - 5} OS. Refine a busca pelo número exato da OS para ver detalhes.`, {...menuFiltros});
      } else {
        await ctx.reply('Clique para nova busca:', menuFiltros);
      }
    }

  } else {
    await ctx.reply(`❌ Nada para "${textoOriginal}" em ${filtroAtivo || 'GERAL'}`, {...menuFiltros});
    delete esperandoFiltro[id];
  }
});