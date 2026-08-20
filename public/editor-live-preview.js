(() => {
  if (window.__pdfToolsLiveTextPreview) return;
  window.__pdfToolsLiveTextPreview = true;

  let activeBox = null;
  let originalText = '';
  let status = null;
  let statusTimer = null;

  function isEditorBox(el) {
    if (!el || !el.closest('.pdf-visual-editor')) return false;
    if (el.closest('.pdf-new-text-layer')) return false;
    if (el.matches('img,button,input,textarea,select')) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.position === 'absolute' && rect.width > 4 && rect.height > 4 && (el.textContent || '').trim().length > 0;
  }

  function findBox(target) {
    let el = target;
    for (let i = 0; el && i < 6; i++, el = el.parentElement) {
      if (isEditorBox(el)) return el;
    }
    return null;
  }

  function ensureStatus() {
    if (status && document.contains(status)) return status;
    const top = document.querySelector('.pdftools-editor-status');
    if (!top) return null;
    status = document.createElement('span');
    status.className = 'pdftools-live-save-status';
    status.style.cssText = 'font-size:12px;font-weight:700;margin-left:8px;';
    top.appendChild(status);
    return status;
  }

  function markDirty() {
    const el = ensureStatus();
    if (!el) return;
    el.textContent = '🟠 Alterações não salvas';
    el.style.color = '#e6a23c';
    clearTimeout(statusTimer);
  }

  function markSaved() {
    const el = ensureStatus();
    if (!el) return;
    el.textContent = '🟢 Todas as alterações foram salvas';
    el.style.color = '#52b788';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (el) el.textContent = 'Editor pronto';
    }, 3500);
  }

  function restoreOriginal() {
    if (activeBox) activeBox.textContent = originalText;
    activeBox = null;
    originalText = '';
  }

  function bindEditorBoxSelection() {
    const editor = document.querySelector('.pdf-visual-editor');
    if (!editor || editor.dataset.livePreviewBound === '1') return;
    editor.dataset.livePreviewBound = '1';

    editor.addEventListener('pointerdown', event => {
      const box = findBox(event.target);
      if (!box) return;
      activeBox = box;
      originalText = box.textContent;
    }, true);
  }

  function bindTextEditor() {
    const editor = document.querySelector('.pdf-visual-editor');
    if (!editor) return;

    bindEditorBoxSelection();

    const fields = document.querySelectorAll('textarea, input[type="text"]');
    fields.forEach(field => {
      if (field.dataset.livePreviewBound === '1') return;
      field.dataset.livePreviewBound = '1';
      if (!activeBox) return;

      field.addEventListener('input', () => {
        if (!activeBox || !document.contains(activeBox)) return;
        activeBox.textContent = field.value;
        markDirty();
      });

      field.addEventListener('keydown', event => {
        if (event.key === 'Escape') restoreOriginal();
      });
    });
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const response = await originalFetch(...args);

    if (url.includes('/api/edit/annotate') || url.includes('/api/edit')) {
      if (response.ok) {
        activeBox = null;
        originalText = '';
        markSaved();
      }
    }
    return response;
  };

  const observer = new MutationObserver(() => {
    bindTextEditor();
  });

  const start = () => {
    const workspace = document.getElementById('workspace') || document.body;
    observer.observe(workspace, { childList: true, subtree: true });
    bindTextEditor();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
