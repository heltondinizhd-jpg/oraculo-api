async function lerMateriais(){
  if(cacheMat.dados && Date.now() - cacheMat.hora < 120000) return cacheMat.dados;

  // Tenta por NOME primeiro e por GID depois
  const tentativas = [
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv&sheet=BD_MAT',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&sheet=BD_MAT',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1957311427',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=1132978923',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=2',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=3',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=4',
    'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid=5'
  ];

  for(let url of tentativas){
    try{
      console.log('TESTANDO BD_MAT URL: '+url);
      const r = await axios.get(url, { responseType:'text', timeout:20000 });
      if(r.data.includes('<html') || r.data.length < 50) continue;

      const primeiraLinha = r.data.split(/\n/)[0].toUpperCase();
      console.log('CABECALHO: '+primeiraLinha.substring(0,150));

      // SE FOR DB_ORDENS, pula
      if(primeiraLinha.includes('SETOR') && primeiraLinha.includes('GRUPO')){
        console.log('-> E DB_ORDENS, pulando');
        continue;
      }
      // SE FOR BD_MAT, achou!
      if(primeiraLinha.includes('MATERIAL') || primeiraLinha.includes('QTD') || primeiraLinha.includes('RETIRADA') || primeiraLinha.includes('PO')){
        console.log('-> ACHOU BD_MAT!');
        const linhas = r.data.split(/\r?\n/).filter(l=>l.trim());
        const porOS = {}; let total=0;
        for(let i=1;i<linhas.length;i++){
          let line=linhas[i], cols=[], cur='', inQ=false;
          for(let j=0;j<line.length;j++){
            let c=line[j];
            if(c=='"'){ if(line[j+1]=='"'){cur+='"';j++;} else inQ=!inQ; }
            else if(c==',' &&!inQ){ cols.push(cur); cur=''; } else cur+=c;
          }
          cols.push(cur);
          const clean = cols.map(s=>s.replace(/^"|"$/g,'').trim());
          const os = (clean[0]||'').replace(/\D/g,''); if(!os) continue;
          if(!porOS[os]) porOS[os]=[];
          porOS[os].push({ txtOrdem:clean[1]||'', item:clean[2]||'', material:clean[3]||'', txtMat:clean[4]||'', qtdNec:clean[5]||'', qtdRet:clean[6]||'', po:clean[7]||'' });
          total++;
        }
        const res={porOS,total};
        cacheMat={dados:res, hora:Date.now()};
        console.log('BD_MAT OK total='+total);
        return res;
      }
    }catch(e){
      console.log('Falha '+url+' '+e.message);
    }
  }
  console.log('BD_MAT NAO ACHADA EM NENHUM GID');
  return cacheMat.dados || {porOS:{}, total:0};
}