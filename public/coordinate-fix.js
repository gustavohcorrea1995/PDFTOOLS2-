// Corrige a camada visual do editor para usar exatamente a mesma escala
// utilizada pelo pdftocairo no /api/inspect.
(() => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (!url || !url.includes('/api/inspect') || !response.ok) return response;

      const data = await response.clone().json();
      if (!Array.isArray(data.textBoxes) || !Array.isArray(data.pageSizes)) return response;

      // O servidor usa pdftocairo com -scale-to 1100.
      // IMPORTANTE: -scale-to limita a MAIOR dimensão da página a 1100px.
      // Portanto, em A4 retrato, por exemplo, a altura fica em 1100px e a
      // largura fica proporcionalmente menor (~778px). Usar 1100/page.width
      // deslocava todas as caixas horizontalmente.
      const maxPreviewDimension = 1100;

      data.textBoxes = data.textBoxes.map(box => {
        const page = data.pageSizes[Number(box.page) - 1];
        if (!page || !Number.isFinite(page.width) || !Number.isFinite(page.height)) return box;

        const scale = maxPreviewDimension / Math.max(page.width, page.height);

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
