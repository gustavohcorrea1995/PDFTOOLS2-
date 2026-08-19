// Prévia HQ do editor sincronizada com a página atual.
// Não altera o sistema de coordenadas; apenas troca a imagem visual.
(() => {
  let fileId = null;
  let requestVersion = 0;
  const pageCache = new Map();
  const pending = new Map();

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/api/inspect') && response.ok) {
        const data = await response.clone().json();
        if (data?.fileId) {
          fileId = data.fileId;
          pageCache.clear();
          pending.clear();
        }
      }
    } catch (_) {}
    return response;
  };

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

  async function getPreviewUrl(page) {
    const key = `${fileId}:${page}`;
    if (pageCache.has(key)) return pageCache.get(key);
    if (pending.has(key)) return pending.get(key);

    const promise = fetch(`/api/preview/${encodeURIComponent(fileId)}/${page}`, {
      cache: 'force-cache'
    })
      .then(response => {
        if (!response.ok) throw new Error(`Prévia da página ${page} indisponível.`);
        return response.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        pageCache.set(key, url);
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

    const targetPage = String(page);
    const key = `${fileId}:${page}`;
    const cachedUrl = pageCache.get(key);
    const version = ++requestVersion;

    if (cachedUrl) {
      img.dataset.hqPage = targetPage;
      img.dataset.hqLoading = '0';
      img.onerror = null;
      if (img.src !== cachedUrl) img.src = cachedUrl;
      requestAnimationFrame(requestRender);
      return;
    }

    const currentSrc = img.getAttribute('src') || '';
    if (currentSrc.startsWith('data:image/')) {
      img.dataset.originalSrc = currentSrc;
    }

    const fallback = img.dataset.originalSrc || '';
    img.dataset.hqPage = targetPage;
    img.dataset.hqLoading = '1';

    getPreviewUrl(page)
      .then(url => {
        if (version !== requestVersion || currentPage() !== page) return;
        img.dataset.hqLoading = '0';
        img.onerror = null;
        img.src = url;
        requestAnimationFrame(requestRender);
      })
      .catch(() => {
        if (version !== requestVersion || currentPage() !== page) return;
        img.dataset.hqLoading = '0';
        if (fallback) {
          img.src = fallback;
          requestAnimationFrame(requestRender);
        }
      });
  }

  function scan() {
    const img = getEditorImage();
    if (img) syncImage(img);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });

  window.addEventListener('load', scan);
  setInterval(scan, 200);
})();
