(() => {
  if (window.__pdfToolsInlineExistingText) return;
  window.__pdfToolsInlineExistingText = true;

  let pageSizes = [];
  let currentPage = 1;
  const edits = new Map();
  let active = null;

  const getEditor = () => document.querySelector('.pdf-visual-editor');
  const getImage = () => getEditor()?.querySelector('img');
  const getCanvas = () => getImage()?.parentElement;

  function currentPageNumber() {
    const text = document.getElementById('pageIndicator')?.textContent || '';
    const m = text.match(/Página\s+(\d+)/i);
    if (m) currentPage = Number(m[1]);
    return currentPage;
  }

  function close(commit = true) {
    if (!active) return;
    const { input, data } = active;
    if (commit) {
      data.text = input.innerText.replace(/\u00a0/g, ' ');
      edits.set(data.id, data);
    }
    input.remove();
    active = null;
    document.querySelectorAll('.pdftools-inline-selected').forEach(el => el.classList.remove('pdftools-inline-selected'));
  }

  function startEdit(box) {
    if (active) close(true);
    const img = getImage();
    const canvas = getCanvas();
    if (!img || !canvas) return;

    const rect = img.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const page = currentPageNumber();
    const size = pageSizes[page - 1];
    if (!size || !rect.width || !rect.height) return;

    const x = Math.max(0, (br.left - rect.left) * size.width / rect.width);
    const y = Math.max(0, (br.top - rect.top) * size.height / rect.height);
    const width = Math.max(3, br.width * size.width / rect.width);
    const height = Math.max(6, br.height * size.height / rect.height);
    const id = `pinline-${page}-${Math.round(x * 100)}-${Math.round(y * 100)}`;
    const original = box.textContent || '';
    const existing = edits.get(id);
    const data = existing || { id, page, x, y, width, height, fontSize: Math.max(6, height), text: original, deleted: false };

    const input = document.createElement('div');
    input.className = 'pdftools-inline-editor';
    input.contentEditable = 'true';
    input.spellcheck = false;
    input.innerText = data.text;

    const canvasRect = canvas.getBoundingClientRect();
    const left = br.left - canvasRect.left;
    const top = br.top - canvasRect.top;
    input.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${br.width}px;min-height:${br.height}px;z-index:30000;box-sizing:border-box;padding:0 2px;margin:0;border:1px solid #c83e2a;border-radius:2px;outline:2px solid rgba(200,62,42,.16);background:rgba(255,255,255,.96);color:#111;white-space:pre-wrap;overflow:hidden;font-family:Arial,sans-serif;font-size:${Math.max(8, br.height * .82)}px;line-height:1.05;cursor:text;`;
    canvas.appendChild(input);
    box.classList.add('pdftools-inline-selected');
    active = { input, data, box };

    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    input.addEventListener('input', () => {
      data.text = input.innerText.replace(/\u00a0/g, ' ');
      edits.set(data.id, data);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); close(true); }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (active?.input === input) close(true); }, 0));
  }

  document.addEventListener('click', event => {
    const editor = getEditor();
    if (!editor) return;
    const box = event.target.closest?.('.pdf-visual-editor div[title="Clique para editar este texto"]');
    if (!box) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startEdit(box);
  }, true);

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const options = args[1];

    if (url.includes('/api/inspect')) {
      const response = await originalFetch(...args);
      if (response.ok) {
        try {
          const data = await response.clone().json();
          pageSizes = data.pageSizes || [];
          currentPage = 1;
          edits.clear();
        } catch (_) {}
      }
      return response;
    }

    if (url.includes('/api/edit/annotate') && options?.body instanceof FormData) {
      close(true);
      const raw = options.body.get('annotations');
      if (raw) {
        try {
          const annotations = JSON.parse(raw);
          for (const data of edits.values()) {
            const idx = annotations.findIndex(a => String(a.id) === data.id);
            if (idx >= 0) annotations[idx] = { ...annotations[idx], ...data };
            else annotations.push({ ...data });
          }
          options.body.set('annotations', JSON.stringify(annotations));
        } catch (_) {}
      }
    }

    const response = await originalFetch(...args);
    if (url.includes('/api/edit/annotate') && response.ok) edits.clear();
    return response;
  };

  const style = document.createElement('style');
  style.textContent = `.pdftools-inline-selected{background:rgba(200,62,42,.08)!important;border-color:#c83e2a!important}.pdftools-inline-editor::selection{background:rgba(200,62,42,.25)}`;
  document.head.appendChild(style);
})();
