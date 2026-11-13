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
  releaseClientPdf();
};

function openTool(id){
  const tool = TOOLS.find(t=>t.id===id);
  if(!tool || tool.disabled){
    // Ferramenta desconhecida ou removida (ex: link antigo pro editor
    // clássico, que foi descontinuado) - manda para o Editor PDF Pro.
    window.location.href = '/native-editor.html';
    return;
  }
  hero.classList.add('hidden');
  workspace.classList.remove('hidden');
  toolTitle.textContent = tool.title;
  toolBody.innerHTML = '';
  releaseClientPdf();
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

// ---------- processamento no navegador (client-pdf.js) ----------
// Miniaturas e as ferramentas Juntar / Dividir / Organizar / Imagens -> PDF
// rodam no navegador. Se qualquer coisa falhar ali (PDF fora do padrão,
// navegador antigo, biblioteca que não carregou), caímos na rota do
// servidor, que continua existindo exatamente como antes.
const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const THUMB_SIDE = 420;
const FULL_SIDE = 1600;
const openPdfSessions = new Set();

function releaseClientPdf(){
  openPdfSessions.forEach(s => s.destroy());
  openPdfSessions.clear();
  if(window.ClientPDF) window.ClientPDF.revokeAll();
}

async function openClientPdf(file){
  if(!window.ClientPDF) throw new Error('ClientPDF indisponível.');
  const session = await window.ClientPDF.open(file);
  openPdfSessions.add(session);
  return session;
}

function closeClientPdf(session){
  if(!session) return;
  session.destroy();
  openPdfSessions.delete(session);
}

/**
 * Roda a operação no navegador; se falhar por motivo técnico, tenta a rota
 * do servidor. Erros de validação (userError) são mostrados direto.
 */
async function clientFirst(label, clientFn, serverFn){
  if(window.ClientPDF){
    try{
      return await clientFn();
    }catch(err){
      if(err && err.userError) throw err;
      console.warn(`${label}: falhou no navegador, usando o servidor.`, err);
    }
  }
  return serverFn();
}

/**
 * Carrega as miniaturas de um PDF aos poucos (uma página por vez).
 * onReady(pageCount) é chamado assim que o número de páginas é conhecido;
 * onThumb(pageNum, url) a cada miniatura pronta. Devolve a sessão, ou null
 * se precisou usar o servidor (nesse caso onThumb já foi chamado para todas).
 */
async function loadThumbs(file, { onReady, onThumb, isStale }){
  try{
    const session = await openClientPdf(file);
    if(isStale()){ closeClientPdf(session); return null; }
    onReady(session.pageCount);
    (async ()=>{
      for(let p=1; p<=session.pageCount; p++){
        if(isStale() || session.destroyed) return;
        try{
          const url = await session.render(p, THUMB_SIDE);
          if(isStale()) return;
          onThumb(p, url);
        }catch(err){
          if(!session.destroyed) console.warn('Miniatura da página ' + p + ' falhou:', err);
        }
      }
    })();
    return session;
  }catch(err){
    console.warn('Prévia no navegador falhou, usando o servidor.', err);
  }
  const fd = new FormData();
  fd.append('file', file);
  const res = await postForm('/api/inspect', fd);
  const data = await res.json();
  if(isStale()) return null;
  onReady(data.pageCount);
  (data.thumbnails || []).forEach((url, i) => onThumb(i+1, url));
  return null;
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
    // Só a capa e a contagem de páginas - feito no navegador.
    let session = null;
    try{
      session = await openClientPdf(file);
      const thumb = await session.render(1, THUMB_SIDE);
      return { thumb, pageCount: session.pageCount };
    }catch(err){
      console.warn('Prévia no navegador falhou, usando o servidor.', err);
    }finally{
      closeClientPdf(session);
    }
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
    setLoading(btn,true,'Juntando…');
    try{
      const files = items.map(it=>it.file);
      const blob = await clientFirst('Juntar',
        ()=> ClientPDF.merge(files),
        async ()=>{
          const fd = new FormData();
          files.forEach(f=>fd.append('files', f));
          return (await postForm('/api/merge', fd)).blob();
        });
      await save.deliver(blob);
      toast('PDFs unidos com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};

RENDERERS['split'] = (root)=>{
  const dz = makeDropzone(root, { accept:'.pdf', multiple:false, label:'Arraste um PDF' });
  const hint = document.createElement('p');
  hint.className = 'hint';
  root.appendChild(hint);
  const grid = document.createElement('div');
  grid.className = 'split-grid';
  root.appendChild(grid);

  // state.splits guarda, em números de página 1-based, APÓS qual página
  // existe uma divisão (ex: splits={3} => um arquivo com as págs. 1-3 e
  // outro com o restante).
  let state = { pageCount: 0, thumbs: [], splits: new Set() };
  let loadToken = 0;
  let session = null;

  dz.el.onchange = async (files)=>{
    // O evento 'change' nativo do <input> interno também borbulha até aqui
    // (com um Event no lugar da lista) - ignora, senão ele cancelaria o
    // carregamento que acabou de começar.
    if(!Array.isArray(files)) return;
    const token = ++loadToken;
    closeClientPdf(session); session = null;
    state = { pageCount: 0, thumbs: [], splits: new Set() };
    grid.innerHTML = '';
    hint.textContent = '';
    if(files.length !== 1) return;
    hint.textContent = 'Carregando páginas…';
    try{
      session = await loadThumbs(files[0], {
        isStale: ()=> token !== loadToken,
        onReady: (pageCount)=>{ state.pageCount = pageCount; state.thumbs = []; renderGrid(); },
        onThumb: (p, url)=>{
          state.thumbs[p-1] = url;
          grid.querySelectorAll(`img[data-p="${p}"]`).forEach(img => img.src = url);
        }
      });
    }catch(e){ if(token === loadToken){ toast(e.message, true); hint.textContent=''; } }
  };

  function computeGroups(){
    const groups = [];
    let start = 1;
    for(let p=1; p<=state.pageCount; p++){
      if(state.splits.has(p)){ groups.push([start,p]); start = p+1; }
    }
    groups.push([start, state.pageCount]);
    return groups;
  }

  function updateHint(){
    if(!state.pageCount){ hint.textContent = ''; return; }
    const groups = computeGroups();
    const desc = groups.map(g => g[0]===g[1] ? `pág. ${g[0]}` : `págs. ${g[0]}–${g[1]}`).join(' · ');
    hint.textContent = groups.length > 1
      ? `${groups.length} arquivos serão gerados: ${desc} · clique num "+" entre páginas para adicionar/remover uma divisão`
      : `Nenhuma divisão marcada ainda - clique num "+" entre as páginas para separar em arquivos diferentes`;
  }

  function renderGrid(){
    updateHint();
    grid.innerHTML = '';
    for(let p=1; p<=state.pageCount; p++){
      const thumb = document.createElement('div');
      thumb.className = 'split-thumb';
      thumb.innerHTML = `<img data-p="${p}" src="${state.thumbs[p-1]||BLANK_IMG}" alt=""><div class="pnum">Pág. ${p}</div>`;
      grid.appendChild(thumb);

      if(p < state.pageCount){
        const active = state.splits.has(p);
        const divider = document.createElement('button');
        divider.type = 'button';
        divider.className = 'split-divider' + (active ? ' active' : '');
        divider.title = active ? 'Remover divisão aqui' : 'Dividir aqui';
        divider.textContent = active ? '✂' : '+';
        divider.onclick = ()=>{ active ? state.splits.delete(p) : state.splits.add(p); renderGrid(); };
        grid.appendChild(divider);
      }
    }
  }

  const btn = makeButton(root, 'Dividir PDF');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    const files = dz.getFiles();
    if(files.length !== 1) return toast('Selecione um arquivo PDF.', true);
    if(!state.pageCount) return toast('Aguarde o PDF carregar.', true);
    const groups = computeGroups();
    if(groups.length < 2) return toast('Adicione ao menos uma divisão entre as páginas.', true);
    const ranges = groups.map(g => g[0]===g[1] ? String(g[0]) : `${g[0]}-${g[1]}`).join(',');
    const save = await pickSaveTarget('partes.zip');
    if(save.cancelled) return;
    setLoading(btn,true,'Dividindo…');
    try{
      const blob = await clientFirst('Dividir',
        ()=> ClientPDF.split(files[0], groups),
        async ()=>{
          const fd = new FormData();
          fd.append('file', files[0]);
          fd.append('ranges', ranges);
          return (await postForm('/api/split', fd)).blob();
        });
      await save.deliver(blob);
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
  const dz = document.createElement('div');
  dz.className = 'dropzone';
  dz.innerHTML = `<div class="dz-title">Arraste imagens (JPG, PNG…)</div><p>Seus arquivos ficam só no seu servidor local</p>`;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.style.display = 'none';
  dz.appendChild(input);
  root.appendChild(dz);

  const hint = document.createElement('p');
  hint.className = 'hint';
  root.appendChild(hint);

  const grid = document.createElement('div');
  grid.className = 'merge-grid';
  root.appendChild(grid);

  let items = []; // { file, thumb } - thumb é local (URL.createObjectURL), não precisa do servidor

  function updateHint(){
    hint.textContent = items.length ? `${items.length} imagem(ns) · a ordem aqui vira a ordem das páginas do PDF · arraste para reordenar` : '';
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
        <div class="merge-card-thumb"><img src="${item.thumb}" alt=""></div>
        <div class="merge-card-name" title="${item.file.name}">${item.file.name}</div>
        <div class="merge-card-actions">
          <button data-a="left" title="Mover para trás" ${idx===0?'disabled':''}>←</button>
          <button data-a="right" title="Mover para frente" ${idx===items.length-1?'disabled':''}>→</button>
          <button data-a="del" title="Remover">✕</button>
        </div>`;
      card.querySelector('[data-a=left]').onclick = ()=>{ if(idx>0){ [items[idx-1],items[idx]]=[items[idx],items[idx-1]]; renderGrid(); } };
      card.querySelector('[data-a=right]').onclick = ()=>{ if(idx<items.length-1){ [items[idx+1],items[idx]]=[items[idx],items[idx+1]]; renderGrid(); } };
      card.querySelector('[data-a=del]').onclick = ()=>{ URL.revokeObjectURL(item.thumb); items.splice(idx,1); renderGrid(); };

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

  function addFiles(newFiles){
    newFiles.forEach(file=>{ items.push({ file, thumb: URL.createObjectURL(file) }); });
    renderGrid();
  }

  dz.onclick = ()=> input.click();
  input.onchange = ()=>{ addFiles(Array.from(input.files)); input.value=''; };
  ['dragover','dragenter'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e=>{
    e.preventDefault();
    dz.classList.remove('drag');
    addFiles(Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/')));
  });

  const btn = makeButton(root, 'Converter para PDF');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    if(items.length < 1) return toast('Selecione pelo menos uma imagem.', true);
    const save = await pickSaveTarget('imagens.pdf');
    if(save.cancelled) return;
    setLoading(btn,true,'Convertendo…');
    try{
      const files = items.map(it=>it.file);
      const blob = await clientFirst('Imagens para PDF',
        ()=> ClientPDF.imagesToPdf(files),
        async ()=>{
          const fd = new FormData();
          files.forEach(f=>fd.append('files', f));
          return (await postForm('/api/convert/images-to-pdf', fd)).blob();
        });
      await save.deliver(blob);
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
  let loadToken = 0;
  let session = null;
  let loadedFile = null;

  dz.el.onchange = async (files)=>{
    // O evento 'change' nativo do <input> interno também borbulha até aqui
    // (com um Event no lugar da lista) - ignora, senão ele cancelaria o
    // carregamento que acabou de começar.
    if(!Array.isArray(files)) return;
    const token = ++loadToken;
    closeClientPdf(session); session = null;
    loadedFile = null;
    state = { pageCount:0, thumbs:[], order:[], rotations:{}, deleted:new Set() };
    grid.innerHTML = '';
    if(files.length !== 1) return;
    grid.innerHTML = '<p class="hint">Carregando páginas…</p>';
    try{
      session = await loadThumbs(files[0], {
        isStale: ()=> token !== loadToken,
        onReady: (pageCount)=>{
          loadedFile = files[0];
          state.pageCount = pageCount;
          state.thumbs = [];
          state.order = Array.from({length:pageCount}, (_,i)=>i+1);
          renderPages();
        },
        onThumb: (p, url)=>{
          state.thumbs[p-1] = url;
          grid.querySelectorAll(`img[data-p="${p}"]`).forEach(img => img.src = url);
        }
      });
    }catch(e){ if(token === loadToken){ toast(e.message, true); grid.innerHTML=''; } }
  };

  function renderPages(){
    grid.innerHTML = '';
    state.order.forEach((pageNum, idx)=>{
      const div = document.createElement('div');
      div.className = 'page-thumb' + (state.deleted.has(pageNum) ? ' marked' : '');
      const rot = state.rotations[pageNum] || 0;
      div.innerHTML = `
        <div class="page-thumb-frame"><img data-p="${pageNum}" src="${state.thumbs[pageNum-1]||BLANK_IMG}" style="transform:rotate(${rot}deg)"></div>
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
      // Ao clicar para ampliar (preview-modal.js), renderiza a página em
      // alta resolução só nesse momento.
      const activeSession = session;
      if(activeSession) div.querySelector('img')._full = ()=> activeSession.render(pageNum, FULL_SIDE);
      grid.appendChild(div);
    });
  }

  const btn = makeButton(root, 'Aplicar alterações');
  btn.dataset.label = btn.textContent;
  btn.onclick = async ()=>{
    if(!state.pageCount || !loadedFile) return toast('Envie um PDF primeiro.', true);
    const file = loadedFile;
    const ops = {
      keepOrder: state.order.slice(),
      delete: Array.from(state.deleted),
      rotations: { ...state.rotations }
    };
    const save = await pickSaveTarget('editado.pdf');
    if(save.cancelled) return;
    setLoading(btn,true,'Aplicando…');
    try{
      const blob = await clientFirst('Organizar páginas',
        ()=> ClientPDF.editPages(file, ops),
        async ()=>{
          const fd = new FormData();
          fd.append('file', file);
          fd.append('operations', JSON.stringify(ops));
          return (await postForm('/api/pages/edit', fd)).blob();
        });
      await save.deliver(blob);
      toast('Alterações aplicadas com sucesso!');
    }catch(e){ toast(e.message, true); }
    setLoading(btn,false);
  };
};


// Se a navegação veio de outra página (ex: menu lateral do editor nativo),
// abre a ferramenta certa direto, sem precisar clicar no card de novo.
// Fica no fim do arquivo de propósito: precisa que RENDERERS já esteja
// totalmente preenchido antes de chamar openTool().
//
// IMPORTANTE: alguns ids de ferramenta (ex: 'ocr') são registrados por
// scripts separados (ocr-tool.js), que fazem a própria checagem da query
// string de forma independente, DEPOIS deste arquivo carregar. Se a gente
// chamasse openTool() para esses ids aqui, cairiam no redirecionamento
// genérico (usado para links antigos de ferramentas removidas, como o
// editor clássico) ANTES do script correto sequer rodar - por isso esses
// ids ficam de fora desta checagem.
const EXTERNALLY_HANDLED_TOOL_IDS = ['ocr'];
(() => {
  const qsTool = new URLSearchParams(location.search).get('tool');
  if (qsTool && !EXTERNALLY_HANDLED_TOOL_IDS.includes(qsTool)) openTool(qsTool);
})();
