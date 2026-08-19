(() => {
  const STYLE_ID = 'pdftools-preview-modal-style';
  const MODAL_ID = 'pdftools-preview-modal';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID}{position:fixed;inset:0;z-index:99999;display:none;background:rgba(0,0,0,.86);align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
      #${MODAL_ID}.open{display:flex}
      #${MODAL_ID} .pm-panel{position:relative;width:min(96vw,1500px);height:min(94vh,1000px);display:flex;flex-direction:column;background:#111923;border:1px solid #3a4655;border-radius:14px;box-shadow:0 20px 70px rgba(0,0,0,.55);overflow:hidden}
      #${MODAL_ID} .pm-top{height:54px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid #303b49;color:#fff;flex:0 0 auto}
      #${MODAL_ID} .pm-title{font-weight:700;margin-right:auto}
      #${MODAL_ID} button{border:1px solid #465365;background:#1a2430;color:#fff;border-radius:8px;padding:7px 11px;cursor:pointer;font-size:14px}
      #${MODAL_ID} button:hover{background:#253243}
      #${MODAL_ID} .pm-close{font-size:18px;padding:5px 11px}
      #${MODAL_ID} .pm-view{position:relative;flex:1;overflow:auto;background:#5e6267;display:flex;align-items:flex-start;justify-content:center;padding:28px;box-sizing:border-box}
      #${MODAL_ID} img{display:block;max-width:none;width:auto;height:auto;transform-origin:top center;box-shadow:0 8px 35px rgba(0,0,0,.35);background:#fff}
      #${MODAL_ID} .pm-help{position:absolute;left:16px;bottom:12px;background:rgba(0,0,0,.55);padding:5px 9px;border-radius:6px;color:#ddd;font-size:12px}
    `;
    document.head.appendChild(style);
  }

  function createModal() {
    if (document.getElementById(MODAL_ID)) return document.getElementById(MODAL_ID);
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="pm-panel">
        <div class="pm-top">
          <span class="pm-title">Visualizar página</span>
          <button type="button" data-zoom="out">−</button>
          <button type="button" data-zoom="reset">100%</button>
          <button type="button" data-zoom="in">+</button>
          <button type="button" class="pm-close" title="Fechar">✕</button>
        </div>
        <div class="pm-view"><img alt="Prévia ampliada"><span class="pm-help">Use +/− para zoom • ESC para fechar</span></div>
      </div>`;
    document.body.appendChild(modal);

    let scale = 1;
    const img = modal.querySelector('img');
    const view = modal.querySelector('.pm-view');
    const setScale = value => {
      scale = Math.max(.5, Math.min(3, value));
      img.style.width = `${scale * 100}%`;
      img.style.maxWidth = 'none';
      modal.querySelector('[data-zoom="reset"]').textContent = `${Math.round(scale * 100)}%`;
    };

    modal.querySelector('[data-zoom="out"]').onclick = () => setScale(scale - .25);
    modal.querySelector('[data-zoom="in"]').onclick = () => setScale(scale + .25);
    modal.querySelector('[data-zoom="reset"]').onclick = () => setScale(1);
    modal.querySelector('.pm-close').onclick = () => modal.classList.remove('open');
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.classList.remove('open'); });
    view.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale(scale + (e.deltaY < 0 ? .1 : -.1));
    }, { passive:false });

    modal._open = (src, title) => {
      modal.querySelector('.pm-title').textContent = title || 'Visualizar página';
      img.src = src;
      scale = 1;
      setScale(1);
      view.scrollTop = 0;
      view.scrollLeft = 0;
      modal.classList.add('open');
    };
    return modal;
  }

  function bind() {
    installStyle();
    const modal = createModal();
    document.addEventListener('click', e => {
      const img = e.target.closest('.page-thumb img');
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      const label = img.closest('.page-thumb')?.querySelector('.pnum')?.textContent || 'Visualizar página';
      modal._open(img.currentSrc || img.src, label);
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true });
  else bind();
})();
