(() => {
  if (window.__pdfToolsEditorMaskFix) return;
  window.__pdfToolsEditorMaskFix = true;

  const originals = new Map();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  function keyFor(el) {
    const s = el.style;
    return [
      Math.round(parseFloat(s.left || 0)),
      Math.round(parseFloat(s.top || 0)),
      Math.round(parseFloat(s.height || 0))
    ].join('|');
  }

  function measure(text, box) {
    if (!ctx) return box.getBoundingClientRect().width;
    const style = getComputedStyle(box);
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const lines = String(text || '').split(/\r?\n/);
    return Math.max(3, ...lines.map(line => ctx.measureText(line).width + 5));
  }

  function scan() {
    document.querySelectorAll('.pdf-visual-editor').forEach(editor => {
      editor.querySelectorAll('div').forEach(layer => {
        const children = Array.from(layer.children || []);
        children.forEach((el, index) => {
          if (el.classList.contains('pdf-text-editor')) return;

          const style = getComputedStyle(el);
          const isTextBox = style.position === 'absolute'
            && style.pointerEvents === 'auto'
            && (el.textContent || '').trim().length > 0
            && !el.classList.contains('pdf-new-text-layer');

          if (isTextBox) {
            const key = keyFor(el);
            if (!originals.has(key)) originals.set(key, el.textContent);
            return;
          }

          const isMask = style.position === 'absolute'
            && style.pointerEvents === 'none'
            && style.backgroundColor === 'rgb(255, 255, 255)'
            && index + 1 < children.length;

          if (!isMask) return;

          const box = children[index + 1];
          if (!box || !box.textContent || box.classList.contains('pdf-text-editor')) return;

          const original = originals.get(keyFor(el));
          const source = original || box.textContent;
          const maxWidth = el.getBoundingClientRect().width;
          const targetWidth = Math.min(maxWidth, measure(source, box));

          el.style.width = `${Math.max(3, targetWidth)}px`;
          el.dataset.maskFixed = '1';
        });
      });
    });
  }

  const observer = new MutationObserver(() => requestAnimationFrame(scan));

  function start() {
    const workspace = document.getElementById('workspace') || document.body;
    observer.observe(workspace, { childList: true, subtree: true });
    scan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
