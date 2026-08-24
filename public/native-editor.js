(() => {
  const fileInput=document.getElementById('nativeFile'),uploadBox=document.getElementById('nativeUpload'),fileNameBox=document.getElementById('nativeFileName'),stage=document.getElementById('nativeStage'),status=document.getElementById('nativeStatus'),props=document.getElementById('nativeProps'),saveBtn=document.getElementById('nativeSave'),selectAllBtn=document.getElementById('nativeSelectAll'),rotateBtn=document.getElementById('nativeRotate');
  const fileNameOutInput=document.getElementById('nativeFileNameOut'),saveHint=document.getElementById('nativeSaveHint');
  const canPickSaveLocation=typeof window.showSaveFilePicker==='function';
  if(saveHint)saveHint.textContent=canPickSaveLocation?'Seu navegador permite escolher a pasta de destino ao salvar.':'Este navegador salva na pasta padrão de downloads (defina "perguntar onde salvar" nas configurações do navegador para escolher a pasta a cada vez).';
  const pager=document.getElementById('nativePager'),prevBtn=document.getElementById('nativePrevPage'),nextBtn=document.getElementById('nativeNextPage'),pageLabel=document.getElementById('nativePageLabel');
  const zoomInBtn=document.getElementById('nativeZoomIn'),zoomOutBtn=document.getElementById('nativeZoomOut'),zoomResetBtn=document.getElementById('nativeZoomReset'),zoomLabel=document.getElementById('nativeZoomLabel');
  const undoBtn=document.getElementById('nativeUndo'),redoBtn=document.getElementById('nativeRedo');
  const thumbsBox=document.getElementById('nativeThumbs');
  const searchInput=document.getElementById('nativeSearchInput'),searchPrev=document.getElementById('nativeSearchPrev'),searchNext=document.getElementById('nativeSearchNext'),searchCount=document.getElementById('nativeSearchCount');

  let mode='select',file=null,fileId=null,pageSizes=[],thumbnails=[],pageCount=0,textBoxes=[],selected=null,selectedItems=new Set(),dirty=false,currentPage=1;
  let zoom=1,baseWidth=0;
  let history=[],historyIndex=-1,suppressHistory=false;
  let searchMatches=[],searchIndex=-1;

  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const setStatus=m=>status.textContent=m;
  const hexToRgb=h=>{h=String(h||'#111111').replace('#','');if(!/^[0-9a-f]{6}$/i.test(h))return{r:17,g:17,b:17};return{r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)};};
  const getSelected=()=>textBoxes.filter(t=>selectedItems.has(String(t.id)));
  const refreshSelectionVisual=()=>document.querySelectorAll('.native-text-object').forEach(el=>el.classList.toggle('selected',selectedItems.has(String(el.dataset.id))));
  const clearSelection=()=>{selectedItems.clear();selected=null;refreshSelectionVisual();};

  // ---------------- Histórico (desfazer/refazer) ----------------
  function pushHistory(){
    if(suppressHistory)return;
    history=history.slice(0,historyIndex+1);
    history.push(JSON.stringify(textBoxes));
    if(history.length>60)history.shift();
    historyIndex=history.length-1;
    updateUndoRedoButtons();
  }
  function updateUndoRedoButtons(){
    undoBtn.disabled=historyIndex<=0;
    redoBtn.disabled=historyIndex>=history.length-1;
  }
  function applyHistoryState(){
    suppressHistory=true;
    textBoxes=JSON.parse(history[historyIndex]);
    clearSelection();
    refreshCurrentPageVisual();
    props.innerHTML='Selecione um texto para visualizar suas propriedades.';
    updateUndoRedoButtons();
    suppressHistory=false;
  }
  function undo(){if(historyIndex<=0)return;historyIndex--;applyHistoryState();setStatus('Alteração desfeita.');}
  function redo(){if(historyIndex>=history.length-1)return;historyIndex++;applyHistoryState();setStatus('Alteração refeita.');}
  undoBtn.addEventListener('click',undo);
  redoBtn.addEventListener('click',redo);

  document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{
    const action=btn.dataset.mode;
    if(['bold','italic','underline'].includes(action)&&selectedItems.size){applyBulk(action);return;}
    mode=action;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b===btn));setStatus(action==='delete'?'Clique no texto para marcá-lo como excluído. A área ficará branca na prévia.':action==='text'?'Clique em uma área da página para adicionar texto.':`Modo: ${btn.textContent.trim()}`);
  }));

  async function loadPdf(f){
    if(!f)return;
    if(!/\.pdf$/i.test(f.name)){setStatus('Selecione um arquivo PDF.');return;}
    file=f;
    if(fileNameBox){fileNameBox.textContent=`📄 ${file.name}`;fileNameBox.classList.add('show');}
    try{
      setStatus('Analisando PDF…');
      const fd=new FormData();fd.append('file',file);
      const r=await fetch('/api/inspect',{method:'POST',body:fd});
      if(!r.ok)throw new Error((await r.json()).error||'Falha ao analisar PDF.');
      const d=await r.json();
      fileId=d.fileId;pageSizes=d.pageSizes||[];thumbnails=d.thumbnails||[];pageCount=Number(d.pageCount)||1;
      textBoxes=(d.textBoxes||[]).map(t=>({...t,originalText:String(t.text??''),deleted:false,changed:false,color:'#111111',bold:false,italic:false,underline:false}));
      clearSelection();currentPage=1;zoom=1;baseWidth=0;
      history=[JSON.stringify(textBoxes)];historyIndex=0;updateUndoRedoButtons();
      renderPage(1);
      renderThumbs();
      saveBtn.disabled=false;
      if(fileNameOutInput){
        const base=file.name.replace(/\.pdf$/i,'').trim()||'documento';
        fileNameOutInput.value=`${base}-editado`;
        fileNameOutInput.disabled=false;
      }
      updatePager();
      setStatus(`${d.pageCount} página(s) carregada(s) · ${textBoxes.length} textos detectados.`);
    }catch(e){setStatus(e.message);}
  }
  fileInput.addEventListener('change',()=>loadPdf(fileInput.files?.[0]));
  ['dragenter','dragover'].forEach(ev=>uploadBox?.addEventListener(ev,e=>{e.preventDefault();uploadBox.style.borderColor='#e2604a';}));
  ['dragleave','drop'].forEach(ev=>uploadBox?.addEventListener(ev,e=>{e.preventDefault();uploadBox.style.borderColor='';}));
  uploadBox?.addEventListener('drop',e=>loadPdf(e.dataTransfer?.files?.[0]));

  // ---------------- Miniaturas ----------------
  function renderThumbs(){
    thumbsBox.innerHTML='';
    thumbnails.forEach((src,idx)=>{
      const page=idx+1;
      const cell=document.createElement('div');
      cell.className='native-thumb'+(page===currentPage?' active':'');
      cell.dataset.page=String(page);
      const img=document.createElement('img');
      img.src=src;img.alt=`Página ${page}`;img.loading='lazy';
      const num=document.createElement('span');
      num.className='native-thumb-num';num.textContent=String(page);
      cell.appendChild(img);cell.appendChild(num);
      cell.addEventListener('click',()=>{renderPage(page);updatePager();});
      thumbsBox.appendChild(cell);
    });
  }
  function refreshThumbActive(){
    thumbsBox.querySelectorAll('.native-thumb').forEach(el=>el.classList.toggle('active',Number(el.dataset.page)===currentPage));
  }

  function updatePager(){
    if(!fileId||pageCount<=0){pager.style.display='none';return;}
    pager.style.display='flex';
    pageLabel.textContent=`Página ${currentPage} de ${pageCount}`;
    prevBtn.disabled=currentPage<=1;
    nextBtn.disabled=currentPage>=pageCount;
    refreshThumbActive();
  }
  prevBtn?.addEventListener('click',()=>{if(currentPage>1){renderPage(currentPage-1);updatePager();}});
  nextBtn?.addEventListener('click',()=>{if(currentPage<pageCount){renderPage(currentPage+1);updatePager();}});

  // ---------------- Zoom ----------------
  function applyZoom(){
    const img=stage.querySelector('img');
    if(!img)return;
    if(!baseWidth){baseWidth=img.clientWidth||img.naturalWidth||600;}
    img.style.width=`${Math.round(baseWidth*zoom)}px`;
    img.style.maxWidth='none';
    zoomLabel.textContent=`${Math.round(zoom*100)}%`;
    requestAnimationFrame(()=>{
      const wrap=stage.querySelector('.native-page-wrap');
      if(wrap){wrap.style.width=`${img.clientWidth}px`;wrap.style.height=`${img.clientHeight}px`;}
      renderTextObjects(currentPage,img,wrap);
    });
  }
  zoomInBtn?.addEventListener('click',()=>{zoom=Math.min(3,+(zoom+0.15).toFixed(2));applyZoom();});
  zoomOutBtn?.addEventListener('click',()=>{zoom=Math.max(0.4,+(zoom-0.15).toFixed(2));applyZoom();});
  zoomResetBtn?.addEventListener('click',()=>{zoom=1;baseWidth=0;const img=stage.querySelector('img');if(img){img.style.width='';img.style.maxWidth='100%';}zoomLabel.textContent='100%';requestAnimationFrame(()=>{const wrap=stage.querySelector('.native-page-wrap');if(img&&wrap){wrap.style.width=`${img.clientWidth}px`;wrap.style.height=`${img.clientHeight}px`;}renderTextObjects(currentPage,img,wrap);});});

  // Navegar de página NÃO limpa a seleção nem o histórico - dá para
  // selecionar textos em várias páginas antes de aplicar uma ação em massa.
  function renderPage(page){
    currentPage=page;
    stage.innerHTML='';
    const wrap=document.createElement('div');
    wrap.className='native-page-wrap';
    wrap.style.cssText='position:relative;display:inline-block;line-height:0;flex:0 1 auto;min-width:0;max-width:100%;';
    const img=document.createElement('img');
    img.className='native-page';
    img.alt=`Página ${page}`;
    // A área de edição usa o preview PNG de alta resolução (sem perdas),
    // não a miniatura JPEG comprimida usada só na barra lateral - essa
    // era a causa da qualidade ruim, especialmente em texto pequeno e
    // ao usar o zoom.
    img.src=`/api/preview/${encodeURIComponent(fileId)}/${page}`;
    wrap.appendChild(img);
    stage.appendChild(wrap);
    img.onload=()=>{
      if(zoom!==1&&baseWidth){img.style.width=`${Math.round(baseWidth*zoom)}px`;img.style.maxWidth='none';}
      wrap.style.width=`${img.clientWidth}px`;wrap.style.height=`${img.clientHeight}px`;
      renderTextObjects(page,img,wrap);
    };
    refreshThumbActive();
  }

  function applyBoxVisual(item,box,sx,sy){const changed=item.changed===true||String(item.text??'')!==String(item.originalText??'');const rgb=hexToRgb(item.color||'#111111');box.textContent=item.deleted?'':item.text;box.style.fontSize=`${Math.max(7,Number(item.fontSize||item.pdfHeight)*sy*.95)}px`;box.style.fontWeight=item.bold?'700':'400';box.style.fontStyle=item.italic?'italic':'normal';box.style.textDecoration=item.underline?'underline':'none';box.dataset.changed=changed?'true':'false';box.dataset.deleted=item.deleted?'true':'false';if(item.deleted){box.style.color='transparent';box.style.background='#fff';box.style.borderColor='rgba(193,68,45,.75)';box.style.borderStyle='dashed';box.style.boxShadow='0 0 0 1px rgba(255,255,255,.9) inset';box.title='Texto marcado para exclusão — clique para restaurar';}else{box.style.borderStyle='solid';box.style.color=changed?`rgb(${rgb.r},${rgb.g},${rgb.b})`:'transparent';box.style.background=changed?'#fff':'transparent';box.style.borderColor=selectedItems.has(String(item.id))?'#e2604a':(changed?'rgba(193,68,45,.7)':'rgba(190,112,70,.58)');box.style.boxShadow=changed?'0 0 0 1px rgba(255,255,255,.9) inset':'none';box.title='Clique para editar · Ctrl+clique para seleção múltipla';}}

  function renderTextObjects(page,img,wrap){
    if(!img||!wrap)return;
    wrap.querySelectorAll('.native-text-object').forEach(e=>e.remove());
    const size=pageSizes[page-1];if(!size||!img.clientWidth||!img.clientHeight)return;
    const sx=img.clientWidth/Number(size.width),sy=img.clientHeight/Number(size.height);
    textBoxes.filter(t=>Number(t.page)===page).forEach(item=>{const box=document.createElement('div');box.className='native-text-object';box.dataset.id=item.id;const left=Number(item.pdfX)*sx,top=Number(item.pdfY)*sy,width=Math.max(4,Number(item.pdfWidth)*sx),height=Math.max(8,Number(item.pdfHeight)*sy);box.style.cssText=`position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;box-sizing:border-box;z-index:5;cursor:text;padding:0 1px;white-space:nowrap;overflow:visible;line-height:1;`;applyBoxVisual(item,box,sx,sy);if(searchMatches[searchIndex]&&String(searchMatches[searchIndex].id)===String(item.id))box.classList.add('search-hit');box.addEventListener('click',ev=>{ev.stopPropagation();if(item.deleted){item.deleted=false;item.changed=false;dirty=true;pushHistory();renderTextObjects(page,img,wrap);selectText(item,null,page,img,wrap,sx,sy);setStatus('Exclusão desfeita.');return;}if(mode==='delete'){item.deleted=true;item.changed=true;dirty=true;selectedItems.add(String(item.id));pushHistory();renderTextObjects(page,img,wrap);setStatus('Texto marcado para exclusão. A área foi coberta na prévia; o PDF só será alterado ao salvar.');return;}if(['bold','italic','underline'].includes(mode)){item[mode]=!item[mode];item.changed=true;dirty=true;pushHistory();renderTextObjects(page,img,wrap);const label=mode==='bold'?'Negrito':mode==='italic'?'Itálico':'Sublinhado';setStatus(`${label} ${item[mode]?'aplicado':'removido'}. Clique em outros textos para continuar aplicando, ou mude de ferramenta.`);return;}if(ev.ctrlKey||ev.metaKey){const id=String(item.id);selectedItems.has(id)?selectedItems.delete(id):selectedItems.add(id);selected=item;refreshSelectionVisual();showMultiProps();setStatus(`${selectedItems.size} texto(s) selecionado(s) no total. Use Ctrl+clique para adicionar/remover.`);return;}clearSelection();selectedItems.add(String(item.id));selectText(item,box,page,img,wrap,sx,sy);});wrap.appendChild(box);});
  }

  function refreshCurrentPageVisual(){
    const img=stage.querySelector('img'),wrap=stage.querySelector('.native-page-wrap');
    if(img&&wrap)renderTextObjects(currentPage,img,wrap);
  }

  function pagesInvolved(items){return [...new Set(items.map(i=>Number(i.page)))].sort((a,b)=>a-b);}

  function showMultiProps(){
    const items=getSelected();
    const pages=pagesInvolved(items);
    props.innerHTML=`
      <div style="margin-bottom:8px"><strong>${items.length} texto(s) selecionado(s)</strong><br><span class="native-note">${pages.length>1?`Em ${pages.length} páginas: ${pages.join(', ')}`:`Na página ${pages[0]??currentPage}`}</span></div>
      <p class="native-note">Ctrl+clique adiciona/remove textos. "Selecionar tudo" pega o documento inteiro.</p>
      <div style="display:flex;gap:6px;margin-bottom:12px">
        <button id="multiBold" class="native-save" style="margin-top:0"><b>B</b></button>
        <button id="multiItalic" class="native-save" style="margin-top:0"><i>I</i></button>
        <button id="multiUnderline" class="native-save" style="margin-top:0"><u>U</u></button>
        <button id="multiDelete" class="native-save" style="margin-top:0;background:#e2604a;color:#fff">⌫</button>
      </div>
      <hr class="native-divider" style="margin:10px 0">
      <label>Buscar (deixe em branco para substituir tudo)</label>
      <input id="multiFind" type="text" placeholder="ex: 2023">
      <label>Substituir por</label>
      <input id="multiReplace" type="text" placeholder="ex: 2024">
      <button id="multiApplyReplace" class="native-save">Aplicar aos ${items.length} selecionados</button>
      <p class="native-note" style="margin-top:8px">As alterações ficam só na prévia até clicar em "Salvar PDF".</p>
    `;
    document.getElementById('multiBold').onclick=()=>applyBulk('bold');
    document.getElementById('multiItalic').onclick=()=>applyBulk('italic');
    document.getElementById('multiUnderline').onclick=()=>applyBulk('underline');
    document.getElementById('multiDelete').onclick=()=>applyBulkDelete();
    document.getElementById('multiApplyReplace').onclick=()=>applyBulkReplace();
  }

  function applyBulk(prop){
    const items=getSelected(),on=items.some(i=>!i[prop]);
    items.forEach(i=>{i[prop]=on;i.changed=true;});
    dirty=true;pushHistory();refreshCurrentPageVisual();showMultiProps();
    setStatus(`${prop==='bold'?'Negrito':prop==='italic'?'Itálico':'Sublinhado'} aplicado a ${items.length} texto(s).`);
  }

  function applyBulkDelete(){
    const items=getSelected();
    items.forEach(i=>{i.deleted=true;i.changed=true;});
    dirty=true;pushHistory();refreshCurrentPageVisual();showMultiProps();
    setStatus(`${items.length} texto(s) marcado(s) para exclusão.`);
  }

  function applyBulkReplace(){
    const items=getSelected();
    if(!items.length){setStatus('Selecione ao menos um texto antes de aplicar.');return;}
    const find=document.getElementById('multiFind').value;
    const replace=document.getElementById('multiReplace').value;
    let touched=0;
    items.forEach(item=>{
      const before=String(item.text??'');
      const after=find?before.split(find).join(replace):replace;
      if(after!==before){item.text=after;item.changed=true;touched++;}
    });
    dirty=true;pushHistory();refreshCurrentPageVisual();showMultiProps();
    setStatus(find
      ? `"${find}" substituído por "${replace}" em ${touched} de ${items.length} texto(s).`
      : `Texto de ${touched} item(ns) substituído por "${replace}".`);
  }

  function selectAllDocument(){
    if(!fileId){setStatus('Carregue um PDF primeiro.');return;}
    selectedItems.clear();
    textBoxes.filter(t=>!t.deleted).forEach(t=>selectedItems.add(String(t.id)));
    refreshSelectionVisual();showMultiProps();
    setStatus(`${selectedItems.size} texto(s) selecionado(s) em todo o documento (${pageCount} página(s)).`);
  }
  selectAllBtn?.addEventListener('click',selectAllDocument);

  function selectText(item,box,page,img,wrap,sx,sy){selected=item;selectedItems.clear();selectedItems.add(String(item.id));refreshSelectionVisual();if(item.deleted){props.innerHTML=`<div style="margin-bottom:8px"><strong>Texto marcado para exclusão</strong></div><p class="native-note">A área branca na prévia representa exatamente o que será removido do PDF.</p><button id="nativeRestore" class="native-save">Desfazer exclusão</button>`;document.getElementById('nativeRestore').onclick=()=>{item.deleted=false;item.changed=false;dirty=true;pushHistory();renderTextObjects(page,img,wrap);props.innerHTML='<div class="native-note">Exclusão desfeita.</div>';};return;}props.innerHTML=`<div style="margin-bottom:8px"><strong>Texto selecionado</strong></div><label>Texto</label><textarea id="nativeText" style="width:100%;min-height:90px;box-sizing:border-box;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:5px;padding:7px;">${esc(item.text)}</textarea><label>Tamanho</label><input id="nativeSize" type="number" min="4" max="96" step="0.01" value="${Number(item.fontSize||item.pdfHeight||12)}"><label>Cor</label><input id="nativeColor" type="color" value="${item.color||'#111111'}"><div style="display:flex;gap:6px;margin-top:10px"><button id="nativeToggleBold" class="native-save" style="margin-top:0;${item.bold?'background:#e2604a':''}"><b>B</b></button><button id="nativeToggleItalic" class="native-save" style="margin-top:0;${item.italic?'background:#e2604a':''}"><i>I</i></button><button id="nativeToggleUnderline" class="native-save" style="margin-top:0;${item.underline?'background:#e2604a':''}"><u>U</u></button></div><p class="native-note">X: ${Number(item.pdfX).toFixed(2)} · Y: ${Number(item.pdfY).toFixed(2)} · W: ${Number(item.pdfWidth).toFixed(2)} · H: ${Number(item.pdfHeight).toFixed(2)}</p>`;const textInput=document.getElementById('nativeText'),sizeInput=document.getElementById('nativeSize'),colorInput=document.getElementById('nativeColor'),boldBtn=document.getElementById('nativeToggleBold'),italicBtn=document.getElementById('nativeToggleItalic'),underlineBtn=document.getElementById('nativeToggleUnderline');const sync=msg=>{item.text=textInput.value;item.fontSize=Number(sizeInput.value)||item.fontSize;item.color=colorInput.value||'#111111';item.changed=String(item.text)!==String(item.originalText??'')||!!item.bold||!!item.italic||!!item.underline;dirty=true;applyBoxVisual(item,box,sx,sy);setStatus(`${msg} Ainda não salva no PDF.`);};const commit=()=>pushHistory();textInput.addEventListener('input',()=>sync('Texto alterado em tempo real na prévia.'));textInput.addEventListener('blur',commit);sizeInput.addEventListener('input',()=>sync('Tamanho alterado em tempo real na prévia.'));sizeInput.addEventListener('blur',commit);colorInput.addEventListener('input',()=>sync('Cor alterada em tempo real na prévia.'));colorInput.addEventListener('change',commit);boldBtn.addEventListener('click',()=>{item.bold=!item.bold;sync('Negrito alternado.');commit();boldBtn.style.background=item.bold?'#e2604a':'';});italicBtn.addEventListener('click',()=>{item.italic=!item.italic;sync('Itálico alternado.');commit();italicBtn.style.background=item.italic?'#e2604a':'';});underlineBtn.addEventListener('click',()=>{item.underline=!item.underline;sync('Sublinhado alternado.');commit();underlineBtn.style.background=item.underline?'#e2604a':'';});}

  stage.addEventListener('click',ev=>{if(ev.target!==stage&&ev.target!==stage.querySelector('.native-page-wrap')&&ev.target!==stage.querySelector('img'))return;if(mode==='select'&&ev.ctrlKey)return;if(mode!=='text'||!fileId)return;const img=stage.querySelector('img'),wrap=stage.querySelector('.native-page-wrap'),size=pageSizes[currentPage-1];if(!img||!wrap||!size)return;const r=img.getBoundingClientRect(),x=Math.max(0,ev.clientX-r.left)*size.width/r.width,y=Math.max(0,ev.clientY-r.top)*size.height/r.height;textBoxes.push({id:`pnew-${Date.now()}`,page:currentPage,pdfX:x,pdfY:y,pdfWidth:140,pdfHeight:16,text:'Novo texto',originalText:'',fontSize:12,color:'#111111',changed:true,deleted:false,bold:false,italic:false,underline:false});dirty=true;pushHistory();renderTextObjects(currentPage,img,wrap);setStatus('Novo texto criado na prévia.');});

  // ---------------- Busca ----------------
  function runSearch(){
    const q=searchInput.value.trim().toLowerCase();
    searchMatches=[];searchIndex=-1;
    if(q){
      searchMatches=textBoxes.filter(t=>!t.deleted&&String(t.text??'').toLowerCase().includes(q))
        .sort((a,b)=>Number(a.page)-Number(b.page));
    }
    if(searchMatches.length){searchIndex=0;jumpToSearchMatch();}
    updateSearchUi();
  }
  function jumpToSearchMatch(){
    const match=searchMatches[searchIndex];
    if(!match)return;
    if(Number(match.page)!==currentPage){renderPage(Number(match.page));updatePager();}
    else refreshCurrentPageVisual();
    setTimeout(()=>{
      const el=stage.querySelector(`.native-text-object[data-id="${CSS.escape(String(match.id))}"]`);
      if(el)el.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});
    },60);
  }
  function updateSearchUi(){
    searchCount.textContent=searchMatches.length?`${searchIndex+1} de ${searchMatches.length}`:(searchInput.value.trim()?'0 resultados':'—');
    searchPrev.disabled=searchMatches.length<2;
    searchNext.disabled=searchMatches.length<2;
  }
  let searchTimer=null;
  searchInput?.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,250);});
  searchPrev?.addEventListener('click',()=>{if(!searchMatches.length)return;searchIndex=(searchIndex-1+searchMatches.length)%searchMatches.length;jumpToSearchMatch();updateSearchUi();});
  searchNext?.addEventListener('click',()=>{if(!searchMatches.length)return;searchIndex=(searchIndex+1)%searchMatches.length;jumpToSearchMatch();updateSearchUi();});

  // ---------------- Rotacionar página ----------------
  rotateBtn?.addEventListener('click',async()=>{
    if(!file||!fileId){setStatus('Carregue um PDF primeiro.');return;}
    if(dirty&&!confirm('Rotacionar recarrega o PDF original e descarta as alterações ainda não salvas. Continuar?'))return;
    try{
      rotateBtn.disabled=true;setStatus(`Rotacionando página ${currentPage}…`);
      const operations={keepOrder:Array.from({length:pageCount},(_,i)=>i+1),rotations:{[currentPage]:90}};
      const fd=new FormData();fd.append('file',file);fd.append('operations',JSON.stringify(operations));
      const r=await fetch('/api/pages/edit',{method:'POST',body:fd});
      if(!r.ok)throw new Error((await r.json()).error||'Falha ao rotacionar a página.');
      const blob=await r.blob();
      const rotatedFile=new File([blob],file.name,{type:'application/pdf'});
      const keepPage=currentPage;
      await loadPdf(rotatedFile);
      if(keepPage<=pageCount){renderPage(keepPage);updatePager();}
      setStatus(`Página ${keepPage} rotacionada.`);
    }catch(e){setStatus(e.message);}
    finally{rotateBtn.disabled=false;}
  });

  document.addEventListener('keydown',ev=>{
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='a'&&fileId&&document.activeElement?.tagName!=='TEXTAREA'&&document.activeElement?.tagName!=='INPUT'){
      ev.preventDefault();selectAllDocument();return;
    }
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'&&document.activeElement?.tagName!=='TEXTAREA'){
      ev.preventDefault();if(ev.shiftKey)redo();else undo();return;
    }
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='y'&&document.activeElement?.tagName!=='TEXTAREA'){
      ev.preventDefault();redo();return;
    }
  });

  window.addEventListener('resize',()=>{const img=stage.querySelector('img'),wrap=stage.querySelector('.native-page-wrap');if(img&&wrap&&img.complete&&zoom===1)renderTextObjects(currentPage,img,wrap);});

  function sanitizeFileName(raw){
    let name=String(raw||'').trim();
    name=name.replace(/\.pdf$/i,'');
    name=name.replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim();
    if(!name)name='documento-editado';
    return `${name}.pdf`;
  }

  // IMPORTANTE: o navegador só deixa abrir o diálogo nativo "Salvar como"
  // como reação DIRETA e IMEDIATA a um clique do usuário. Se a gente
  // espera o PDF ser processado no servidor antes de chamar isso (o que
  // pode levar vários segundos), o navegador já não considera mais um
  // clique "recente" o suficiente e recusa silenciosamente - caindo sem
  // aviso no download automático. Por isso perguntamos ONDE salvar
  // primeiro, e só depois processamos o PDF.
  async function pickSaveHandle(filename){
    if(!canPickSaveLocation)return{handle:null,cancelled:false};
    try{
      const handle=await window.showSaveFilePicker({
        suggestedName:filename,
        types:[{description:'Documento PDF',accept:{'application/pdf':['.pdf']}}]
      });
      return{handle,cancelled:false};
    }catch(err){
      if(err && err.name==='AbortError')return{handle:null,cancelled:true};
      console.warn('Falha ao abrir o seletor de pasta nativo, vai cair no download padrão ao final:',err);
      return{handle:null,cancelled:false};
    }
  }

  async function deliverPdf(blob,filename,handle){
    if(handle){
      const writable=await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    }
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    return 'download';
  }

  // O armazenamento temporário do servidor não é permanente entre
  // reinícios (deploys, ou o servidor "dormir" por inatividade em planos
  // gratuitos). Se isso acontecer entre o carregamento do PDF e o
  // salvamento, o servidor não encontra mais o arquivo original. Como o
  // PDF original continua na memória do navegador (variável `file`) e as
  // edições são todas baseadas em posição (não dependem do fileId em si),
  // dá para recuperar sozinho: reenviar o mesmo arquivo, pegar um fileId
  // novo, e tentar salvar de novo - sem o usuário precisar fazer nada.
  async function refreshFileId(){
    if(!file)throw new Error('O PDF original não está mais disponível nesta sessão. Recarregue a página e envie o arquivo novamente.');
    const fd=new FormData();fd.append('file',file);
    const r=await fetch('/api/inspect',{method:'POST',body:fd});
    if(!r.ok){
      let msg='Não foi possível reenviar o PDF original ao servidor.';
      try{const data=await r.json();if(data?.error)msg=data.error;}catch(_){}
      throw new Error(msg);
    }
    const d=await r.json();
    fileId=d.fileId;
    return fileId;
  }

  function isMissingFileError(message){
    return /original n[aã]o encontrado/i.test(String(message||''));
  }

  async function saveEditsToServer(edits){
    const response=await fetch('/api/edit/native',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId,edits})});
    if(!response.ok){
      let message='Falha no motor PDFBox.';
      try{const data=await response.json();if(data?.error)message=data.error;}catch(_){}
      throw new Error(message);
    }
    const blob=await response.blob();
    if(!blob.size)throw new Error('O motor retornou um PDF vazio.');
    return blob;
  }

  saveBtn.addEventListener('click',async()=>{
    if(!fileId)return;
    const filename=sanitizeFileName(fileNameOutInput?fileNameOutInput.value:'');

    // Passo 1 (instantâneo, ainda "quente" o clique do usuário): pergunta onde salvar.
    const{handle,cancelled}=await pickSaveHandle(filename);
    if(cancelled){setStatus('Salvamento cancelado — suas alterações continuam na prévia.');return;}

    try{
      saveBtn.disabled=true;saveBtn.textContent='Salvando…';
      setStatus('Removendo conteúdo original e desenhando o novo… isso pode levar alguns segundos em documentos grandes.');
      const edits=textBoxes.filter(item=>String(item.id||'').startsWith('pnew-')||item.changed===true||String(item.text??'')!==String(item.originalText??'')||item.deleted===true).map(item=>({id:item.id,page:item.page,pdfX:Number(item.pdfX),pdfY:Number(item.pdfY),pdfWidth:Number(item.pdfWidth),pdfHeight:Number(item.pdfHeight),originalText:String(item.originalText??''),text:String(item.text??''),fontSize:Number(item.fontSize)||Number(item.pdfHeight)||12,color:(item.color||'#111111')+(item.bold?'|B':'')+(item.italic?'|I':'')+(item.underline?'|U':''),bold:item.bold===true,italic:item.italic===true,underline:item.underline===true,deleted:item.deleted===true}));
      if(!edits.length){setStatus('Nenhuma alteração para salvar.');return;}

      // Passo 2 (pode demorar): processa no servidor. Se o arquivo original
      // sumiu do servidor (reinício), reenvia sozinho e tenta mais uma vez.
      let blob;
      try{
        blob=await saveEditsToServer(edits);
      }catch(err){
        if(!isMissingFileError(err.message))throw err;
        setStatus('O servidor reiniciou e perdeu o arquivo temporário. Reenviando o PDF original automaticamente…');
        await refreshFileId();
        setStatus('PDF reenviado. Salvando de novo…');
        blob=await saveEditsToServer(edits);
      }

      // Passo 3 (instantâneo): grava no local já escolhido no passo 1, ou baixa.
      const result=await deliverPdf(blob,filename,handle);
      dirty=false;
      setStatus(`"${filename}" salvo${result==='picker'?' no local escolhido':''} — ${edits.length} alteração(ões) aplicada(s) e removida(s) do conteúdo original.`);
    }catch(e){
      console.error(e);
      setStatus(`Erro ao salvar: ${e.message||e}`);
    }finally{
      saveBtn.disabled=false;saveBtn.textContent='Salvar PDF';
    }
  });
})();
