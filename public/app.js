const toolGrid = document.getElementById('toolGrid');
const hero = document.getElementById('hero');
const workspace = document.getElementById('workspace');
const toolTitle = document.getElementById('toolTitle');
const toolBody = document.getElementById('toolBody');
const backBtn = document.getElementById('backBtn');
const toastEl = document.getElementById('toast');

function toast(msg, isError=false){
  toastEl.textContent = msg;
  toastEl.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> toastEl.className='', 3200);
}

const TOOLS = [
  { id:'merge', icon:'🧷', title:'Juntar PDFs', desc:'Combine vários arquivos PDF em um só, na ordem que quiser.', tag:'Organizar' },
  { id:'split', icon:'✂️', title:'Dividir PDF', desc:'Separe páginas em arquivos independentes ou extraia intervalos.', tag:'Organizar' },
  { id:'edit', icon:'🗂️', title:'Organizar páginas', desc:'Exclua, gire e reordene páginas de um PDF.', tag:'Editar' },
  { id:'annotate', icon:'✍️', title:'Adicionar texto/imagem', desc:'Insira texto ou carimbe uma imagem em qualquer página.', tag:'Editar', disabled:true },
  { id:'compress', icon:'🗜️', title:'Comprimir PDF', desc:'Reduza o tamanho do arquivo mantendo a qualidade legível.', tag:'Otimizar' },
  { id:'images-to-pdf', icon:'🖼️', title:'Imagens → PDF', desc:'Transforme fotos e imagens em um único PDF.', tag:'Converter' },
  { id:'pdf-to-images', icon:'📷', title:'PDF → Imagens', desc:'Exporte cada página como PNG ou JPG.', tag:'Converter' },
  { id:'office-to-pdf', icon:'📝', title:'Word/Excel/PPT → PDF', desc:'Converta documentos do Office para PDF.', tag:'Converter' },
  { id:'pdf-to-office', icon:'📄', title:'PDF → Word', desc:'Converta um PDF de volta para um documento editável.', tag:'Converter' },
];

function renderGrid(){
  toolGrid.innerHTML = '';
  TOOLS.filter(t => !t.disabled).forEach(t=>{
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `<span class="stamp-mark">${t.tag}</span>
      <div class="icon">${t.icon}</div>
      <h3>${t.title}</h3><p>${t.desc}</p>`;
    card.onclick = () => openTool(t.id);
    toolGrid.appendChild(card);
  });
}
renderGrid();

backBtn.onclick = () => {
  workspace.classList.add('hidden');
  hero.classList.remove('hidden');
  toolBody.innerHTML = '';
};

function openTool(id){
  const tool = TOOLS.find(t=>t.id===id);
  if(!tool || tool.disabled){
    // Editor clássico desativado temporariamente - manda para o Editor PDF Pro.
    window.location.href = '/native-editor.html';
    return;
  }
  hero.classList.add('hidden');
  workspace.classList.remove('hidden');
  toolTitle.textContent = tool.title;
  toolBody.innerHTML = '';
  RENDERERS[id](toolBody);
}

// ---------- generic dropzone ----------
function makeDropzone(container, { accept='*', multiple=true, label='Arraste arquivos aqui ou clique para escolher' }){
  const dz = document.createElement('div');
  dz.className = 'dropzone';
  dz.innerHTML = `<div class="dz-title">${label}</div><p>Seus arquivos ficam só no seu servidor local</p>`;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept; input.multiple = multiple; input.style.display='none';
  dz.appendChild(input);
  container.appendChild(dz);

  const list = document.createElement('div');
  list.className = 'file-list';
  container.appendChild(list);

  let files = [];
  function renderList(){
    list.innerHTML = '';
    files.forEach((f,i)=>{
      const row = document.createElement('div');
      row.className='file-row';
      row.innerHTML = `<span class="name">${f.name}</span>`;
      const rm = document.createElement('button');
      rm.textContent = '✕';
      rm.onclick = (e)=>{ e.stopPropagation(); files.splice(i,1); renderList(); dz.onchange && dz.onchange(files); };
      row.appendChild(rm);
      list.appendChild(row);
    });
  }
  dz.onclick = ()=> input.click();
  input.onchange = ()=>{
    files = multiple ? files.concat(Array.from(input.files)) : Array.from(input.files);
    renderList();
    dz.onchange && dz.onchange(files);
    input.value = '';
  };
  ['dragover','dragenter'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e=>{
    const dropped = Array.from(e.dataTransfer.files);
    files = multiple ? files.concat(dropped) : dropped;
    renderList();
    dz.onchange && dz.onchange(files);
  });

  return { getFiles: ()=>files, el: dz };
}

