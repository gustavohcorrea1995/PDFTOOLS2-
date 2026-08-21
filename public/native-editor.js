(() => {
  const fileInput=document.getElementById('nativeFile'),uploadBox=document.getElementById('nativeUpload'),fileNameBox=document.getElementById('nativeFileName'),stage=document.getElementById('nativeStage'),status=document.getElementById('nativeStatus'),props=document.getElementById('nativeProps'),saveBtn=document.getElementById('nativeSave'),selectAllBtn=document.getElementById('nativeSelectAll');
  const pager=document.getElementById('nativePager'),prevBtn=document.getElementById('nativePrevPage'),nextBtn=document.getElementById('nativeNextPage'),pageLabel=document.getElementById('nativePageLabel');
  let mode='select',file=null,fileId=null,pageSizes=[],thumbnails=[],pageCount=0,textBoxes=[],selected=null,selectedItems=new Set(),dirty=false,currentPage=1;
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const setStatus=m=>status.textContent=m;
  const hexToRgb=h=>{h=String(h||'#111111').replace('#','');if(!/^[0-9a-f]{6}$/i.test(h))return{r:17,g:17,b:17};return{r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)};};
  const getSelected=()=>textBoxes.filter(t=>selectedItems.has(String(t.id)));
  const refreshSelectionVisual=()=>document.querySelectorAll('.native-text-object').forEach(el=>el.classList.toggle('selected',selectedItems.has(String(el.dataset.id))));
  const clearSelection=()=>{selectedItems.clear();selected=null;refreshSelectionVisual();};

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
      clearSelection();currentPage=1;
      renderPage(1);
      saveBtn.disabled=false;
      updatePager();
      setStatus(`${d.pageCount} página(s) carregada(s) · ${textBoxes.length} textos detectados.`);
    }catch(e){setStatus(e.message);}
  }
  fileInput.addEventListener('change',()=>loadPdf(fileInput.files?.[0]));
  ['dragenter','dragover'].forEach(ev=>uploadBox?.addEventListener(ev,e=>{e.preventDefault();uploadBox.style.borderColor='#c1442d';}));
  ['dragleave','drop'].forEach(ev=>uploadBox?.addEventListener(ev,e=>{e.preventDefault();uploadBox.style.borderColor='';}));
  uploadBox?.addEventListener('drop',e=>loadPdf(e.dataTransfer?.files?.[0]));

  function updatePager(){
    if(!fileId||pageCount<=0){pager.style.display='none';return;}
    pager.style.display='flex';
    pageLabel.textContent=`Página ${currentPage} de ${pageCount}`;
    prevBtn.disabled=currentPage<=1;
    nextBtn.disabled=currentPage>=pageCount;
  }
  prevBtn?.addEventListener('click',()=>{if(currentPage>1){renderPage(currentPage-1);updatePager();}});
  nextBtn?.addEventListener('click',()=>{if(currentPage<pageCount){renderPage(currentPage+1);updatePager();}});

  // Navegar de página NÃO limpa a seleção - assim dá para selecionar textos
  // em várias páginas antes de aplicar uma ação em massa.
  function renderPage(page){
    currentPage=page;
    stage.innerHTML='';
    const wrap=document.createElement('div');
    wrap.className='native-page-wrap';
    wrap.style.cssText='position:relative;display:inline-block;line-height:0;flex:0 0 auto;';
    const img=document.createElement('img');
    img.className='native-page';
    img.alt=`Página ${page}`;
    img.src=thumbnails[page-1]||`/api/preview/${encodeURIComponent(fileId)}/${page}`;
    wrap.appendChild(img);
    stage.appendChild(wrap);
    img.onload=()=>{wrap.style.width=`${img.clientWidth}px`;wrap.style.height=`${img.clientHeight}px`;renderTextObjects(page,img,wrap);};
  }

  function applyBoxVisual(item,box,sx,sy){const changed=item.changed===true||String(item.text??'')!==String(item.originalText??'');const rgb=hexToRgb(item.color||'#111111');box.textContent=item.deleted?'':item.text;box.style.fontSize=`${Math.max(7,Number(item.fontSize||item.pdfHeight)*sy*.95)}px`;box.style.fontWeight=item.bold?'700':'400';box.style.fontStyle=item.italic?'italic':'normal';box.style.textDecoration=item.underline?'underline':'none';box.dataset.changed=changed?'true':'false';box.dataset.deleted=item.deleted?'true':'false';if(item.deleted){box.style.color='transparent';box.style.background='#fff';box.style.borderColor='rgba(193,68,45,.75)';box.style.borderStyle='dashed';box.style.boxShadow='0 0 0 1px rgba(255,255,255,.9) inset';box.title='Texto marcado para exclusão — clique para restaurar';}else{box.style.borderStyle='solid';box.style.color=changed?`rgb(${rgb.r},${rgb.g},${rgb.b})`:'transparent';box.style.background=changed?'#fff':'transparent';box.style.borderColor=selectedItems.has(String(item.id))?'#c1442d':(changed?'rgba(193,68,45,.7)':'rgba(190,112,70,.58)');box.style.boxShadow=changed?'0 0 0 1px rgba(255,255,255,.9) inset':'none';box.title='Clique para editar · Ctrl+clique para seleção múltipla';}}

  function renderTextObjects(page,img,wrap){wrap.querySelectorAll('.native-text-object').forEach(e=>e.remove());const size=pageSizes[page-1];if(!size||!img.clientWidth||!img.clientHeight)return;const sx=img.clientWidth/Number(size.width),sy=img.clientHeight/Number(size.height);textBoxes.filter(t=>Number(t.page)===page).forEach(item=>{const box=document.createElement('div');box.className='native-text-object';box.dataset.id=item.id;const left=Number(item.pdfX)*sx,top=Number(item.pdfY)*sy,width=Math.max(4,Number(item.pdfWidth)*sx),height=Math.max(8,Number(item.pdfHeight)*sy);box.style.cssText=`position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;box-sizing:border-box;z-index:5;cursor:text;padding:0 1px;white-space:nowrap;overflow:visible;line-height:1;`;applyBoxVisual(item,box,sx,sy);box.addEventListener('click',ev=>{ev.stopPropagation();if(item.deleted){item.deleted=false;item.changed=false;dirty=true;renderTextObjects(page,img,wrap);selectText(item,null,page,img,wrap,sx,sy);setStatus('Exclusão desfeita.');return;}if(mode==='delete'){item.deleted=true;item.changed=true;dirty=true;selectedItems.add(String(item.id));renderTextObjects(page,img,wrap);setStatus('Texto marcado para exclusão. A área foi coberta na prévia; o PDF só será alterado ao salvar.');return;}if(ev.ctrlKey||ev.metaKey){const id=String(item.id);selectedItems.has(id)?selectedItems.delete(id):selectedItems.add(id);selected=item;refreshSelectionVisual();showMultiProps();setStatus(`${selectedItems.size} texto(s) selecionado(s) no total. Use Ctrl+clique para adicionar/remover.`);return;}clearSelection();selectedItems.add(String(item.id));selectText(item,box,page,img,wrap,sx,sy);});wrap.appendChild(box);});}

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
        <button id="multiDelete" class="native-save" style="margin-top:0;background:#3a2a26">⌫</button>
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

  function refreshCurrentPageVisual(){
    const img=stage.querySelector('img'),wrap=stage.querySelector('.native-page-wrap');
    if(img&&wrap)renderTextObjects(currentPage,img,wrap);
  }

  function applyBulk(prop){
    const items=getSelected(),on=items.some(i=>!i[prop]);
    items.forEach(i=>{i[prop]=on;i.changed=true;});
    dirty=true;refreshCurrentPageVisual();showMultiProps();
    setStatus(`${prop==='bold'?'Negrito':prop==='italic'?'Itálico':'Sublinhado'} aplicado a ${items.length} texto(s).`);
  }

  function applyBulkDelete(){
    const items=getSelected();
    items.forEach(i=>{i.deleted=true;i.changed=true;});
    dirty=true;refreshCurrentPageVisual();showMultiProps();
    setStatus(`${items.length} texto(s) marcado(s) para exclusão.`);
  }

  // Busca/substitui em massa nos itens selecionados. Se "buscar" estiver
  // vazio, troca o texto inteiro do item (util para redigitar varios campos
  // parecidos de uma vez). Se preenchido, troca so a ocorrencia da palavra
  // dentro do texto de cada item selecionado (ex: trocar um ano em todo o
  // documento de uma vez).
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
    dirty=true;refreshCurrentPageVisual();showMultiProps();
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

  function selectText(item,box,page,img,wrap,sx,sy){selected=item;selectedItems.clear();selectedItems.add(String(item.id));refreshSelectionVisual();if(item.deleted){props.innerHTML=`<div style="margin-bottom:8px"><strong>Texto marcado para exclusão</strong></div><p class="native-note">A área branca na prévia representa exatamente o que será removido do PDF.</p><button id="nativeRestore" class="native-save">Desfazer exclusão</button>`;document.getElementById('nativeRestore').onclick=()=>{item.deleted=false;item.changed=false;dirty=true;renderTextObjects(page,img,wrap);props.innerHTML='<div class="native-note">Exclusão desfeita.</div>';};return;}props.innerHTML=`<div style="margin-bottom:8px"><strong>Texto selecionado</strong></div><label>Texto</label><textarea id="nativeText" style="width:100%;min-height:90px;box-sizing:border-box;background:#111820;color:#fff;border:1px solid #465362;border-radius:5px;padding:7px;">${esc(item.text)}</textarea><label>Tamanho</label><input id="nativeSize" type="number" min="4" max="96" step="0.01" value="${Number(item.fontSize||item.pdfHeight||12)}"><label>Cor</label><input id="nativeColor" type="color" value="${item.color||'#111111'}"><p class="native-note">X: ${Number(item.pdfX).toFixed(2)} · Y: ${Number(item.pdfY).toFixed(2)} · W: ${Number(item.pdfWidth).toFixed(2)} · H: ${Number(item.pdfHeight).toFixed(2)}</p>`;const textInput=document.getElementById('nativeText'),sizeInput=document.getElementById('nativeSize'),colorInput=document.getElementById('nativeColor');const sync=msg=>{item.text=textInput.value;item.fontSize=Number(sizeInput.value)||item.fontSize;item.color=colorInput.value||'#111111';item.changed=String(item.text)!==String(item.originalText??'')||!!item.bold||!!item.italic||!!item.underline;dirty=true;applyBoxVisual(item,box,sx,sy);setStatus(`${msg} Ainda não salva no PDF.`);};textInput.addEventListener('input',()=>sync('Texto alterado em tempo real na prévia.'));sizeInput.addEventListener('input',()=>sync('Tamanho alterado em tempo real na prévia.'));colorInput.addEventListener('input',()=>sync('Cor alterada em tempo real na prévia.'));}

  stage.addEventListener('click',ev=>{if(ev.target!==stage&&ev.target!==stage.querySelector('.native-page-wrap')&&ev.target!==stage.querySelector('img'))return;if(mode==='select'&&ev.ctrlKey)return;if(mode!=='text'||!fileId)return;const img=stage.querySelector('img'),wrap=stage.querySelector('.native-page-wrap'),size=pageSizes[currentPage-1];if(!img||!wrap||!size)return;const r=img.getBoundingClientRect(),x=Math.max(0,ev.clientX-r.left)*size.width/r.width,y=Math.max(0,ev.clientY-r.top)*size.height/r.height;textBoxes.push({id:`pnew-${Date.now()}`,page:currentPage,pdfX:x,pdfY:y,pdfWidth:140,pdfHeight:16,text:'Novo texto',originalText:'',fontSize:12,color:'#111111',changed:true,deleted:false,bold:false,italic:false,underline:false});dirty=true;renderTextObjects(currentPage,img,wrap);setStatus('Novo texto criado na prévia.');});

  document.addEventListener('keydown',ev=>{
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='a'&&fileId){
      ev.preventDefault();
      selectAllDocument();
    }
  });

  window.addEventListener('resize',()=>{const img=stage.querySelector('img'),wrap=stage.querySelector('.native-page-wrap');if(img&&wrap&&img.complete)renderTextObjects(currentPage,img,wrap);});

  saveBtn.addEventListener('click',async()=>{if(!fileId)return;try{saveBtn.disabled=true;saveBtn.textContent='Salvando…';setStatus('Removendo conteúdo original e desenhando o novo…');const edits=textBoxes.filter(item=>String(item.id||'').startsWith('pnew-')||item.changed===true||String(item.text??'')!==String(item.originalText??'')||item.deleted===true).map(item=>({id:item.id,page:item.page,pdfX:Number(item.pdfX),pdfY:Number(item.pdfY),pdfWidth:Number(item.pdfWidth),pdfHeight:Number(item.pdfHeight),originalText:String(item.originalText??''),text:String(item.text??''),fontSize:Number(item.fontSize)||Number(item.pdfHeight)||12,color:(item.color||'#111111')+(item.bold?'|B':''),bold:item.bold===true,italic:item.italic===true,underline:item.underline===true,deleted:item.deleted===true}));if(!edits.length){setStatus('Nenhuma alteração para salvar.');return;}const response=await fetch('/api/edit/native',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId,edits})});if(!response.ok){let message='Falha no motor PDFBox.';try{const data=await response.json();if(data?.error)message=data.error;}catch(_){}throw new Error(message);}const blob=await response.blob();if(!blob.size)throw new Error('O motor retornou um PDF vazio.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='PDFTools2-editado.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);dirty=false;setStatus(`PDF salvo — ${edits.length} alteração(ões) aplicada(s) e removida(s) do conteúdo original.`);}catch(e){console.error(e);setStatus(`Erro ao salvar: ${e.message||e}`);}finally{saveBtn.disabled=false;saveBtn.textContent='Salvar PDF';}});
})();
