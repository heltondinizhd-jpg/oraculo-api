async function lerMateriais(){
  if(cacheMat.dados && Date.now()-cacheMat.hora<120000) return cacheMat.dados;
  const tentativas=[
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv&sheet=BD_MAT',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=2'
  ];
  for(let url of tentativas){
    try{
      const r=await axios.get(url,{responseType:'text',timeout:15000});
      if(r.data.includes('<html')) continue;
      const cab=r.data.split('\n')[0].toUpperCase();
      if(cab.includes('SETOR') && cab.includes('GRUPO')) continue; // pula DB_ORDENS
      if(cab.includes('MATERIAL') || cab.includes('QTD')){
        const linhas=r.data.split(/\r?\n/).filter(l=>l.trim());
        const porOS={}, porOSPend={}, total=0; let totalPend=0;
        for(let i=1;i<linhas.length;i++){
          let line=linhas[i], cols=[], cur='', inQ=false;
          for(let j=0;j<line.length;j++){
            let c=line[j];
            if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ; }
            else if(c==',' &&!inQ){ cols.push(cur); cur=''; } else cur+=c;
          }
          cols.push(cur);
          const clean=cols.map(s=>s.replace(/^"|"$/g,'').trim());
          const os=(clean[0]||'').replace(/\D/g,''); if(!os) continue;
          const item=clean[2]||'', material=clean[3]||'', txtMat=clean[4]||'', qtdNec=clean[5]||'', qtdRet=clean[6]||'', po=clean[7]||'';
          const retNum = parseFloat(qtdRet.replace(/\./g,'').replace(',','.'));
          const isPendente = qtdRet==='' || qtdRet==='0' || qtdRet==='0,000' || qtdRet==='0,00' || isNaN(retNum) || retNum===0;

          if(!porOS[os]) porOS[os]=[];
          porOS[os].push({item, material, txtMat, qtdNec, qtdRet, po, pend:isPendente});
          total++;

          if(isPendente){
            if(!porOSPend[os]) porOSPend[os]=[];
            porOSPend[os].push({item, material, txtMat, qtdNec, qtdRet, po});
            totalPend++;
          }
        }
        const res={porOS, porOSPend, total, totalPend};
        cacheMat={dados:res,hora:Date.now()};
        console.log('BD_MAT OK total='+total+' pend='+totalPend);
        return res;
      }
    }catch(e){}
  }
  return {porOS:{}, porOSPend:{}, total:0, totalPend:0};
}