function makeButton(container, text){
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = text;
  container.appendChild(btn);
  return btn;
}

function setLoading(btn, loading, text){
  btn.disabled = loading;
  btn.innerHTML = loading ? `<span class="spinner"></span>${text||'Processando…'}` : btn.dataset.label;
}

async function postForm(url, formData){
  const res = await fetch(url, { method:'POST', body: formData });

  if(!res.ok){
    let msg = 'Falha ao processar o arquivo.';

    try{
      const type = res.headers.get('content-type') || '';

      if(type.includes('application/json')){
        const data = await res.json();
        msg = data.error || msg;
      }else{
        const text = await res.text();
        if(text) msg = text.slice(0, 500);
      }
    }catch(_){}

    throw new Error(msg);
  }

  return res;
}

const canPickSaveLocation = typeof window.showSaveFilePicker === 'function';

function splitExtension(filename){
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? [filename.slice(0, dot), filename.slice(dot)] : [filename, ''];
}

function sanitizeFileName(raw){
  return String(raw || '').trim().replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * Pergunta ONDE salvar e com QUE NOME antes de iniciar qualquer envio ao
 * servidor - essencial porque o diálogo nativo "Salvar como" do sistema
 * operacional (showSaveFilePicker) só funciona como reação IMEDIATA a um
 * clique do usuário. Se a gente esperasse o processamento terminar antes
 * de perguntar (como era antes), o diálogo nativo falharia silenciosamente
 * por causa do tempo já passado desde o clique.
 *
 * Devolve { cancelled } se o usuário desistiu (nesse caso nem chegamos a
 * enviar nada ao servidor), ou { cancelled:false, deliver(blob) } para
 * entregar o arquivo assim que ele estiver pronto.
 */
async function pickSaveTarget(defaultFilename){
  const [defaultBase, extension] = splitExtension(defaultFilename);

  if(canPickSaveLocation){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultFilename,
        types: extension ? [{ description: 'Arquivo', accept: { 'application/octet-stream': [extension] } }] : undefined
      });
      return {
        cancelled: false,
        async deliver(blob){
          if(!blob || blob.size === 0) throw new Error('O servidor não retornou um arquivo válido.');
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
      };
    }catch(err){
      if(err && err.name === 'AbortError') return { cancelled: true };
      console.warn('Seletor de pasta nativo indisponível, usando download padrão:', err);
      // segue para o prompt de nome abaixo
    }
  }

  // Navegadores sem suporte ao seletor nativo (Firefox, Safari): pergunta
  // só o nome e baixa para a pasta padrão de downloads do navegador.
  let chosen = window.prompt('Digite o nome do arquivo antes de baixar:', defaultBase);
  if(chosen === null) return { cancelled: true };
  chosen = sanitizeFileName(chosen) || defaultBase;
  if(extension && !chosen.toLowerCase().endsWith(extension.toLowerCase())) chosen += extension;

  return {
    cancelled: false,
    async deliver(blob){
      if(!blob || blob.size === 0) throw new Error('O servidor não retornou um arquivo válido.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = chosen;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); }, 1000);
    }
  };
}

// ---------- RENDERERS ----------
const RENDERERS = {};

