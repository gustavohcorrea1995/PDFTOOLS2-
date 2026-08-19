// Troca apenas a imagem visual do editor pela prévia de alta resolução.
// A camada de coordenadas continua usando o mesmo sistema de 1600px.
(() => {
  let fileId = null;
  let lastPage = 0;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/api/inspect') && response.ok) {
        const data = await response.clone().json();
        if (data?.fileId) fileId = data.fileId;
      }
    } catch (_) {}
    return response;
  };

  function currentPage() {
    const indicator = document.getElementById('pageIndicator');
    const match = indicator?.textContent?.match(/Página\s+(\d+)/i);
    return match ? Number(match[1]) : 1;
  }

  function upgrade(img) {
    if (!fileId || !img || img.dataset.hq === '1') return;
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:image/')) return;

    const page = currentPage();
    if (!Number.isInteger(page) || page < 1) return;

    img.dataset.hq = '1';
    img.dataset.originalSrc = src;
    img.dataset.hqPage = String(page);
    img.src = `/api/preview/${encodeURIComponent(fileId)}/${page}`;

    img.onerror = () => {
      if (img.dataset.originalSrc) {
        img.onerror = null;
        img.src = img.dataset.originalSrc;
      }
    };
  }

  function scan() {
    document.querySelectorAll('.pdf-visual-editor img').forEach(upgrade);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  window.addEventListener('load', scan);
  setInterval(scan, 500);
})();
