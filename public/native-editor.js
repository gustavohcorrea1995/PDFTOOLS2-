(() => {
  const fileInput = document.getElementById('nativeFile');
  const stage = document.getElementById('nativeStage');
  const status = document.getElementById('nativeStatus');
  const props = document.getElementById('nativeProps');
  const saveBtn = document.getElementById('nativeSave');
  let mode = 'select';
  let file = null;
  let fileId = null;
  let pageSizes = [];
  let textBoxes = [];
  let selected = null;
  let dirty = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const setStatus = msg => status.textContent = msg;

  document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
    setStatus(mode === 'text' ? 'Clique em uma área da página para adicionar texto.' : `Modo: ${btn.textContent.trim()}`);
  }));

  fileInput.addEventListener('change', async () => {
    file = fileInput.files?.[0] || null;
    if (!file) return;
    try {
      setStatus('Analisando PDF…');
      const fd = new FormData(); fd.append('file', file);
      const response = await fetch('/api/inspect', { method:'POST', body:fd });
      if (!response.ok) throw new Error((await response.json()).error || 'Falha ao analisar PDF.');
      const data = await response.json();
      fileId = data.fileId; pageSizes = data.pageSizes || []; textBoxes = data.textBoxes || [];
      renderPage(1, data.thumbnails?.[0]);
      saveBtn.disabled = false;
      setStatus(`${data.pageCount} página(s) carregada(s). Texto detectado: ${textBoxes.length}.`);
    } catch (e) { setStatus(e.message); }
  });

  function renderPage(page, thumb) {
    stage.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'native-page';
    img.alt = `Página ${page}`;
    img.src = thumb || `/api/preview/${encodeURIComponent(fileId)}/${page}`;
    stage.appendChild(img);
    img.onload = () => renderTextObjects(page, img);
  }

  function renderTextObjects(page, img) {
    stage.querySelectorAll('.native-text-object').forEach(e => e.remove());
    const size = pageSizes[page - 1];
    if (!size || !img.clientWidth) return;
    textBoxes.filter(t => Number(t.page) === page).forEach(item => {
      const box = document.createElement('div');
      box.className = 'native-text-object';
      box.dataset.id = item.id;
      box.textContent = item.text;
      const left = item.pdfX * img.clientWidth / size.width;
      const top = item.pdfY * img.clientHeight / size.height;
      const width = item.pdfWidth * img.clientWidth / size.width;
      const height = item.pdfHeight * img.clientHeight / size.height;
      box.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${Math.max(4,width)}px;height:${Math.max(8,height)}px;color:transparent;background:transparent;border:1px solid transparent;cursor:text;z-index:3;box-sizing:border-box;`;
      box.addEventListener('click', ev => {
        ev.stopPropagation();
        if (mode === 'delete') { item.deleted = true; dirty = true; box.remove(); setStatus('Texto marcado para exclusão.'); return; }
        if (mode === 'text' || mode === 'select' || mode === 'bold' || mode === 'italic' || mode === 'underline') selectText(item, box);
      });
      stage.style.position = 'relative';
      stage.appendChild(box);
    });
  }

  function selectText(item, box) {
    selected = item;
    document.querySelectorAll('.native-text-object').forEach(el => el.style.borderColor = 'transparent');
    box.style.borderColor = '#c1442d';
    props.innerHTML = `
      <div><strong>${esc(item.text)}</strong></div>
      <label>Texto</label><textarea id="nativeText" style="width:100%;min-height:70px;box-sizing:border-box;background:#111820;color:#fff;border:1px solid #465362;border-radius:5px;padding:7px;">${esc(item.text)}</textarea>
      <label>Tamanho</label><input id="nativeSize" type="number" min="4" max="96" value="${Math.round(item.fontSize || item.pdfHeight || 12)}">
      <label>Cor</label><input id="nativeColor" type="color" value="#111111">
      <p class="native-note">X: ${Number(item.pdfX).toFixed(2)} · Y: ${Number(item.pdfY).toFixed(2)} · W: ${Number(item.pdfWidth).toFixed(2)} · H: ${Number(item.pdfHeight).toFixed(2)}</p>
      <button id="nativeApply" class="native-save" style="margin-top:8px">Aplicar alteração</button>`;
    document.getElementById('nativeApply').onclick = () => {
      item.text = document.getElementById('nativeText').value;
      item.fontSize = Number(document.getElementById('nativeSize').value) || item.fontSize;
      dirty = true;
      box.textContent = item.text;
      setStatus('Alteração visível na prévia. Ainda não salva no PDF.');
    };
    if (mode === 'bold') { item.bold = !item.bold; dirty = true; setStatus('Negrito marcado para o novo motor.'); }
    if (mode === 'italic') { item.italic = !item.italic; dirty = true; setStatus('Itálico marcado para o novo motor.'); }
    if (mode === 'underline') { item.underline = !item.underline; dirty = true; setStatus('Sublinhado marcado para o novo motor.'); }
  }

  stage.addEventListener('click', ev => {
    if (mode !== 'text' || !fileId) return;
    const img = stage.querySelector('img');
    const size = pageSizes[0];
    if (!img || !size) return;
    const r = img.getBoundingClientRect();
    if (ev.target !== stage && ev.target !== img) return;
    const x = Math.max(0, ev.clientX - r.left) * size.width / r.width;
    const y = Math.max(0, ev.clientY - r.top) * size.height / r.height;
    const item = { id:`pnew-${Date.now()}`, page:1, pdfX:x, pdfY:y, pdfWidth:140, pdfHeight:16, x, y, width:140, height:16, text:'Novo texto', fontSize:12 };
    textBoxes.push(item); dirty = true; renderTextObjects(1,img); setStatus('Novo texto criado na prévia.');
  });

  window.addEventListener('resize', () => { const img = stage.querySelector('img'); if (img) renderTextObjects(1,img); });

  saveBtn.addEventListener('click', async () => {
    if (!file || !fileId) return;
    try {
      saveBtn.disabled = true; saveBtn.textContent = 'Salvando…';
      const fd = new FormData();
      fd.append('fileId', fileId);
      fd.append('annotations', JSON.stringify(textBoxes.map(t => ({ ...t, page:t.page, pdfX:t.pdfX, pdfY:t.pdfY, pdfWidth:t.pdfWidth, pdfHeight:t.pdfHeight, text:t.text, fontSize:t.fontSize, deleted:t.deleted === true }))));
      const response = await fetch('/api/edit/annotate', { method:'POST', body:fd });
      if (!response.ok) throw new Error((await response.json()).error || 'Falha ao salvar.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'PDFTools2-editado.pdf'; a.click(); URL.revokeObjectURL(url);
      dirty = false; setStatus('PDF salvo com sucesso.');
    } catch(e) { setStatus(e.message); }
    finally { saveBtn.disabled = false; saveBtn.textContent = 'Salvar PDF'; }
  });
})();