RENDERERS['merge'] = (root)=>{
  // Zona de soltar arquivos própria (não usa makeDropzone) para poder
  // mostrar miniaturas e permitir reordenar - a lista padrão só mostra nomes.
  const dz = document.createElement('div');
  dz.className = 'dropzone';
  dz.innerHTML = `<div class="dz-title">Arraste 2 ou mais PDFs</div><p>Seus arquivos ficam só no seu servidor local</p>`;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.pdf'; input.multiple = true; input.style.display = 'none';
  dz.appendChild(input);
  root.appendChild(dz);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '';
  root.appendChild(hint);

  const grid = document.createElement('div');
  grid.className = 'merge-grid';
  root.appendChild(grid);

  let items = []; // { file, thumb, pageCount, loading }

  async function fetchPreview(file){
    const fd = new FormData();
    fd.append('file', file);
    try{
      const res = await postForm('/api/inspect', fd);
      const data = await res.json();
      return { thumb: data.thumbnails?.[0] || null, pageCount: data.pageCount || null };
    }catch(e){
      return { thumb: null, pageCount: null };
    }
  }

  function updateHint(){
    if(!items.length){ hint.textContent = ''; return; }
    const totalPages = items.reduce((sum,it)=> sum + (it.pageCount||0), 0);
    hint.textContent = `${items.length} arquivo(s) · ${totalPages || '…'} página(s) no total · arraste os cartões para mudar a ordem de junção`;
  }

  function renderGrid(){
    updateHint();
    grid.innerHTML = '';
    items.forEach((item, idx)=>{
      const card = document.createElement('div');
      card.className = 'merge-card';
      card.draggable = true;
      card.innerHTML = `
        <div class="merge-card-order">${idx+1}</div>
        <div class="merge-card-thumb">${item.thumb ? `<img src="${item.thumb}" alt="">` : '<div class="merge-card-loading">Carregando…</div>'}</div>
        <div class="merge-card-name" title="${item.file.name}">${item.file.name}</div>
        <div class="merge-card-meta">${item.pageCount ? item.pageCount + (item.pageCount===1?' página':' páginas') : ''}</div>
        <div class="merge-card-actions">
          <button data-a="left" title="Mover para trás" ${idx===0?'disabled':''}>←</button>
          <button data-a="right" title="Mover para frente" ${idx===items.length-1?'disabled':''}>→</button>
          <button data-a="del" title="Remover">✕</button>
        </div>`;
      card.querySelector('[data-a=left]').onclick = ()=>{ if(idx>0){ [items[idx-1],items[idx]]=[items[idx],items[idx-1]]; renderGrid(); } };
      card.querySelector('[data-a=right]').onclick = ()=>{ if(idx<items.length-1){ [items[idx+1],items[idx]]=[items[idx],items[idx+1]]; renderGrid(); } };
      card.querySelector('[data-a=del]').onclick = ()=>{ items.splice(idx,1); renderGrid(); };

      card.addEventListener('dragstart', (e)=>{ e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed='move'; setTimeout(()=>card.classList.add('dragging'),0); });
      card.addEventListener('dragend', ()=> card.classList.remove('dragging'));
      card.addEventListener('dragover', (e)=>{ e.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', ()=> card.classList.remove('drag-over'));
      card.addEventListener('drop', (e)=>{
        e.preventDefault();
        card.classList.remove('drag-over');
        const fromIdx = Number(e.dataTransfer.getData('text/plain'));
        if(Number.isNaN(fromIdx) || fromIdx === idx) return;
        const [moved] = items.splice(fromIdx,1);
        items.splice(idx,0,moved);
        renderGrid();
      });

      grid.appendChild(card);
    });
  }

  async function addFiles(newFiles){
    const toAdd = newFiles.map(file => ({ file, thumb: null, pageCount: null }));
    items = items.concat(toAdd);
    renderGrid();
    for(const item of toAdd){
      const { thumb, pageCount } = await fetchPreview(item.file);
      item.thumb = thumb; item.pageCount = pageCount;
      renderGrid();
    }
  }

  dz.onclick = ()=> input.click();
  input.onchange = ()=>{ addFiles(Array.from(input.files)); input.value=''; };
  ['dragover','dragenter'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e=>{
    e.preventDefault();
    dz.classList.remove('drag');
    addFiles(Array.from(e.dataTransfer.files).filter(f=>/\.pdf$/i.test(f.name)));
  });

  const btn = makeButton(root, 'Juntar PDFs');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    if(items.length < 2) return toast('Selecione pelo menos 2 arquivos PDF.', true);
    const save = await pickSaveTarget('unido.pdf');
    if(save.cancelled) return;
    const fd = new FormData();
    items.forEach(it=>fd.append('files', it.file));
    setLoading(btn,true,'Juntando…');
    try{
      const res = await postForm('/api/merge', fd);
      await save.deliver(await res.blob());
      toast('PDFs unidos com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

RENDERERS['split'] = (root)=>{
  const dz = makeDropzone(root, { accept:'.pdf', multiple:false, label:'Arraste um PDF' });
  const field = document.createElement('div');
  field.className='field';
  field.innerHTML = `<label>Intervalos de páginas (ex: 1-3,4,5-6). Deixe em branco para separar todas as páginas.</label>
    <input type="text" id="ranges" placeholder="1-3,4,5-6">`;
  root.appendChild(field);
  const btn = makeButton(root, 'Dividir PDF');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    const files = dz.getFiles();
    if(files.length !== 1) return toast('Selecione um arquivo PDF.', true);
    const save = await pickSaveTarget('partes.zip');
    if(save.cancelled) return;
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('ranges', document.getElementById('ranges').value);
    setLoading(btn,true,'Dividindo…');
    try{
      const res = await postForm('/api/split', fd);
      await save.deliver(await res.blob());
      toast('PDF dividido com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

RENDERERS['compress'] = (root)=>{
  const dz = makeDropzone(root, { accept:'.pdf', multiple:false, label:'Arraste um PDF' });
  const field = document.createElement('div');
  field.className='field';
  field.innerHTML = `<label>Nível de compressão</label>
    <select id="level">
      <option value="screen">Máxima (menor arquivo, qualidade menor)</option>
      <option value="ebook" selected>Equilibrada (recomendado)</option>
      <option value="printer">Leve (qualidade alta)</option>
    </select>`;
  root.appendChild(field);
  const btn = makeButton(root, 'Comprimir PDF');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    const files = dz.getFiles();
    if(files.length !== 1) return toast('Selecione um arquivo PDF.', true);
    const save = await pickSaveTarget('comprimido.pdf');
    if(save.cancelled) return;
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('level', document.getElementById('level').value);
    setLoading(btn,true,'Comprimindo…');
    try{
      const res = await postForm('/api/compress', fd);
      await save.deliver(await res.blob());
      toast('PDF comprimido com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

RENDERERS['images-to-pdf'] = (root)=>{
  const dz = makeDropzone(root, { accept:'image/*', label:'Arraste imagens (JPG, PNG…)' });
  const btn = makeButton(root, 'Converter para PDF');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    const files = dz.getFiles();
    if(files.length < 1) return toast('Selecione pelo menos uma imagem.', true);
    const save = await pickSaveTarget('imagens.pdf');
    if(save.cancelled) return;
    const fd = new FormData();
    files.forEach(f=>fd.append('files', f));
    setLoading(btn,true,'Convertendo…');
    try{
      const res = await postForm('/api/convert/images-to-pdf', fd);
      await save.deliver(await res.blob());
      toast('PDF gerado com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

RENDERERS['pdf-to-images'] = (root)=>{
  const dz = makeDropzone(root, { accept:'.pdf', multiple:false, label:'Arraste um PDF' });
  const field = document.createElement('div');
  field.className='field';
  field.innerHTML = `<label>Formato de saída</label>
    <select id="fmt"><option value="png">PNG</option><option value="jpg">JPG</option></select>`;
  root.appendChild(field);
  const btn = makeButton(root, 'Exportar páginas');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    const files = dz.getFiles();
    if(files.length !== 1) return toast('Selecione um arquivo PDF.', true);
    const save = await pickSaveTarget('paginas.zip');
    if(save.cancelled) return;
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('format', document.getElementById('fmt').value);
    setLoading(btn,true,'Exportando…');
    try{
      const res = await postForm('/api/convert/pdf-to-images', fd);
      await save.deliver(await res.blob());
      toast('Imagens exportadas com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

RENDERERS['office-to-pdf'] = (root)=>{
  const dz = makeDropzone(root, { accept:'.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt', multiple:false, label:'Arraste um Word, Excel ou PowerPoint' });
  const btn = makeButton(root, 'Converter para PDF');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    const files = dz.getFiles();
    if(files.length !== 1) return toast('Selecione um arquivo.', true);
    const save = await pickSaveTarget('convertido.pdf');
    if(save.cancelled) return;
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('target', 'pdf');
    setLoading(btn,true,'Convertendo…');
    try{
      const res = await postForm('/api/convert/office', fd);
      await save.deliver(await res.blob());
      toast('Arquivo convertido com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

RENDERERS['pdf-to-office'] = (root)=>{
  const dz = makeDropzone(root, { accept:'.pdf', multiple:false, label:'Arraste um PDF' });
  const field = document.createElement('div');
  field.className='field';
  field.innerHTML = `<label>Converter para</label>
    <select id="target">
      <option value="docx">Word (.docx)</option>
      <option value="odt">OpenDocument (.odt)</option>
    </select>`;
  root.appendChild(field);
  const hint = document.createElement('p');
  hint.className='hint';
  hint.textContent = 'A fidelidade do layout depende da complexidade do PDF original — PDFs com texto simples convertem melhor.';
  root.appendChild(hint);
  const btn = makeButton(root, 'Converter');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    const files = dz.getFiles();
    if(files.length !== 1) return toast('Selecione um arquivo PDF.', true);
    const target = document.getElementById('target').value;
    const save = await pickSaveTarget('convertido.' + target);
    if(save.cancelled) return;
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('target', target);
    setLoading(btn,true,'Convertendo…');
    try{
      const res = await postForm('/api/convert/office', fd);
      await save.deliver(await res.blob());
      toast('Arquivo convertido com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

// ---------- Organizar páginas (delete/rotate/reorder) ----------
RENDERERS['edit'] = (root)=>{
  const dz = makeDropzone(root, { accept:'.pdf', multiple:false, label:'Arraste um PDF para organizar' });
  const grid = document.createElement('div');
  grid.className = 'pages-grid';
  root.appendChild(grid);

  let state = { pageCount:0, thumbs:[], order:[], rotations:{}, deleted:new Set() };

  dz.el.onchange = async (files)=>{
    if(files.length !== 1) return;
    grid.innerHTML = '<p class="hint">Carregando páginas…</p>';
    const fd = new FormData();
    fd.append('file', files[0]);
    try{
      const res = await postForm('/api/inspect', fd);
      const data = await res.json();
      state.pageCount = data.pageCount;
      state.thumbs = data.thumbnails;
      state.order = Array.from({length:data.pageCount}, (_,i)=>i+1);
      state.rotations = {};
      state.deleted = new Set();
      renderPages();
    }catch(e){ toast(e.message, true); grid.innerHTML=''; }
  };

  function renderPages(){
    grid.innerHTML = '';
    state.order.forEach((pageNum, idx)=>{
      const div = document.createElement('div');
      div.className = 'page-thumb' + (state.deleted.has(pageNum) ? ' marked' : '');
      const rot = state.rotations[pageNum] || 0;
      div.innerHTML = `
        <img src="${state.thumbs[pageNum-1]}" style="transform:rotate(${rot}deg)">
        <div class="pnum">Pág. ${pageNum}</div>
        <div class="actions">
          <button data-a="left">↺</button>
          <button data-a="right">↻</button>
          <button data-a="up">←</button>
          <button data-a="down">→</button>
          <button data-a="del">${state.deleted.has(pageNum)?'↩':'✕'}</button>
        </div>`;
      div.querySelector('[data-a=left]').onclick = ()=>{ state.rotations[pageNum]=((rot-90)%360+360)%360; renderPages(); };
      div.querySelector('[data-a=right]').onclick = ()=>{ state.rotations[pageNum]=((rot+90)%360+360)%360; renderPages(); };
      div.querySelector('[data-a=up]').onclick = ()=>{ if(idx>0){ [state.order[idx-1],state.order[idx]]=[state.order[idx],state.order[idx-1]]; renderPages(); } };
      div.querySelector('[data-a=down]').onclick = ()=>{ if(idx<state.order.length-1){ [state.order[idx+1],state.order[idx]]=[state.order[idx],state.order[idx+1]]; renderPages(); } };
      div.querySelector('[data-a=del]').onclick = ()=>{ state.deleted.has(pageNum) ? state.deleted.delete(pageNum) : state.deleted.add(pageNum); renderPages(); };
      grid.appendChild(div);
    });
  }

  const btn = makeButton(root, 'Aplicar alterações');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    const files = dz.getFiles();
    if(!state.pageCount) return toast('Envie um PDF primeiro.', true);
    const save = await pickSaveTarget('editado.pdf');
    if(save.cancelled) return;
    const fd = new FormData();
    fd.append('file', files[files.length-1]);
    fd.append('operations', JSON.stringify({
      keepOrder: state.order,
      delete: Array.from(state.deleted),
      rotations: state.rotations
    }));
    setLoading(btn,true,'Aplicando…');
    try{
      const res = await postForm('/api/pages/edit', fd);
      await save.deliver(await res.blob());
      toast('Alterações aplicadas com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

// ---------- Adicionar texto/imagem (editor visual: clique na página para posicionar) ----------
RENDERERS['annotate'] = (root)=>{
  const dz = makeDropzone(root, {
    accept: '.pdf',
    multiple: false,
    label: 'Arraste um PDF para editar'
  });

  let fileId = null;
  let pageCount = 0;
  let thumbs = [];
  let currentPage = 1;
  let textBoxes = [];
  let edits = [];

  const info = document.createElement('p');
  info.className = 'hint';
  root.appendChild(info);

  const pageNav = document.createElement('div');
  pageNav.className = 'field-row hidden';
  pageNav.innerHTML = `
    <button type="button" id="prevPage" class="btn-ghost">← Página anterior</button>
    <span id="pageIndicator" style="align-self:center;"></span>
    <button type="button" id="nextPage" class="btn-ghost">Próxima página →</button>
  `;
  root.appendChild(pageNav);

  const editor = document.createElement('div');
  editor.className = 'pdf-visual-editor hidden';
  editor.style.cssText = `
    position:relative;
    display:block;
    width:100%;
    max-width:100%;
    overflow:auto;
    background:#777;
    border:1px solid var(--line,#3a4552);
    padding:12px;
    box-sizing:border-box;
  `;
  root.appendChild(editor);

  const pageCanvas = document.createElement('div');
  pageCanvas.style.cssText = `
    position:relative;
    display:block;
    width:max-content;
    max-width:100%;
    margin:0 auto;
    line-height:0;
  `;
  editor.appendChild(pageCanvas);

  const previewImg = document.createElement('img');
  previewImg.style.cssText = `
    display:block;
    max-width:100%;
    height:auto;
    user-select:none;
  `;
  pageCanvas.appendChild(previewImg);

  const textLayer = document.createElement('div');
  textLayer.style.cssText = `
    position:absolute;
    inset:0;
    pointer-events:none;
  `;
  pageCanvas.appendChild(textLayer);

  const status = document.createElement('p');
  status.className = 'hint';
  status.textContent = 'Carregue um PDF para começar.';
  root.appendChild(status);

  function getScale(){
    if(!previewImg.naturalWidth) return 1;
    return previewImg.clientWidth / previewImg.naturalWidth;
  }

  function renderTextLayer(){
    textLayer.innerHTML = '';

    if(!previewImg.naturalWidth) return;

    const scale = getScale();

    textBoxes
      .filter(t => t.page === currentPage)
      .forEach(t => {
        const changed = edits.find(e => e.id === t.id);

        // A imagem do PDF continua sendo a página original. Então, quando
        // algo é excluído/alterado, precisamos cobrir visualmente a área
        // original na prévia. A remoção definitiva continua sendo feita
        // pelo servidor quando o PDF é salvo.
        if(changed){
          const cover = document.createElement('div');

          cover.style.cssText = `
            position:absolute;
            left:${t.x * scale}px;
            top:${t.y * scale}px;
            width:${Math.max(t.width * scale, 3)}px;
            height:${Math.max(t.height * scale, 6)}px;
            background:#fff;
            pointer-events:none;
            box-sizing:border-box;
            z-index:1;
          `;

          textLayer.appendChild(cover);

          if(changed.deleted){
            return;
          }
        }

        const value = changed ? changed.text : t.text;

        const box = document.createElement('div');
        box.textContent = value;
        box.title = 'Clique para editar este texto';

        box.style.cssText = `
          position:absolute;
          left:${t.x * scale}px;
          top:${t.y * scale}px;
          width:${Math.max(t.width * scale, 3)}px;
          height:${Math.max(t.height * scale, 6)}px;
          min-height:0;
          font-family:Arial,sans-serif;
          font-size:${Math.max(t.height * 0.82 * scale, 8)}px;
          line-height:1.05;
          color:transparent;
          background:rgba(255,235,59,.10);
          border:1px solid rgba(193,68,45,.28);
          border-radius:2px;
          pointer-events:auto;
          cursor:text;
          overflow:hidden;
          white-space:pre-wrap;
          box-sizing:border-box;
          padding:0;
        `;

        box.addEventListener('mouseenter', ()=>{
          box.style.background = 'rgba(255,235,59,.25)';
          box.style.borderColor = 'rgba(193,68,45,.75)';
        });

        box.addEventListener('mouseleave', ()=>{
          box.style.background = 'rgba(255,235,59,.10)';
          box.style.borderColor = 'rgba(193,68,45,.28)';
        });

        box.onclick = (ev)=>{
          ev.stopPropagation();
          startTextEdit(t, value, box);
        };

        textLayer.appendChild(box);
      });
  }

  function startTextEdit(t, oldValue, box){
    // Remove any editor that may already be open.
    pageCanvas.querySelectorAll('.pdf-text-editor').forEach(el => el.remove());

    const panel = document.createElement('div');
    panel.className = 'pdf-text-editor';

    panel.style.cssText = `
      position:absolute;
      z-index:10000;
      left:${Math.max(0, box.offsetLeft)}px;
      top:${Math.max(0, box.offsetTop + box.offsetHeight + 6)}px;
      width:280px;
      max-width:calc(100% - 10px);
      padding:10px;
      background:#fff;
      color:#111;
      border:2px solid #c19665;
      border-radius:6px;
      box-shadow:0 8px 25px rgba(0,0,0,.35);
      box-sizing:border-box;
      line-height:normal;
    `;

    const title = document.createElement('div');
    title.textContent = 'Editar texto';
    title.style.cssText = `
      font-weight:700;
      margin-bottom:7px;
      font-family:Arial,sans-serif;
      font-size:13px;
    `;
    panel.appendChild(title);

    const input = document.createElement('textarea');
    input.value = oldValue;
    input.style.cssText = `
      display:block;
      width:100%;
      min-height:70px;
      padding:7px;
      resize:vertical;
      border:1px solid #999;
      border-radius:4px;
      background:#fff;
      color:#111;
      font-family:Arial,sans-serif;
      font-size:14px;
      line-height:1.2;
      box-sizing:border-box;
    `;
    panel.appendChild(input);

    const buttons = document.createElement('div');
    buttons.style.cssText = `
      display:flex;
      gap:6px;
      margin-top:8px;
      justify-content:flex-end;
      flex-wrap:wrap;
    `;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Salvar';
    saveBtn.style.cssText = `
      padding:6px 12px;
      border:0;
      border-radius:4px;
      cursor:pointer;
      background:#c19665;
      color:#fff;
      font-weight:700;
    `;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Excluir';
    deleteBtn.style.cssText = `
      padding:6px 12px;
      border:0;
      border-radius:4px;
      cursor:pointer;
      background:#8b1e1e;
      color:#fff;
      font-weight:700;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.style.cssText = `
      padding:6px 12px;
      border:1px solid #aaa;
      border-radius:4px;
      cursor:pointer;
      background:#eee;
      color:#222;
      font-weight:600;
    `;

    buttons.append(saveBtn, deleteBtn, cancelBtn);
    panel.appendChild(buttons);
    pageCanvas.appendChild(panel);

    input.focus();
    input.select();

    function close(){
      panel.remove();
      renderTextLayer();
    }

    function findEdit(){
      return edits.find(e => e.id === t.id);
    }

    function saveText(){
      const newValue = input.value;

      let existing = findEdit();

      if(existing){
        existing.text = newValue;
        existing.deleted = false;
      }else{
        edits.push({
          id: t.id,
          page: t.page,
          x: t.pdfX ?? t.x,
          y: t.pdfY ?? t.y,
          width: t.pdfWidth ?? t.width,
          height: t.pdfHeight ?? t.height,
          fontSize: t.fontSize || Math.max(t.height, 7),
          text: newValue,
          deleted: false
        });
      }

      status.textContent =
        'Texto alterado. Você pode editar ou excluir outro texto.';

      close();
    }

    function deleteText(){
      let existing = findEdit();

      if(existing){
        existing.deleted = true;
        existing.text = '';
      }else{
        edits.push({
          id: t.id,
          page: t.page,
          x: t.pdfX ?? t.x,
          y: t.pdfY ?? t.y,
          width: t.pdfWidth ?? t.width,
          height: t.pdfHeight ?? t.height,
          fontSize: t.fontSize || Math.max(t.height, 7),
          text: '',
          deleted: true
        });
      }

      status.textContent =
        'Texto excluído. Ele será removido do PDF ao salvar.';

      close();
    }

    saveBtn.onclick = saveText;
    deleteBtn.onclick = deleteText;
    cancelBtn.onclick = close;

    input.addEventListener('keydown', e => {
      if(e.key === 'Escape'){
        e.preventDefault();
        close();
      }

      if(e.key === 'Enter' && e.ctrlKey){
        e.preventDefault();
        saveText();
      }
    });
  }

  function renderPage(){
    if(!thumbs.length) return;

    const previewUrl = thumbs[currentPage - 1];

    previewImg.onload = ()=>{
      editor.classList.remove('hidden');
      status.textContent = textBoxes.length
        ? `${textBoxes.length} texto(s) encontrado(s). Clique diretamente em um texto para editar.`
        : 'Nenhum texto foi encontrado neste PDF. Se for um documento escaneado, use OCR.';
      requestAnimationFrame(renderTextLayer);
    };

    previewImg.onerror = ()=>{
      console.error('Erro ao carregar a página do PDF:', previewUrl);
      status.textContent =
        'Não foi possível carregar a página do PDF. Tente recarregar a página.';
    };

    // O servidor envia a prévia como data URL. Não converta essa URL
    // novamente nem dependa de /api/preview: isso elimina a imagem quebrada.
    previewImg.src = previewUrl;

    const indicator = document.getElementById('pageIndicator');
    if(indicator){
      indicator.textContent = `Página ${currentPage} de ${pageCount}`;
    }
  }

  dz.el.onchange = async (files)=>{
    if(files.length !== 1) return;

    info.textContent = 'Carregando PDF…';
    status.textContent = 'Lendo os textos do PDF…';

    const fd = new FormData();
    fd.append('file', files[0]);

    try{
      const res = await postForm('/api/inspect', fd);
      const data = await res.json();

      fileId = data.fileId;
      pageCount = data.pageCount;
      thumbs = data.thumbnails || [];
      textBoxes = data.textBoxes || [];
      edits = [];
      currentPage = 1;

      editor.classList.remove('hidden');
      pageNav.classList.toggle('hidden', pageCount <= 1);

      info.textContent =
        `PDF carregado (${pageCount} página(s)).`;

      if(textBoxes.length){
        status.textContent =
          `${textBoxes.length} texto(s) encontrado(s). Clique diretamente em um texto para editar.`;
      }else{
        status.textContent =
          'Nenhum texto foi encontrado. Se este PDF for escaneado como imagem, será necessário OCR.';
      }

      renderPage();

    }catch(e){
      console.error('Erro ao carregar PDF:', e);
      toast(e.message, true);
      info.textContent = '';
      status.textContent = 'Erro ao carregar o PDF: ' + e.message;
    }
  };

  window.addEventListener('resize', ()=>{
    requestAnimationFrame(renderTextLayer);
  });

  pageNav.querySelector('#prevPage').onclick = ()=>{
    if(currentPage > 1){
      currentPage--;
      renderPage();
    }
  };

  pageNav.querySelector('#nextPage').onclick = ()=>{
    if(currentPage < pageCount){
      currentPage++;
      renderPage();
    }
  };

  const btn = makeButton(root, 'Salvar PDF editado');
  btn.dataset.label = btn.textContent;

  btn.onclick = async ()=>{
    if(!fileId){
      return toast('Envie um PDF primeiro.', true);
    }

    if(!edits.length){
      return toast('Nenhuma alteração foi feita.', true);
    }

    const save = await pickSaveTarget('editado.pdf');
    if(save.cancelled) return;

    const fd = new FormData();
    fd.append('fileId', fileId);
    fd.append('annotations', JSON.stringify(edits));

    setLoading(btn, true, 'Salvando PDF…');

    try{
      const res = await postForm('/api/edit/annotate', fd);
      const blob = await res.blob();

      await save.deliver(blob);

      toast('PDF editado e baixado com sucesso!');
    }catch(e){
      toast(e.message, true);
    }

    setLoading(btn, false);
  };
};


// Se a navegação veio de outra página (ex: menu lateral do editor nativo),
// abre a ferramenta certa direto, sem precisar clicar no card de novo.
// Fica no fim do arquivo de propósito: precisa que RENDERERS já esteja
// totalmente preenchido antes de chamar openTool().
(() => {
  const qsTool = new URLSearchParams(location.search).get('tool');
  if (qsTool && TOOLS.some(t => t.id === qsTool)) openTool(qsTool);
})();
