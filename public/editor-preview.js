// Prévia HQ do editor: rápida, sincronizada e com memória limitada.
// Mantém a resolução de 1600 px sem acumular observers, timers ou Blob URLs.
(() => {
  if (window.__pdfToolsEditorPreviewInitialized) return;
  window.__pdfToolsEditorPreviewInitialized = true;

  let fileId = null;
  let lastKey = '';
  let requestVersion = 0;
  const pageCache = new Map();
  const pending = new Map();
  const MAX_CACHED_PAGES = 3;
  const trackedResizeHandlers = new Set();

  // O app.js registra um listener de resize toda vez que o editor é aberto.
  // Registramos esses listeners para poder removê-los ao sair do editor.
  const originalAddEventListener = window.addEventListener.bind(window);
  const originalRemoveEventListener = window.removeEventListener.bind(window);
  window.addEventListener = function(type, listener, options) {
    if (type === 'resize' && typeof listener === 'function') trackedResizeHandlers.add(listener);
    return originalAddEventListener(type, listener, options);
  };
  window.removeEventListener = function(type, listener, options) {
    if (type === 'resize' && typeof listener === 'function') trackedResizeHandlers.delete(listener);
    return originalRemoveEventListener(type, listener, options);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/api/inspect') && response.ok) {
        const data = await response.clone().json();
        if (data?.fileId) resetForFile(data.fileId);
      }
    } catch (_) {}
    return response;
  };

  function revokeCache() {
    for (const entry of pageCache.values()) {
      try { URL.revokeObjectURL(entry.url); } catch (_) {}
    }
    pageCache.clear();
  }

  function resetForFile(nextFileId) {
    if (fileId === nextFileId) return;
    requestVersion++;
    revokeCache();
    pending.clear();
    fileId = nextFileId;
    lastKey = '';
  }

  function cleanupEditor() {
    requestVersion++;
    pending.clear();
    revokeCache();
    fileId = null;
    lastKey = '';

    for (const handler of trackedResizeHandlers) {
      try { originalRemoveEventListener('resize', handler); } catch (_) {}
    }
    trackedResizeHandlers.clear();
  }

  function getEditorImage() {
    return document.querySelector('.pdf-visual-editor img');
  }

  function currentPage() {
    const indicator = document.getElementById('pageIndicator');
    const match = indicator?.textContent?.match(/Página\s+(\d+)/i);
    return match ? Number(match[1]) : 1;
  }

  function requestRender() {
    window.dispatchEvent(new Event('resize'));
  }

  function touchCache(key, entry) {
    pageCache.delete(key);
    pageCache.set(key, entry);
  }

  function trimCache() {
    while (pageCache.size > MAX_CACHED_PAGES) {
      const oldestKey = pageCache.keys().next().value;
      const oldest = pageCache.get(oldestKey);
      pageCache.delete(oldestKey);
      try { URL.revokeObjectURL(oldest.url); } catch (_) {}
    }
  }

  async function getPreviewUrl(page) {
    const key = `${fileId}:${page}`;
    const cached = pageCache.get(key);
    if (cached) {
      touchCache(key, cached);
      return cached.url;
    }
    if (pending.has(key)) return pending.get(key);

    const promise = originalFetch(`/api/preview/${encodeURIComponent(fileId)}/${page}`, {
      cache: 'no-store'
    })
      .then(response => {
        if (!response.ok) throw new Error(`Prévia da página ${page} indisponível.`);
        return response.blob();
      })
      .then(blob => {
        if (!fileId || key !== `${fileId}:${page}`) throw new Error('Prévia descartada.');
        const url = URL.createObjectURL(blob);
        const entry = { url };
        pageCache.set(key, entry);
        trimCache();
        pending.delete(key);
        return url;
      })
      .catch(error => {
        pending.delete(key);
        throw error;
      });

    pending.set(key, promise);
    return promise;
  }

  function syncImage(img) {
    if (!fileId || !img) return;

    const page = currentPage();
    if (!Number.isInteger(page) || page < 1) return;

    const key = `${fileId}:${page}`;
    const version = ++requestVersion;
    const cached = pageCache.get(key);

    if (cached) {
      touchCache(key, cached);
      if (img.src !== cached.url) {
        img.dataset.hqPage = String(page);
        img.dataset.hqLoading = '0';
        img.onerror = null;
        img.src = cached.url;
      }
      requestAnimationFrame(requestRender);
      return;
    }

    const currentSrc = img.getAttribute('src') || '';
    if (currentSrc.startsWith('data:image/')) img.dataset.originalSrc = currentSrc;

    const fallback = img.dataset.originalSrc || '';
    img.dataset.hqPage = String(page);
    img.dataset.hqLoading = '1';

    getPreviewUrl(page)
      .then(url => {
        if (version !== requestVersion || currentPage() !== page || !document.contains(img)) return;
        img.dataset.hqLoading = '0';
        img.onerror = null;
        img.src = url;
        requestAnimationFrame(requestRender);
      })
      .catch(() => {
        if (version !== requestVersion || currentPage() !== page || !document.contains(img)) return;
        img.dataset.hqLoading = '0';
        if (fallback) {
          img.src = fallback;
          requestAnimationFrame(requestRender);
        }
      });
  }

  function scan() {
    const img = getEditorImage();
    if (!img) {
      if (fileId) cleanupEditor();
      return;
    }

    const page = currentPage();
    const src = img.getAttribute('src') || '';
    const key = `${fileId || ''}:${page}:${src}`;
    if (key === lastKey && img.dataset.hqLoading !== '1') return;
    lastKey = key;
    syncImage(img);
  }

  const workspace = document.getElementById('workspace') || document.body;
  const observer = new MutationObserver(scan);
  observer.observe(workspace, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });

  window.addEventListener('pdf-editor-cleanup', cleanupEditor);
  window.addEventListener('load', scan);
  scan();
})();
