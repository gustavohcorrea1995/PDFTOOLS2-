// Editor visual v2: novas ferramentas sem substituir o sistema de caixas existente.
(() => {
  if (window.__pdfToolsEditorToolsV2) return;
  window.__pdfToolsEditorToolsV2 = true;

  RENDERERS['annotate'] = (root) => {
    const dz = makeDropzone(root, { accept: '.pdf', multiple: false, label: 'Arraste um PDF para editar' });
    let fileId = null, pageCount = 0, thumbs = [], currentPage = 1;
    let textBoxes = [], edits = [], objects = [];
    let undoStack = [], redoStack = [];
    let mode = 'select', selected = null;

    const info = document.createElement('p'); info.className='hint'; root.appendChild(info);
    const style=document.createElement('style');
    style.textContent=`.pdf-editor-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:10px 0;padding:8px;background:#1b222b;border:1px solid #36414e;border-radius:7px}.pdf-editor-toolbar button{border:1px solid #4b5968;background:#27313d;color:#fff;border-radius:5px;padding:7px 10px;cursor:pointer;font-weight:600}.pdf-editor-toolbar button:hover{background:#33404f}.pdf-editor-toolbar button.active{background:#c1442d;border-color:#e06b51}.pdf-editor-toolbar .tool-sep{width:1px;height:24px;background:#566170;margin:0 2px}.pdf-visual-editor{touch-action:none}.pdf-resize-handle{pointer-events:auto}`;
    root.appendChild(style);

    const toolbar = document.createElement('div');
    toolbar.className='pdf-editor-toolbar';
    toolbar.innerHTML = `
      <button type="button" data-tool="select" class="active">↖ Selecionar</button>
      <button type="button" data-tool="text">T Texto</button>
      <span class="tool-sep"></span>
      <button type="button" data-action="undo" title="Desfazer">↶</button>
      <button type="button" data-action="redo" title="Refazer">↷</button>
      <span class="tool-sep"></span>
      <button type="button" data-action="delete" title="Excluir selecionado">🗑 Excluir</button>
    `;
    root.appendChild(toolbar);

    const pageNav = document.createElement('div');
    pageNav.className='field-row hidden';
    pageNav.innerHTML=`<button type="button" id="prevPage" class="btn-ghost">← Página anterior</button><span id="pageIndicator" style="align-self:center;"></span><button type="button" id="nextPage" class="btn-ghost">Próxima página →</button>`;
    root.appendChild(pageNav);

    const editor = document.createElement('div');
    editor.className='pdf-visual-editor hidden';
    editor.style.cssText='position:relative;display:block;width:100%;max-width:100%;overflow:auto;background:#777;border:1px solid var(--line,#3a4552);padding:12px;box-sizing:border-box;';
    root.appendChild(editor);

    const pageCanvas=document.createElement('div');
    pageCanvas.style.cssText='position:relative;display:block;width:max-content;max-width:100%;margin:0 auto;line-height:0;';
    editor.appendChild(pageCanvas);

    const previewImg=document.createElement('img');
    previewImg.style.cssText='display:block;max-width:100%;height:auto;user-select:none;';
    pageCanvas.appendChild(previewImg);

    const layer=document.createElement('div');
    layer.style.cssText='position:absolute;inset:0;pointer-events:none;';
    pageCanvas.appendChild(layer);

    const status=document.createElement('p'); status.className='hint'; status.textContent='Carregue um PDF para começar.'; root.appendChild(status);
    const saveBtn=makeButton(root,'Salvar PDF editado'); saveBtn.dataset.label=saveBtn.textContent;

    const toolButtons=[...toolbar.querySelectorAll('[data-tool]')];
    function setMode(next){ mode=next; toolButtons.forEach(b=>b.classList.toggle('active',b.dataset.tool===next)); editor.style.cursor=next==='text'?'crosshair':'default'; }

    function cloneState(){ return JSON.parse(JSON.stringify({edits,objects})); }
    function restoreState(s){ edits=s.edits||[]; objects=s.objects||[]; selected=null; renderLayer(); }
    function commit(before){ undoStack.push(before); if(undoStack.length>40) undoStack.shift(); redoStack=[]; }
    function undo(){ if(!undoStack.length)return; redoStack.push(cloneState()); restoreState(undoStack.pop()); }
    function redo(){ if(!redoStack.length)return; undoStack.push(cloneState()); restoreState(redoStack.pop()); }

    function findEdit(id){ return edits.find(e=>e.id===id); }
    function existingData(t){
      const e=findEdit(t.id);
      return { x:e?.x ?? t.pdfX ?? t.x, y:e?.y ?? t.pdfY ?? t.y, width:e?.width ?? t.pdfWidth ?? t.width, height:e?.height ?? t.pdfHeight ?? t.height, text:e?.text ?? t.text, fontSize:e?.fontSize ?? t.fontSize ?? Math.max(t.height,7), deleted:e?.deleted===true };
    }

    function getScale(){ return previewImg.naturalWidth ? previewImg.clientWidth/previewImg.naturalWidth : 1; }
    function screenToPdf(clientX,clientY){
      const r=previewImg.getBoundingClientRect(), scale=getScale();
      const sx=Math.max(0,clientX-r.left), sy=Math.max(0,clientY-r.top);
      const inspectX=sx/scale, inspectY=sy/scale;
      const PT_TO_PX=1100/612;
      return {x:inspectX/PT_TO_PX,y:inspectY/PT_TO_PX};
    }
    function pdfToScreen(x,y,w,h){
      const PT_TO_PX=1100/612, s=getScale();
      return {left:x*PT_TO_PX*s,top:y*PT_TO_PX*s,width:Math.max(w*PT_TO_PX*s,8),height:Math.max(h*PT_TO_PX*s,10)};
    }

    function ensureErase(t){
      const eraseId = `${t.id}__erase`;
      if(findEdit(eraseId)) return;
      edits.push({id:eraseId,page:t.page,x:t.pdfX ?? t.x,y:t.pdfY ?? t.y,width:t.pdfWidth ?? t.width,height:t.pdfHeight ?? t.height,fontSize:t.fontSize || Math.max(t.height,7),text:'',deleted:true});
    }

    function pushEdit(id, data){
      const original = textBoxes.find(t=>t.id===id);
      if(original) ensureErase(original);
      let e=findEdit(id);
      if(!e){ e={id,page:currentPage,x:data.x,y:data.y,width:data.width,height:data.height,fontSize:data.fontSize,text:data.text,deleted:false}; edits.push(e); }
      Object.assign(e,data);
      e.page=currentPage;
    }

    function removeExisting(id){
      const t=textBoxes.find(x=>x.id===id); if(!t)return;
      const d=existingData(t);
      let e=findEdit(id);
      if(!e){ e={id,page:t.page,x:d.x,y:d.y,width:d.width,height:d.height,fontSize:d.fontSize,text:'',deleted:true}; edits.push(e); }
      else Object.assign(e,{text:'',deleted:true});
    }

    function selectedItem(){
      if(!selected)return null;
      if(selected.kind==='new') return objects.find(o=>o.id===selected.id)||null;
      const t=textBoxes.find(t=>t.id===selected.id); return t?{kind:'existing',id:t.id,t,data:existingData(t)}:null;
    }

    function makeBox(t,data,kind,id){
      const p=pdfToScreen(data.x,data.y,data.width,data.height);
      const box=document.createElement('div');
      box.dataset.id=id; box.dataset.kind=kind; box.title=kind==='existing'?'Clique para editar/mover':'Texto adicionado';
      box.style.cssText=`position:absolute;left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px;box-sizing:border-box;pointer-events:auto;cursor:${mode==='text'?'crosshair':'move'};z-index:3;`;
      if(kind==='existing'){
        box.textContent=data.text;
        box.style.color='transparent'; box.style.background='rgba(255,235,59,.10)'; box.style.border='1px solid rgba(193,68,45,.28)'; box.style.borderRadius='2px'; box.style.fontFamily='Arial,sans-serif'; box.style.fontSize=Math.max(data.height*.82*getScale(),8)+'px'; box.style.lineHeight='1.05'; box.style.overflow='hidden'; box.style.whiteSpace='pre-wrap';
      }else{
        box.textContent=data.text||'Novo texto';
        box.style.color='#111'; box.style.background='rgba(255,255,255,.12)'; box.style.border='1px dashed rgba(193,68,45,.85)'; box.style.fontFamily='Arial,sans-serif'; box.style.fontSize=Math.max(data.fontSize*getScale(),8)+'px'; box.style.lineHeight='1.1'; box.style.padding='1px'; box.style.whiteSpace='pre-wrap'; box.style.overflow='hidden';
      }
      if(selected?.id===id && selected.kind===kind){
        box.style.outline='2px solid #c1442d'; box.style.background=kind==='existing'?'rgba(255,235,59,.24)':'rgba(255,255,255,.5)';
        const handle=document.createElement('span'); handle.className='pdf-resize-handle'; handle.style.cssText='position:absolute;right:-5px;bottom:-5px;width:10px;height:10px;background:#c1442d;border:2px solid #fff;border-radius:50%;box-sizing:border-box;cursor:nwse-resize;z-index:5;'; box.appendChild(handle);
        handle.addEventListener('pointerdown',e=>startResize(e,kind,id,box,data));
      }
      box.addEventListener('mouseenter',()=>{if(kind==='existing'&&selected?.id!==id) {box.style.background='rgba(255,235,59,.25)';box.style.borderColor='rgba(193,68,45,.75)';}});
      box.addEventListener('mouseleave',()=>{if(kind==='existing'&&selected?.id!==id) {box.style.background='rgba(255,235,59,.10)';box.style.borderColor='rgba(193,68,45,.28)';}});
      box.addEventListener('pointerdown',e=>{
        if(e.target.classList.contains('pdf-resize-handle'))return;
        e.stopPropagation();
        if(mode==='text' && kind==='existing'){ openTextEditor(t,data); return; }
        selectItem(kind,id);
        startMove(e,kind,id,box,data);
      });
      box.addEventListener('dblclick',e=>{e.stopPropagation(); if(kind==='existing') openTextEditor(t,data); else openNewTextEditor(id);});
      layer.appendChild(box);
    }

    function selectItem(kind,id){ selected={kind,id}; renderLayer(); }

    function startMove(ev,kind,id,box,data){
      if(mode==='text' && kind==='new'){ openNewTextEditor(id); return; }
      const start={x:ev.clientX,y:ev.clientY,data:{...data}}; const before=cloneState();
      box.setPointerCapture?.(ev.pointerId);
      const move=e=>{
        const scale=getScale(), dx=(e.clientX-start.x)/scale, dy=(e.clientY-start.y)/scale, PT_TO_PX=1100/612;
        const nx=Math.max(0,(start.data.x*PT_TO_PX+dx)/PT_TO_PX), ny=Math.max(0,(start.data.y*PT_TO_PX+dy)/PT_TO_PX);
        if(kind==='new'){const o=objects.find(o=>o.id===id); if(o){o.x=nx;o.y=ny;renderLayer(false);}}
        else { const t=textBoxes.find(t=>t.id===id); if(t){pushEdit(id,{x:nx,y:ny,width:start.data.width,height:start.data.height,text:start.data.text,fontSize:start.data.fontSize,deleted:false});renderLayer(false);} }
      };
      const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);commit(before);};
      window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
    }

    function startResize(ev,kind,id,box,data){
      ev.stopPropagation();
      const start={x:ev.clientX,y:ev.clientY,data:{...data}}; const before=cloneState();
      const move=e=>{
        const scale=getScale(), PT_TO_PX=1100/612;
        const dx=(e.clientX-start.x)/scale/PT_TO_PX, dy=(e.clientY-start.y)/scale/PT_TO_PX;
        const nw=Math.max(8,start.data.width+dx), nh=Math.max(8,start.data.height+dy);
        if(kind==='new'){const o=objects.find(o=>o.id===id);if(o){o.width=nw;o.height=nh;renderLayer(false);}}
        else {pushEdit(id,{x:start.data.x,y:start.data.y,width:nw,height:nh,text:start.data.text,fontSize:Math.max(4,Math.min(start.data.fontSize,nh)),deleted:false});renderLayer(false);}
      };
      const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);commit(before);};
      window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
    }

    function openTextEditor(t,data){
      const panel=document.createElement('div'); panel.className='pdf-text-editor'; panel.style.cssText='position:absolute;z-index:10000;left:10px;top:10px;width:300px;max-width:calc(100% - 20px);padding:10px;background:#fff;color:#111;border:2px solid #c1442d;border-radius:6px;box-shadow:0 8px 25px rgba(0,0,0,.35);box-sizing:border-box;line-height:normal;';
      const title=document.createElement('div'); title.textContent='Editar texto'; title.style.cssText='font-weight:700;margin-bottom:7px;font:700 13px Arial,sans-serif;'; panel.appendChild(title);
      const input=document.createElement('textarea'); input.value=data.text||''; input.style.cssText='display:block;width:100%;min-height:70px;padding:7px;resize:vertical;border:1px solid #999;border-radius:4px;background:#fff;color:#111;font:14px Arial,sans-serif;box-sizing:border-box;'; panel.appendChild(input);
      const fs=document.createElement('input'); fs.type='number'; fs.min='4'; fs.max='96'; fs.step='1'; fs.value=Math.round(data.fontSize||12); fs.title='Tamanho da fonte'; fs.style.cssText='width:90px;margin-top:7px;padding:6px;box-sizing:border-box;'; panel.appendChild(fs);
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:6px;margin-top:8px;justify-content:flex-end;';
      const save=document.createElement('button');save.textContent='Salvar';save.style.cssText='padding:6px 12px;border:0;border-radius:4px;cursor:pointer;background:#c1442d;color:#fff;font-weight:700;';
      const del=document.createElement('button');del.textContent='Excluir';del.style.cssText='padding:6px 12px;border:0;border-radius:4px;cursor:pointer;background:#8b1e1e;color:#fff;font-weight:700;';
      const cancel=document.createElement('button');cancel.textContent='Cancelar';cancel.style.cssText='padding:6px 12px;border:1px solid #aaa;border-radius:4px;cursor:pointer;background:#eee;color:#222;font-weight:600;'; row.append(save,del,cancel);panel.appendChild(row); pageCanvas.appendChild(panel); input.focus(); input.select();
      const before=cloneState(); const close=()=>panel.remove();
      save.onclick=()=>{pushEdit(t.id,{text:input.value,fontSize:Math.max(4,Number(fs.value)||data.fontSize),deleted:false});commit(before);close();renderLayer();status.textContent='Texto alterado. Você pode continuar editando.';};
      del.onclick=()=>{removeExisting(t.id);commit(before);close();renderLayer();status.textContent='Texto excluído. Ele será removido do PDF ao salvar.';};
      cancel.onclick=close;
      input.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();save.click();}});
    }

    function openNewTextEditor(id){
      const o=objects.find(x=>x.id===id); if(!o)return;
      const panel=document.createElement('div');panel.className='pdf-text-editor';panel.style.cssText='position:absolute;z-index:10000;left:10px;top:10px;width:300px;max-width:calc(100% - 20px);padding:10px;background:#fff;color:#111;border:2px solid #c1442d;border-radius:6px;box-shadow:0 8px 25px rgba(0,0,0,.35);box-sizing:border-box;line-height:normal;';
      const title=document.createElement('div');title.textContent='Novo texto';title.style.cssText='font-weight:700;margin-bottom:7px;font:700 13px Arial,sans-serif;';panel.appendChild(title);
      const input=document.createElement('textarea');input.value=o.text||'';input.style.cssText='display:block;width:100%;min-height:70px;padding:7px;resize:vertical;border:1px solid #999;border-radius:4px;background:#fff;color:#111;font:14px Arial,sans-serif;box-sizing:border-box;';panel.appendChild(input);
      const fs=document.createElement('input');fs.type='number';fs.min='4';fs.max='96';fs.value=Math.round(o.fontSize||14);fs.style.cssText='width:90px;margin-top:7px;padding:6px;box-sizing:border-box;';panel.appendChild(fs);
      const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;margin-top:8px;justify-content:flex-end;';
      const save=document.createElement('button');save.textContent='Salvar';save.style.cssText='padding:6px 12px;border:0;border-radius:4px;cursor:pointer;background:#c1442d;color:#fff;font-weight:700;';
      const del=document.createElement('button');del.textContent='Excluir';del.style.cssText='padding:6px 12px;border:0;border-radius:4px;cursor:pointer;background:#8b1e1e;color:#fff;font-weight:700;';
      const cancel=document.createElement('button');cancel.textContent='Cancelar';cancel.style.cssText='padding:6px 12px;border:1px solid #aaa;border-radius:4px;cursor:pointer;background:#eee;color:#222;font-weight:600;';row.append(save,del,cancel);panel.appendChild(row);pageCanvas.appendChild(panel);input.focus();
      const before=cloneState(); const close=()=>panel.remove();
      save.onclick=()=>{o.text=input.value;o.fontSize=Math.max(4,Number(fs.value)||14);commit(before);close();renderLayer();};
      del.onclick=()=>{objects=objects.filter(x=>x.id!==id);selected=null;commit(before);close();renderLayer();};
      cancel.onclick=close;
    }

    function renderLayer(doSelect=true){
      layer.innerHTML=''; if(!previewImg.naturalWidth)return;
      if(doSelect===true && selected && selected.kind==='existing' && findEdit(selected.id)?.deleted) selected=null;
      textBoxes.filter(t=>t.page===currentPage).forEach(t=>{const d=existingData(t);if(d.deleted)return;makeBox(t,d,'existing',t.id);});
      objects.filter(o=>o.page===currentPage).forEach(o=>makeBox(null,o,'new',o.id));
    }

    function renderPage(){
      if(!thumbs.length)return;
      previewImg.onload=()=>{editor.classList.remove('hidden');requestAnimationFrame(()=>renderLayer());};
      previewImg.src=thumbs[currentPage-1];
      const indicator=pageNav.querySelector('#pageIndicator'); if(indicator)indicator.textContent=`Página ${currentPage} de ${pageCount}`;
    }

    editor.addEventListener('pointerdown',e=>{
      if(e.target!==previewImg && e.target!==pageCanvas && e.target!==layer)return;
      if(mode!=='text')return;
      const p=screenToPdf(e.clientX,e.clientY);
      const id=`pNEW-${currentPage}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const before=cloneState();
      objects.push({id,page:currentPage,x:p.x,y:p.y,width:90,height:16,fontSize:14,text:'Novo texto'});
      commit(before); selected={kind:'new',id}; setMode('select'); renderLayer(); openNewTextEditor(id);
    });

    toolButtons.forEach(b=>b.onclick=()=>setMode(b.dataset.tool));
    toolbar.querySelector('[data-action="undo"]').onclick=undo;
    toolbar.querySelector('[data-action="redo"]').onclick=redo;
    toolbar.querySelector('[data-action="delete"]').onclick=()=>{const item=selectedItem();if(!item)return;const before=cloneState();if(item.kind==='new')objects=objects.filter(o=>o.id!==item.id);else removeExisting(item.id);selected=null;commit(before);renderLayer();};

    pageNav.querySelector('#prevPage').onclick=()=>{if(currentPage>1){currentPage--;selected=null;renderPage();}};
    pageNav.querySelector('#nextPage').onclick=()=>{if(currentPage<pageCount){currentPage++;selected=null;renderPage();}};
    window.addEventListener('resize',()=>requestAnimationFrame(renderLayer));

    dz.el.onchange=async files=>{
      if(files.length!==1)return;
      info.textContent='Carregando PDF…';status.textContent='Lendo os textos do PDF…';
      const fd=new FormData();fd.append('file',files[0]);
      try{
        const res=await postForm('/api/inspect',fd),data=await res.json();
        fileId=data.fileId;pageCount=data.pageCount;thumbs=data.thumbnails||[];textBoxes=data.textBoxes||[];edits=[];objects=[];undoStack=[];redoStack=[];currentPage=1;selected=null;
        editor.classList.remove('hidden');pageNav.classList.toggle('hidden',pageCount<=1);info.textContent=`PDF carregado (${pageCount} página(s)).`;
        status.textContent=textBoxes.length?`${textBoxes.length} texto(s) encontrado(s). Clique em um texto para editar, mover ou redimensionar.`:'Nenhum texto foi encontrado. Se for escaneado, será necessário OCR.';
        renderPage();
      }catch(e){console.error(e);toast(e.message,true);status.textContent='Erro ao carregar o PDF: '+e.message;}
    };

    saveBtn.onclick=async()=>{
      if(!fileId)return toast('Envie um PDF primeiro.',true);
      if(!edits.length&&!objects.length)return toast('Nenhuma alteração foi feita.',true);
      const annotations=[...edits];
      objects.filter(o=>o.text&&o.text.trim()).forEach(o=>annotations.push({id:o.id,page:o.page,x:o.x,y:o.y,width:o.width,height:o.height,fontSize:o.fontSize,text:o.text,deleted:false}));
      const fd=new FormData();fd.append('fileId',fileId);fd.append('annotations',JSON.stringify(annotations));
      setLoading(saveBtn,true,'Salvando PDF…');
      try{const res=await postForm('/api/edit/annotate',fd);downloadBlob(await res.blob(),'editado.pdf');toast('PDF editado e baixado com sucesso!');}
      catch(e){toast(e.message,true);} setLoading(saveBtn,false);
    };

    setMode('select');
  };
})();
