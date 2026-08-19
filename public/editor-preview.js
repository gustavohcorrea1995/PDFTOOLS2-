// Prévia HQ do editor sincronizada com a página atual.
// Não altera o sistema de coordenadas; apenas troca a imagem visual.
(() => {
  let fileId = null;
  let requestVersion = 0;

  const originalFetch = window.fetch.bind(window.fetch);
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

  function requestRender() {
    // app.js mantém renderTextLayer dentro de um closure. O listener de
    // resize já existente é a forma segura de pedir uma nova camada sem
    // expor nem alterar a implementação do editor.
    window.dispatchEvent(new Event('resize'));
  }

  function syncImage(img) {
    if (!fileId || !img) return;

    const page = currentPage();
    if (!Number.isInteger(page) || page < 1) return;

    const targetPage = String(page);
    const expectedUrl = `/api/preview/${encodeURIComponent(fileId)}/${page}`;

    if (img.dataset.hqPage === targetPage && img.src.includes(expectedUrl)) return;

    const version = ++requestVersion;

    // Quando app.js acabou de trocar de página, o src atual é a data URL
    // daquela página. Atualizamos o fallback para NÃO guardar a página 1.
    const currentSrc = img.getAttribute('src') || '';
    if (currentSrc.startsWith('data:image/')) {
      img.dataset.originalSrc = currentSrc;
    }

    const fallback = img.dataset.originalSrc || '';
    img.dataset.hqPage = targetPage;
    img.dataset.hqLoading = '1';

    img.onerror = () => {
      if (version !== requestVersion) return;
      img.dataset.hqLoading = '0';
      img.onerror = null;
      if (fallback) {
        img.src = fallback;
        requestAnimationFrame(requestRender);
      }
    };

    img.onload = () => {
      if (version !== requestVersion) return;
      // Ignora respostas antigas: só a solicitação da página atualmente
      // selecionada pode atualizar a camada visual.
      if (currentPage() !== page) return;
      img.dataset.hqLoading = '0';
      requestAnimationFrame(requestRender);
    };

    img.src = expectedUrl;
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
