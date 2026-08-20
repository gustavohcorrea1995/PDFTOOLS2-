(() => {
  const fileInput = document.getElementById('nativeFile');
  const stage = document.getElementById('nativeStage');
  const status = document.getElementById('nativeStatus');
  const props = document.getElementById('nativeProps');
  const saveBtn = document.getElementById('nativeSave');
  let mode = 'select', file = null, fileId = null, pageSizes = [], textBoxes = [], selected = null, dirty = false, currentPage = 1;

  const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const setStatus = msg => status.textContent = msg;
  const hexToRgb = hex => {
    const h = String(hex || '#111111').replace('#','');
    if (!/^[0-9a-f]{6}$/i.test(h)) return {r:17,g:17,b:17};
    return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)};
  };

  document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
    setStatus(mode === 'text' ? 'Clique em uma área da página para adicionar texto.' : `Modo: ${btn.textContent.trim()}`);
  }));

  fileInput.addEventListener('change', async () => {
    file = fileInput.files?.[0] || null; if (!file) return;
    try {
      setStatus('Analisando PDF…');
      const fd = new FormData(); fd.append('file', file);
      const response = await fetch('/api/inspect', { method:'POST', body:fd });
      if (!response.ok) throw new Error((await response.json()).error || 'Falha ao analisar PDF.');
      const data = await response.json();
      fileId = data.fileId; pageSizes = data.pageSizes || [];
      textBoxes = (data.textBoxes || []).map(t => ({...t, originalText:String(t.text ?? ''), deleted:false, changed:false, color:'#111111'}));
      currentPage = 1;
      renderPage(1, data.thumbnails?.[0]); saveBtn.disabled = false;
      setStatus(`${data.pageCount} página(s) carregada(s). ${textBoxes.length} textos detectados.`);
    } catch (e) { setStatus(e.message); }
  });

  function renderPage(page, thumb) {
    currentPage = page; stage.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'native-page-wrap';
    wrap.style.cssText = 'position:relative;display:inline-block;line-height:0;flex:0 0 auto;';
    const img = document.createElement('img'); img.className='native-page'; img.alt=`Página ${page}`;
    img.src = thumb || `/api/preview/${encodeURIComponent(fileId)}/${page}`; wrap.appendChild(img); stage.appendChild(wrap);
    img.onload = () => { wrap.style.width=`${img.clientWidth}px`; wrap.style.height=`${img.clientHeight}px`; renderTextObjects(page,img,wrap); };
  }

  function applyBoxVisual(item, box, sx, sy) {
    const changed = item.changed === true || String(item.text ?? '') !== String(item.originalText ?? '');
    const rgb = hexToRgb(item.color || '#111111');
    box.textContent = item.text;
    box.style.color = changed ? `rgb(${rgb.r},${rgb.g},${rgb.b})` : 'rgba(193,68,45,.78)';
    box.style.background = changed ? '#fff' : 'rgba(193,68,45,.045)';
    box.style.borderColor = changed ? 'rgba(193,68,45,.65)' : 'rgba(193,68,45,.38)';
    box.style.fontSize = `${Math.max(7,Number(item.fontSize||item.pdfHeight)*sy*.95)}px`;
    box.style.fontWeight = item.bold ? '700' : '400';
    box.style.fontStyle = item.italic ? 'italic' : 'normal';
    box.style.textDecoration = item.underline ? 'underline' : 'none';
    box.dataset.changed = changed ? 'true' : 'false';
    box.style.boxShadow = changed ? '0 0 0 1px rgba(255,255,255,.9) inset' : 'none';
  }

  function renderTextObjects(page, img, wrap) {
    wrap.querySelectorAll('.native-text-object').forEach(e=>e.remove());
    const size = pageSizes[page-1]; if (!size || !img.clientWidth || !img.clientHeight) return;
    const sx = img.clientWidth / Number(size.width), sy = img.clientHeight / Number(size.height);
    textBoxes.filter(t => Number(t.page)===page && t.deleted!==true).forEach(item => {
      const box=document.createElement('div');
      box.className='native-text-object'; box.dataset.id=item.id; box.title='Clique para editar este texto';
      const left=Number(item.pdfX)*sx, top=Number(item.pdfY)*sy, width=Math.max(4,Number(item.pdfWidth)*sx), height=Math.max(8,Number(item.pdfHeight)*sy);
      box.style.cssText=`position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;box-sizing:border-box;z-index:5;cursor:text;padding:0 1px;white-space:nowrap;overflow:visible;line-height:1;`;
      applyBoxVisual(item,box,sx,sy);
      box.addEventListener('click',ev=>{ev.stopPropagation(); if(mode==='delete'){item.deleted=true;dirty=true;selected=null;renderTextObjects(page,img,wrap);setStatus('Texto marcado para exclusão.');return;} selectText(item,box,page,img,wrap,sx,sy);});
      wrap.appendChild(box);
    });
  }

  function selectText(item, box, page, img, wrap, sx, sy) {
    selected=item; document.querySelectorAll('.native-text-object').forEach(el=>el.classList.remove('selected')); box.classList.add('selected');
    props.innerHTML=`<div style="margin-bottom:8px"><strong>Texto selecionado</strong></div><label>Texto</label><textarea id="nativeText" style="width:100%;min-height:90px;box-sizing:border-box;background:#111820;color:#fff;border:1px solid #465362;border-radius:5px;padding:7px;">${esc(item.text)}</textarea><label>Tamanho</label><input id="nativeSize" type="number" min="4" max="96" value="${Math.round(item.fontSize||item.pdfHeight||12)}"><label>Cor</label><input id="nativeColor" type="color" value="${item.color || '#111111'}"><p class="native-note">X: ${Number(item.pdfX).toFixed(2)} · Y: ${Number(item.pdfY).toFixed(2)} · W: ${Number(item.pdfWidth).toFixed(2)} · H: ${Number(item.pdfHeight).toFixed(2)}</p><button id="nativeApply" class="native-save" style="margin-top:8px">Aplicar alteração</button>`;

    const textInput=document.getElementById('nativeText');
    const sizeInput=document.getElementById('nativeSize');
    const colorInput=document.getElementById('nativeColor');
    const syncPreview=(message='Alteração visível na prévia.')=>{
      item.text=textInput.value;
      item.fontSize=Number(sizeInput.value)||item.fontSize;
      item.color=colorInput.value || '#111111';
      item.changed = String(item.text) !== String(item.originalText ?? '') || !!item.bold || !!item.italic || !!item.underline;
      dirty=true;
      applyBoxVisual(item,box,sx,sy);
      setStatus(`${message} Ainda não salva no PDF.`);
    };
    textInput.addEventListener('input',()=>syncPreview('Texto alterado em tempo real na prévia.'));
    sizeInput.addEventListener('input',()=>syncPreview('Tamanho alterado em tempo real na prévia.'));
    colorInput.addEventListener('input',()=>syncPreview('Cor alterada em tempo real na prévia.'));
    document.getElementById('nativeApply').onclick=()=>syncPreview('Alteração aplicada na prévia.');

    if(mode==='bold'){item.bold=!item.bold;item.changed=true;dirty=true;applyBoxVisual(item,box,sx,sy);setStatus('Negrito aplicado na prévia. Ainda não salva no PDF.');}
    if(mode==='italic'){item.italic=!item.italic;item.changed=true;dirty=true;applyBoxVisual(item,box,sx,sy);setStatus('Itálico aplicado na prévia. Ainda não salva no PDF.');}
    if(mode==='underline'){item.underline=!item.underline;item.changed=true;dirty=true;applyBoxVisual(item,box,sx,sy);setStatus('Sublinhado aplicado na prévia. Ainda não salva no PDF.');}
  }

  stage.addEventListener('click',ev=>{
    if(mode!=='text'||!fileId)return; const img=stage.querySelector('img'),wrap=stage.querySelector('.native-page-wrap'),size=pageSizes[currentPage-1];
    if(!img||!wrap||!size||(ev.target!==stage&&ev.target!==wrap&&ev.target!==img))return;
    const r=img.getBoundingClientRect(),x=Math.max(0,ev.clientX-r.left)*size.width/r.width,y=Math.max(0,ev.clientY-r.top)*size.height/r.height;
    textBoxes.push({id:`pnew-${Date.now()}`,page:currentPage,pdfX:x,pdfY:y,pdfWidth:140,pdfHeight:16,x,y,width:140,height:16,text:'Novo texto',originalText:'',fontSize:12,color:'#111111',changed:true});dirty=true;renderTextObjects(currentPage,img,wrap);setStatus('Novo texto criado na prévia.');
  });

  window.addEventListener('resize',()=>{const img=stage.querySelector('img'),wrap=stage.querySelector('.native-page-wrap');if(img&&wrap&&img.complete)renderTextObjects(currentPage,img,wrap);});

  async function savePdfClientSide() {
    if (!window.PDFLib) throw new Error('Motor PDF não carregou. Atualize a página e tente novamente.');
    if (!file) throw new Error('Nenhum PDF carregado.');
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const bytes = await file.arrayBuffer();
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    for (const item of textBoxes) {
      const pageIndex = Number(item.page) - 1;
      if (pageIndex < 0 || pageIndex >= pdf.getPageCount()) continue;
      const page = pdf.getPage(pageIndex);
      const pageHeight = page.getHeight();
      const x = Number(item.pdfX) || 0;
      const yTop = Number(item.pdfY) || 0;
      const w = Math.max(2, Number(item.pdfWidth) || 20);
      const h = Math.max(2, Number(item.pdfHeight) || 12);
      const changed = item.changed === true || String(item.text ?? '') !== String(item.originalText ?? '');
      const isNew = String(item.id || '').startsWith('pnew-');

      if (item.deleted === true || (changed && !isNew)) {
        page.drawRectangle({
          x: Math.max(0, x - 0.8),
          y: Math.max(0, pageHeight - yTop - h - 0.8),
          width: w + 1.6,
          height: h + 1.6,
          color: rgb(1,1,1),
          borderWidth: 0
        });
      }

      if (item.deleted !== true && String(item.text ?? '').length) {
        const size = Math.max(4, Number(item.fontSize) || h);
        const c = hexToRgb(item.color || '#111111');
        page.drawText(String(item.text), {
          x,
          y: Math.max(0, pageHeight - yTop - size),
          size,
          font,
          color: rgb(c.r/255,c.g/255,c.b/255),
          maxWidth: Math.max(10,w),
          opacity: 1
        });
      }
    }

    return await pdf.save({ useObjectStreams: false });
  }

  saveBtn.addEventListener('click',async()=>{
    if(!file)return;
    try{
      saveBtn.disabled=true;
      saveBtn.textContent='Salvando…';
      setStatus('Gerando o PDF editado…');
      const bytes = await savePdfClientSide();
      const blob = new Blob([bytes], {type:'application/pdf'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;
      a.download='PDFTools2-editado.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      dirty=false;
      setStatus('PDF salvo com sucesso. O arquivo editado foi baixado.');
    }catch(e){
      console.error(e);
      setStatus(`Erro ao salvar: ${e.message || e}`);
    }finally{
      saveBtn.disabled=false;
      saveBtn.textContent='Salvar PDF';
    }
  });
})();
