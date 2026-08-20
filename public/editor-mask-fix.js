(() => {
  if (window.__pdfToolsGlyphMask) return;
  window.__pdfToolsGlyphMask = true;

  // A máscara deve esconder somente os pixels realmente desenhados pelo
  // texto original. A caixa do Poppler pode conter espaço extra; por isso
  // medimos os glifos diretamente na imagem da prévia.
  const cache = new Map();
  let canvas = null;
  let ctx = null;
  let lastSrc = '';
  let queued = false;

  function prepare(img) {
    if (!img || !img.complete || !img.naturalWidth) return false;
    const src = img.currentSrc || img.src || '';
    if (src !== lastSrc || !canvas) {
      canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(img, 0, 0);
      lastSrc = src;
      cache.clear();
    }
    return true;
  }

  function dist(a, b) {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function background(data, width, height) {
    const samples = [];
    const push = (x, y) => {
      const i = (y * width + x) * 4;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    };
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 12))) {
      push(x, 0);
      push(x, Math.max(0, height - 1));
    }
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 8))) {
      push(0, y);
      push(Math.max(0, width - 1), y);
    }
    if (!samples.length) return [255, 255, 255];
    const median = n => {
      const v = samples.map(s => s[n]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    return [median(0), median(1), median(2)];
  }

  function glyphBounds(img, box) {
    if (!prepare(img)) return null;
    const ir = img.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    if (!ir.width || !ir.height) return null;

    const nx = Math.max(0, Math.floor((br.left - ir.left) * img.naturalWidth / ir.width));
    const ny = Math.max(0, Math.floor((br.top - ir.top) * img.naturalHeight / ir.height));
    const nw = Math.min(img.naturalWidth - nx, Math.ceil(br.width * img.naturalWidth / ir.width));
    const nh = Math.min(img.naturalHeight - ny, Math.ceil(br.height * img.naturalHeight / ir.height));
    if (nw < 2 || nh < 2) return null;

    const key = `${nx}|${ny}|${nw}|${nh}|${lastSrc}`;
    if (cache.has(key)) return cache.get(key);

    const data = ctx.getImageData(nx, ny, nw, nh).data;
    const bg = background(data, nw, nh);
    let minX = nw, minY = nh, maxX = -1, maxY = -1;

    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const i = (y * nw + x) * 4;
        if (data[i + 3] < 20) continue;
        if (dist([data[i], data[i + 1], data[i + 2]], bg) < 22) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) {
      const fallback = { x: nx, y: ny, width: nw, height: nh, boxX: nx, boxY: ny };
      cache.set(key, fallback);
      return fallback;
    }

    const pad = 2;
    const x = Math.max(0, nx + minX - pad);
    const y = Math.max(0, ny + minY - pad);
    const result = {
      x,
      y,
      width: Math.min(img.naturalWidth - x, maxX - minX + 1 + pad * 2),
      height: Math.min(img.naturalHeight - y, maxY - minY + 1 + pad * 2),
      boxX: nx,
      boxY: ny
    };
    cache.set(key, result);
    return result;
  }

  function currentPage() {
    return Number(document.getElementById('pageIndicator')?.textContent?.match(/Página\s+(\d+)/i)?.[1] || 1);
  }

  function textBoxes(editor) {
    return Array.from(editor.querySelectorAll('div')).filter(el => {
      const s = getComputedStyle(el);
      return s.position === 'absolute' && s.pointerEvents === 'auto' &&
        (el.textContent || '').trim() && !el.classList.contains('pdf-text-editor') &&
        !el.closest('.pdf-new-text-layer');
    });
  }

  function scan() {
    queued = false;
    const editor = document.querySelector('.pdf-visual-editor');
    const img = editor?.querySelector('img');
    if (!editor || !img || !img.complete || !img.naturalWidth) return;

    const boxes = textBoxes(editor);
    const masks = Array.from(editor.querySelectorAll('div')).filter(el =>
      getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)' &&
      getComputedStyle(el).pointerEvents === 'none'
    );

    masks.forEach(mask => {
      const box = mask.nextElementSibling;
      if (!box || !boxes.includes(box)) return;
      const glyph = glyphBounds(img, box);
      if (!glyph) return;
      const ir = img.getBoundingClientRect();
      mask.style.left = `${glyph.x * ir.width / img.naturalWidth}px`;
      mask.style.top = `${glyph.y * ir.height / img.naturalHeight}px`;
      mask.style.width = `${Math.max(2, glyph.width * ir.width / img.naturalWidth)}px`;
      mask.style.height = `${Math.max(2, glyph.height * ir.height / img.naturalHeight)}px`;
      mask.dataset.glyphMask = '1';
    });
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  const observer = new MutationObserver(queue);

  // Ao salvar, mantém pdfX/pdfY/pdfWidth/pdfHeight como coordenadas do
  // objeto. Apenas a área usada para apagar o texto antigo é refinada.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const options = args[1];

    if (url.includes('/api/edit/annotate') && options?.body instanceof FormData) {
      try {
        const raw = options.body.get('annotations');
        const editor = document.querySelector('.pdf-visual-editor');
        const img = editor?.querySelector('img');
        if (raw && editor && img) {
          const annotations = JSON.parse(raw);
          const boxes = textBoxes(editor);
          const ir = img.getBoundingClientRect();
          const page = currentPage();

          boxes.forEach(box => {
            const glyph = glyphBounds(img, box);
            if (!glyph) return;

            const left = parseFloat(box.style.left || '0');
            const top = parseFloat(box.style.top || '0');
            const width = parseFloat(box.style.width || '0');
            const height = parseFloat(box.style.height || '0');
            const a = annotations.find(item => {
              if (Number(item.page) !== page) return false;
              const ax = Number(item.pdfX ?? item.x);
              const ay = Number(item.pdfY ?? item.y);
              const sx = left / ir.width;
              const sy = top / ir.height;
              const guessedX = sx * (Number(item.pdfWidth ?? item.width) * img.naturalWidth / Math.max(1, width));
              const guessedY = sy * (Number(item.pdfHeight ?? item.height) * img.naturalHeight / Math.max(1, height));
              return Number.isFinite(ax) && Number.isFinite(ay) &&
                Math.abs(ax - guessedX) < 10 && Math.abs(ay - guessedY) < 15;
            });
            if (!a) return;

            const originalW = Number(a.pdfWidth ?? a.width) || 1;
            const originalH = Number(a.pdfHeight ?? a.height) || 1;
            const boxNaturalW = Math.max(1, width * img.naturalWidth / ir.width);
            const boxNaturalH = Math.max(1, height * img.naturalHeight / ir.height);
            const ptPerPxX = originalW / boxNaturalW;
            const ptPerPxY = originalH / boxNaturalH;
            const ax = Number(a.pdfX ?? a.x);
            const ay = Number(a.pdfY ?? a.y);

            a.redactPdfX = ax + (glyph.x - glyph.boxX) * ptPerPxX;
            a.redactPdfY = ay + (glyph.y - glyph.boxY) * ptPerPxY;
            a.redactPdfWidth = glyph.width * ptPerPxX;
            a.redactPdfHeight = glyph.height * ptPerPxY;
          });

          options.body.set('annotations', JSON.stringify(annotations));
        }
      } catch (error) {
        console.warn('PDFTools: não foi possível refinar a área de redação.', error);
      }
    }

    return originalFetch(...args);
  };

  function start() {
    const workspace = document.getElementById('workspace') || document.body;
    observer.observe(workspace, { childList: true, subtree: true });
    window.addEventListener('resize', queue, { passive: true });
    document.addEventListener('load', queue, true);
    queue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
