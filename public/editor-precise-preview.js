(() => {
  if (window.__pdfToolsPrecisePreview) return;
  window.__pdfToolsPrecisePreview = true;

  let canvas = null;
  let ctx = null;
  let lastSrc = '';
  let queued = false;

  function getEditor() { return document.querySelector('.pdf-visual-editor'); }
  function getImage() { return getEditor()?.querySelector('img'); }

  function prepare(img) {
    if (!img || !img.complete || !img.naturalWidth) return false;
    const src = img.currentSrc || img.src || '';
    if (src !== lastSrc) {
      canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(img, 0, 0);
      lastSrc = src;
    }
    return !!ctx;
  }

  function median(values) {
    if (!values.length) return 255;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  }

  function estimateBackground(data, width, height) {
    const r = [], g = [], b = [];
    const stepX = Math.max(1, Math.floor(width / 8));
    const stepY = Math.max(1, Math.floor(height / 6));
    for (let x = 0; x < width; x += stepX) {
      for (const y of [0, Math.max(0, height - 1)]) {
        const i = (y * width + x) * 4;
        r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]);
      }
    }
    for (let y = 0; y < height; y += stepY) {
      for (const x of [0, Math.max(0, width - 1)]) {
        const i = (y * width + x) * 4;
        r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]);
      }
    }
    return [median(r), median(g), median(b)];
  }

  function distance(a, bg) {
    const dr = a[0] - bg[0], dg = a[1] - bg[1], db = a[2] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  // Mede os pixels realmente desenhados pelo texto dentro da caixa original.
  function glyphBounds(img, box) {
    if (!prepare(img)) return null;
    const ir = img.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    if (!ir.width || !ir.height || !br.width || !br.height) return null;

    const nx = Math.max(0, Math.floor((br.left - ir.left) * img.naturalWidth / ir.width));
    const ny = Math.max(0, Math.floor((br.top - ir.top) * img.naturalHeight / ir.height));
    const nw = Math.min(img.naturalWidth - nx, Math.ceil(br.width * img.naturalWidth / ir.width));
    const nh = Math.min(img.naturalHeight - ny, Math.ceil(br.height * img.naturalHeight / ir.height));
    if (nw < 2 || nh < 2) return null;

    const data = ctx.getImageData(nx, ny, nw, nh).data;
    const bg = estimateBackground(data, nw, nh);
    let minX = nw, minY = nh, maxX = -1, maxY = -1;

    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const i = (y * nw + x) * 4;
        if (data[i + 3] < 20) continue;
        if (distance([data[i], data[i + 1], data[i + 2]], bg) < 24) continue;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) return null;
    const pad = 1.5;
    return {
      sourceWidth: nw,
      sourceHeight: nh,
      x: Math.max(0, minX - pad),
      y: Math.max(0, minY - pad),
      width: Math.min(nw, maxX - minX + 1 + pad * 2),
      height: Math.min(nh, maxY - minY + 1 + pad * 2)
    };
  }

  function findPair(mask) {
    const box = mask.nextElementSibling;
    if (!box || !box.matches('div')) return null;
    const style = getComputedStyle(box);
    return style.position === 'absolute' && style.pointerEvents === 'auto' ? box : null;
  }

  function refineMask(mask, box, img) {
    const target = box || mask;
    const glyph = glyphBounds(img, target);
    if (!glyph) return;

    const ir = img.getBoundingClientRect();
    const sx = ir.width / img.naturalWidth;
    const sy = ir.height / img.naturalHeight;
    const tr = target.getBoundingClientRect();
    const gx = glyph.x * tr.width / glyph.sourceWidth;
    const gy = glyph.y * tr.height / glyph.sourceHeight;
    const gw = glyph.width * tr.width / glyph.sourceWidth;
    const gh = glyph.height * tr.height / glyph.sourceHeight;

    mask.style.left = `${tr.left - ir.left + gx}px`;
    mask.style.top = `${tr.top - ir.top + gy}px`;
    mask.style.width = `${Math.max(2, gw)}px`;
    mask.style.height = `${Math.max(2, gh)}px`;
    mask.dataset.preciseMask = '1';
  }

  function getMasks(editor) {
    return Array.from(editor.querySelectorAll('div')).filter(el => {
      const s = getComputedStyle(el);
      return s.position === 'absolute' &&
        s.pointerEvents === 'none' &&
        s.backgroundColor === 'rgb(255, 255, 255)';
    });
  }

  function scan() {
    queued = false;
    const editor = getEditor();
    const img = getImage();
    if (!editor || !img || !img.complete) return;
    getMasks(editor).forEach(mask => refineMask(mask, findPair(mask), img));
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  function installFetchHook() {
    if (window.__pdfToolsPrecisePreviewFetch) return;
    window.__pdfToolsPrecisePreviewFetch = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const options = args[1];

      if (url.includes('/api/edit/annotate') && options?.body instanceof FormData) {
        try {
          const raw = options.body.get('annotations');
          if (raw) {
            const annotations = JSON.parse(raw);
            const editor = getEditor();
            const img = getImage();
            if (editor && img) {
              scan();
              const masks = getMasks(editor);

              annotations.forEach(a => {
                if (!a || !String(a.id || '').startsWith('p')) return;
                const x = Number(a.pdfX ?? a.x), y = Number(a.pdfY ?? a.y);
                const w = Number(a.pdfWidth ?? a.width), h = Number(a.pdfHeight ?? a.height);
                if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return;

                let best = null;
                let bestScore = Infinity;
                masks.forEach(mask => {
                  const target = findPair(mask) || mask;
                  const tr = target.getBoundingClientRect();
                  const scaleX = tr.width / w;
                  const scaleY = tr.height / h;
                  if (!scaleX || !scaleY) return;

                  // Antes da máscara ser refinada, a caixa está exatamente em x/y.
                  // Depois de refinada, usamos o tamanho da caixa original do objeto.
                  const ir = img.getBoundingClientRect();
                  const expectedLeft = (x * scaleX) + ir.left;
                  const expectedTop = (y * scaleY) + ir.top;
                  const score = Math.abs(tr.left - expectedLeft) + Math.abs(tr.top - expectedTop);
                  if (score < bestScore) {
                    bestScore = score;
                    best = { mask, target, scaleX, scaleY };
                  }
                });

                if (!best || bestScore > 30) return;
                const glyph = glyphBounds(img, best.target);
                if (!glyph) return;

                const localX = glyph.x * best.target.getBoundingClientRect().width / glyph.sourceWidth;
                const localY = glyph.y * best.target.getBoundingClientRect().height / glyph.sourceHeight;
                const localW = glyph.width * best.target.getBoundingClientRect().width / glyph.sourceWidth;
                const localH = glyph.height * best.target.getBoundingClientRect().height / glyph.sourceHeight;

                a.redactPdfX = x + localX / best.scaleX;
                a.redactPdfY = y + localY / best.scaleY;
                a.redactPdfWidth = localW / best.scaleX;
                a.redactPdfHeight = localH / best.scaleY;
              });

              options.body.set('annotations', JSON.stringify(annotations));
            }
          }
        } catch (error) {
          console.warn('PDFTools: não foi possível calcular a máscara precisa.', error);
        }
      }

      return originalFetch(...args);
    };
  }

  const observer = new MutationObserver(queue);
  const start = () => {
    const workspace = document.getElementById('workspace') || document.body;
    observer.observe(workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'src'] });
    installFetchHook();
    queue();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
