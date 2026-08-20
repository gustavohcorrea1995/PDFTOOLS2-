(() => {
  if (window.__pdfToolsEditorMaskFix) return;
  window.__pdfToolsEditorMaskFix = true;

  // O editor precisa mascarar o texto antigo porque a prévia é uma imagem.
  // A implementação original usava toda a caixa PDF, criando uma faixa
  // branca muito maior que o texto. Aqui guardamos o texto original e
  // reduzimos a máscara ao tamanho real aproximado dos caracteres.
  const originals = new Map();

  function keyFor(el) {
    const s = el.style;
    return [
      Math.round(parseFloat(s.left || 0)),
      Math.round(parseFloat(s.top || 0)),
      Math.round(parseFloat(s.height || 0))
    ].join('|');
  }

  function measureTextWidth(text, box) {
    const style = getComputedStyle(box);
    const canvas = measureTextWidth.canvas || (measureTextWidth.canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    if (!ctx) return box.getBoundingClientRect().width;

    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const lines = String(text || '').split(/\r?\n/);
    return Math.max(1, ...lines.map(line => ctx.measureText(line).width));
  }

  function scan() {
    const editor = document.querySelector('.pdf-visual-editor');
    if (!editor) return;

    const layers = editor.querySelectorAll('div');
    layers.forEach(layer => {
      const children = Array.from(layer.children || []);
      if (!children.length) return;

      children.forEach((el, index) => {
        const bg = getComputedStyle(el).backgroundColor;
        const isMask = getComputedStyle(el).pointerEvents === 'none'
          && bg === 'rgb(255, 255, 255)'
          && index + 1 < children.length;

        if (isMask) {
          const box = children[index + 1];
          const original = originals.get(keyFor(el));
          if (!original) return;

          const width = Math.min(
            el.getBoundingClientRect().width,
            Math.max(12, measureTextWidth(original, box) + 8)
          );
          el.style.width = `${width}px`;
          el.style.background = '#fff';
        } else if (
          el.style.position === 'absolute' &&
          getComputedStyle(el).pointerEvents === 'auto' &&
          (el.textContent || '').trim()
        ) {
          const key = keyFor(el);
          if (!originals.has(key)) originals.set(key, el.textContent);
        }
      });
    });
  }

  const observer = new MutationObserver(() => requestAnimationFrame(scan));
  const start = () => {
    const workspace = document.getElementById('workspace') || document.body;
    observer.observe(workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    scan();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
