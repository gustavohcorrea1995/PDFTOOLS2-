(() => {
  if (window.__pdfToolsSidebarV2) return;
  window.__pdfToolsSidebarV2 = true;

  const originalFetch = window.fetch.bind(window);
  let pageSizes = [];
  let currentPage = 1;
  let currentFileId = null;
  let newTexts = [];
  let undoStack = [];
  let redoStack = [];
  let mode = 'select';
  let sidebar = null;
  let newLayer = null;
  let imageObserver = null;

  const clone = value => JSON.parse(JSON.stringify(value));
  const snapshot = () => clone(newTexts);

  function getRoot() { return document.querySelector('#toolBody'); }
  function getEditor() { return document.querySelector('#toolBody .pdf-visual-editor'); }
  function getCanvas() { return getEditor()?.querySelector(':scope > div'); }
  function getImage() { return getCanvas()?.querySelector('img'); }

  function getPageNumber() {
    const el = document.getElementById('pageIndicator');
    const match = el?.textContent?.match(/Página\s+(\d+)/i);
    if (match) currentPage = Number(match[1]);
    return currentPage;
  }

  function pageSize(page) {
    return pageSizes[page - 1] || null;
  }

  function commit(before) {
    if (JSON.stringify(before) === JSON.stringify(newTexts)) return;
    undoStack.push(before);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateButtons();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    newTexts = undoStack.pop();
    renderNewLayer();
    updateButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    newTexts = redoStack.pop();
    renderNewLayer();
    updateButtons();
  }

  function screenToPdf(clientX, clientY) {
    const img = getImage();
    const size = pageSize(getPageNumber());
    if (!img || !size) return null;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const sx = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const sy = Math.max(0, Math.min(rect.height, clientY - rect.top));

    return {
      x: sx * size.width / rect.width,
      y: sy * size.height / rect.height
    };
  }

  function pdfToScreen(item) {
    const img = getImage();
    const size = pageSize(item.page);
    if (!img || !size) return null;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      left: item.x * rect.width / size.width,
      top: item.y * rect.height / size.height,
      width: Math.max(20, item.width * rect.width / size.width),
      height: Math.max(14, item.height * rect.height / size.height)
    };
  }

  function ensureLayer() {
    const canvas = getCanvas();
    if (!canvas) return null;

    if (!newLayer || !canvas.contains(newLayer)) {
      newLayer = document.createElement('div');
      newLayer.className = 'pdf-new-text-layer';
      newLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:8;';
      canvas.appendChild(newLayer);
    }

    return newLayer;
  }

  function renderNewLayer() {
    const layer = ensureLayer();
    if (!layer) return;

    layer.innerHTML = '';
    const page = getPageNumber();

    newTexts.filter(item => item.page === page && !item.deleted).forEach(item => {
      const p = pdfToScreen(item);
      if (!p) return;

      const box = document.createElement('div');
      box.dataset.newTextId = item.id;
      box.textContent = item.text || 'Novo texto';
      box.title = 'Texto adicionado — arraste para mover. Duplo clique para editar.';
      box.style.cssText = `position:absolute;left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px;box-sizing:border-box;pointer-events:auto;cursor:move;z-index:9;color:${item.color || '#111'};background:rgba(255,255,255,.82);border:1px dashed #c19665;border-radius:2px;font:${item.bold ? '700' : '400'} ${Math.max(4, item.fontSize)}px Arial,sans-serif;line-height:1.05;padding:1px 2px;white-space:pre-wrap;overflow:hidden;`;

      box.addEventListener('pointerdown', event => {
        event.stopPropagation();
        startMove(event, item.id);
      });

      box.addEventListener('dblclick', event => {
        event.stopPropagation();
        editNewText(item.id);
      });

      layer.appendChild(box);
    });
  }

  function startMove(event, id) {
    if (mode === 'text') {
      editNewText(id);
      return;
    }

    const item = newTexts.find(value => value.id === id);
    const img = getImage();
    const size = item ? pageSize(item.page) : null;
    if (!item || !img || !size) return;

    const rect = img.getBoundingClientRect();
    const before = snapshot();
    const startX = event.clientX;
    const startY = event.clientY;
    const originalX = item.x;
    const originalY = item.y;

    const move = e => {
      item.x = Math.max(0, Math.min(size.width - item.width,
        originalX + (e.clientX - startX) * size.width / rect.width));
      item.y = Math.max(0, Math.min(size.height - item.height,
        originalY + (e.clientY - startY) * size.height / rect.height));
      renderNewLayer();
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commit(before);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function addTextAt(clientX, clientY) {
    const page = getPageNumber();
    const point = screenToPdf(clientX, clientY);
    const size = pageSize(page);
    if (!point || !size) return;

    const before = snapshot();
    const item = {
      id: `pnew-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      page,
      x: point.x,
      y: point.y,
      width: Math.min(180, Math.max(60, size.width - point.x)),
      height: 18,
      fontSize: 12,
      text: 'Novo texto',
      color: '#111111',
      bold: false,
      deleted: false
    };

    newTexts.push(item);
    commit(before);
    mode = 'select';
    updateButtons();
    renderNewLayer();
    editNewText(item.id);
  }

  function editNewText(id) {
    const item = newTexts.find(value => value.id === id);
    if (!item) return;

    document.querySelectorAll('.pdf-new-text-panel').forEach(panel => panel.remove());

    const panel = document.createElement('div');
    panel.className = 'pdf-new-text-panel';
    panel.style.cssText = 'position:fixed;z-index:20000;right:24px;top:110px;width:310px;padding:12px;background:#fff;color:#111;border:2px solid #c19665;border-radius:7px;box-shadow:0 10px 30px rgba(0,0,0,.35);font:14px Arial,sans-serif;';

    const title = document.createElement('strong');
    title.textContent = 'Adicionar / editar texto';
    panel.appendChild(title);

    const textarea = document.createElement('textarea');
    textarea.value = item.text;
    textarea.style.cssText = 'display:block;width:100%;min-height:80px;margin-top:8px;box-sizing:border-box;padding:7px;';
    panel.appendChild(textarea);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap;';

    const fontSize = document.createElement('input');
    fontSize.type = 'number';
    fontSize.min = '4';
    fontSize.max = '96';
    fontSize.value = Math.round(item.fontSize);
    fontSize.title = 'Tamanho da fonte';
    fontSize.style.width = '70px';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = item.color || '#111111';
    color.title = 'Cor do texto';

    const bold = document.createElement('button');
    bold.type = 'button';
    bold.textContent = 'B';
    bold.style.cssText = 'padding:5px 9px;font-weight:700;';

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Salvar';
    save.style.cssText = 'padding:6px 12px;background:#c19665;color:#2a0d12;border:0;border-radius:4px;font-weight:700;';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Excluir';
    remove.style.cssText = 'padding:6px 12px;background:#8b1e1e;color:#fff;border:0;border-radius:4px;font-weight:700;';

    row.append(fontSize, color, bold, save, remove);
    panel.appendChild(row);
    document.body.appendChild(panel);

    const before = snapshot();

    bold.onclick = () => {
      item.bold = !item.bold;
      renderNewLayer();
    };

    save.onclick = () => {
      item.text = textarea.value;
      item.fontSize = Math.max(4, Number(fontSize.value) || 12);
      item.color = color.value;
      panel.remove();
      commit(before);
      renderNewLayer();
    };

    remove.onclick = () => {
      const index = newTexts.findIndex(value => value.id === id);
      if (index >= 0) newTexts.splice(index, 1);
      panel.remove();
      commit(before);
      renderNewLayer();
    };

    textarea.addEventListener('keydown', event => {
      if (event.key === 'Escape') panel.remove();
      if (event.key === 'Enter' && event.ctrlKey) save.click();
    });

    textarea.focus();
    textarea.select();
  }

  function updateButtons() {
    if (!sidebar) return;
    sidebar.querySelectorAll('[data-tool]').forEach(button => {
      button.classList.toggle('active', button.dataset.tool === mode);
    });
    const undoButton = sidebar.querySelector('[data-action="undo"]');
    const redoButton = sidebar.querySelector('[data-action="redo"]');
    if (undoButton) undoButton.disabled = !undoStack.length;
    if (redoButton) redoButton.disabled = !redoStack.length;
  }

  function createSidebar(root) {
    if (sidebar && document.contains(sidebar)) return;

    sidebar = document.createElement('div');
    sidebar.className = 'pdf-editor-sidebar';
    sidebar.innerHTML = `
      <button type="button" data-tool="select" class="active" title="Selecionar">↖<span>Selecionar</span></button>
      <button type="button" data-tool="text" title="Adicionar texto">T<span>Texto</span></button>
      <div class="sep"></div>
      <button type="button" data-action="undo" title="Desfazer">↶<span>Desfazer</span></button>
      <button type="button" data-action="redo" title="Refazer">↷<span>Refazer</span></button>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .pdf-editor-sidebar{position:fixed;left:14px;top:190px;width:74px;z-index:15000;display:flex;flex-direction:column;gap:5px;padding:7px;background:#1b222b;border:1px solid #3d4856;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
      .pdf-editor-sidebar button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:52px;padding:5px 3px;border:1px solid #4b5968;background:#27313d;color:#fff;border-radius:5px;cursor:pointer;font-weight:700;font-size:18px}
      .pdf-editor-sidebar button span{font-size:10px;font-weight:600}.pdf-editor-sidebar button:hover{background:#33404f}.pdf-editor-sidebar button.active{background:#c19665;border-color:#e06b51}.pdf-editor-sidebar button:disabled{opacity:.4;cursor:not-allowed}.pdf-editor-sidebar .sep{height:1px;background:#566170;margin:2px 0}
      @media(max-width:900px){.pdf-editor-sidebar{position:sticky;left:auto;top:8px;width:auto;flex-direction:row;margin:8px 0;align-items:stretch}.pdf-editor-sidebar button{min-width:70px}}
    `;

    root.style.position = 'relative';
    root.appendChild(sidebar);
    root.appendChild(style);

    sidebar.querySelectorAll('[data-tool]').forEach(button => {
      button.onclick = () => {
        mode = button.dataset.tool;
        updateButtons();
      };
    });

    sidebar.querySelector('[data-action="undo"]').onclick = undo;
    sidebar.querySelector('[data-action="redo"]').onclick = redo;
    updateButtons();
  }

  function attachCanvasEvents() {
    const img = getImage();
    if (!img) return;

    if (img.dataset.pdfToolsNewTextBound !== '1') {
      img.dataset.pdfToolsNewTextBound = '1';
      img.addEventListener('click', event => {
        if (mode !== 'text') return;
        event.stopPropagation();
        addTextAt(event.clientX, event.clientY);
      });
    }

    if (imageObserver) imageObserver.disconnect();
    imageObserver = new MutationObserver(() => {
      currentPage = getPageNumber();
      requestAnimationFrame(renderNewLayer);
    });
    imageObserver.observe(img, { attributes:true, attributeFilter:['src'] });

    renderNewLayer();
  }

  function setupForAnnotate(root) {
    createSidebar(root);
    attachCanvasEvents();
  }

  window.addEventListener('resize', () => {
    if (document.querySelector('.pdf-visual-editor')) {
      requestAnimationFrame(renderNewLayer);
    }
  });

  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (url.includes('/api/edit/annotate') && args[1]?.body instanceof FormData && newTexts.length) {
      try {
        const body = args[1].body;
        const raw = body.get('annotations');
        if (raw) {
          const existing = JSON.parse(raw);
          body.set('annotations', JSON.stringify(existing.concat(clone(newTexts))));
        }
      } catch (error) {
        console.warn('PDFTools: não foi possível anexar os novos textos.', error);
      }
    }

    const response = await originalFetch(...args);

    if (url.includes('/api/inspect') && response.ok) {
      try {
        const data = await response.clone().json();
        currentFileId = data.fileId || null;
        pageSizes = data.pageSizes || [];
        currentPage = 1;
        newTexts = [];
        undoStack = [];
        redoStack = [];

        setTimeout(() => {
          const root = getRoot();
          if (root && document.querySelector('.pdf-visual-editor')) {
            setupForAnnotate(root);
          }
        }, 0);
      } catch (error) {
        console.warn('PDFTools editor tools:', error);
      }
    }

    return response;
  };
})();
