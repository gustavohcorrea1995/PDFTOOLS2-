// Mantém as coordenadas da camada de texto alinhadas com as prévias
// de alta resolução usadas pelo editor (/api/preview com -scale-to 1600).
(() => {
  const originalFetch = window.fetch.bind(window);
  const maxPreviewDimension = 1600;

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (!url || !url.includes('/api/inspect') || !response.ok) return response;

      const data = await response.clone().json();
      if (!Array.isArray(data.textBoxes) || !Array.isArray(data.pageSizes)) return response;

      data.textBoxes = data.textBoxes.map(box => {
        const page = data.pageSizes[Number(box.page) - 1];
        if (!page || !Number.isFinite(page.width) || !Number.isFinite(page.height)) return box;

        // O mesmo critério do pdftocairo -scale-to: a maior dimensão da
        // página é limitada a 1600px. Isso funciona para retrato, paisagem
        // e páginas com dimensões personalizadas.
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
