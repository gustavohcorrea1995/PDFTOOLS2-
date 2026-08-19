// Mantém a prévia de alta resolução rigorosamente sincronizada com a página atual.
// Não altera as coordenadas do editor: apenas troca a imagem visual.
(() => {
  let fileId = null;
  let requestVersion = 0;

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

  function getEditorImage() {
    return document.querySelector('.pdf-visual-editor img');
  }

  function currentPage() {
    const indicator = document.getElementById('pageIndicator');
    const match = indicator?.textContent?.match(/Página\s+(\d+)/i);
    return match ? Number(match[1]) : 1;
  }

  function syncImage(img) {
    if (!fileId || !img) return;

    const page = currentPage();
    if (!Number.isInteger(page) || page < 1) return;

    const targetPage = String(page);
    const expectedUrl = `/api/preview/${encodeURIComponent(fileId)}/${page}`;

    // Já estamos mostrando exatamente a página correta em alta resolução.
    if (img.dataset.hqPage === targetPage && img.src.includes(expectedUrl)) return;

    // Cada troca de página invalida qualquer carregamento anterior.
    // Isso evita que a resposta lenta da página 1 sobrescreva a página 2.
    const version = ++requestVersion;
    const originalSrc = img.dataset.originalSrc ||
      (img.src.startsWith('data:image/') ? img.src : '');

    if (originalSrc) img.dataset.originalSrc = originalSrc;
    img.dataset.hqPage = targetPage;
    img.dataset.hqLoading = '1';

    const fallback = originalSrc;
    img.onerror = () => {
      if (version !== requestVersion) return;
      img.dataset.hqLoading = '0';
      img.onerror = null;
      if (fallback) img.src = fallback;
    };

    img.onload = () => {
      if (version !== requestVersion) return;
      img.dataset.hqLoading = '0';
      // A imagem agora corresponde à página atual; reposiciona a camada.
      requestAnimationFrame(() => {
        if (typeof window.renderTextLayer === 'function') window.renderTextLayer();
      });
    };

    img.src = expectedUrl;
  }

  function scan() {
    const img = getEditorImage();
    if (!img) return;
    syncImage(img);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });

  window.addEventListener('load', scan);
  setInterval(scan, 150);
})();
