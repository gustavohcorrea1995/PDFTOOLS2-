// Mantém a prévia de alta resolução sincronizada com a página atual.
(() => {
  let fileId = null;

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
    if (!fileId || !img) return;

    const src = img.getAttribute('src') || '';
    const page = currentPage();
    if (!Number.isInteger(page) || page < 1) return;

    // O mesmo elemento <img> é reutilizado quando o usuário troca de página.
    // A prévia HQ precisa acompanhar essa mudança.
    if (img.dataset.hqPage === String(page) && src.includes('/api/preview/')) return;
    if (img.dataset.loadingHq === '1') return;

    const originalSrc = src.startsWith('data:image/') ? src : img.dataset.originalSrc;
    if (!originalSrc && !src.includes('/api/preview/')) return;

    img.dataset.loadingHq = '1';
    img.dataset.hqPage = String(page);
    if (originalSrc) img.dataset.originalSrc = originalSrc;

    const hqUrl = `/api/preview/${encodeURIComponent(fileId)}/${page}`;

    img.onerror = () => {
      img.dataset.loadingHq = '0';
      img.onerror = null;
      if (img.dataset.originalSrc) img.src = img.dataset.originalSrc;
    };

    img.onload = () => {
      img.dataset.loadingHq = '0';
    };

    img.src = hqUrl;
  }

  function scan() {
    document.querySelectorAll('.pdf-visual-editor img').forEach(upgrade);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });

  window.addEventListener('load', scan);
  setInterval(scan, 300);
})();
