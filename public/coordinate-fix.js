// Corrige a camada visual do editor para usar as dimensões reais de cada página.
// O Poppler fornece as coordenadas do texto em pontos PDF; a prévia é rasterizada
// mantendo a proporção da página. A escala precisa, portanto, ser calculada por
// página, e não assumida como 1100/612 para todos os documentos.
(() => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (!url || !url.includes('/api/inspect') || !response.ok) return response;

      const data = await response.clone().json();
      if (!Array.isArray(data.textBoxes) || !Array.isArray(data.pageSizes)) return response;

      // O /api/inspect mantém pdfX/pdfY em pontos PDF. Recalculamos apenas
      // as coordenadas usadas pela camada visual para a largura de 1100px
      // usada nas miniaturas/prévias atuais.
      const previewWidth = 1100;

      data.textBoxes = data.textBoxes.map(box => {
        const page = data.pageSizes[Number(box.page) - 1];
        if (!page || !Number.isFinite(page.width) || !Number.isFinite(page.height)) return box;

        const scale = previewWidth / page.width;
        return {
          ...box,
          x: Number(box.pdfX) * scale,
          y: Number(box.pdfY) * scale,
          width: Number(box.pdfWidth) * scale,
          height: Number(box.pdfHeight) * scale,
          fontSize: Math.max(6, Number(box.pdfHeight) * scale)
        };
      });

      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json');
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (_) {
      return response;
    }
  };
})();
