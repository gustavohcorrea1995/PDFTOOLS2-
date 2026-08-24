(() => {
  if (window.__pdfToolsNativeEntry) return;
  window.__pdfToolsNativeEntry = true;

  function addEntry() {
    const grid = document.getElementById('toolGrid');
    if (!grid || grid.querySelector('[data-native-editor-card]')) return;

    const card = document.createElement('div');
    card.className = 'tool-card native-editor-card';
    card.dataset.nativeEditorCard = '1';
    card.innerHTML = `
      <span class="stamp-mark">NOVO</span>
      <div class="icon">⚡</div>
      <h3>Editor PDF Pro</h3>
      <p>Novo motor de edição direta de texto, separado do editor atual.</p>
    `;
    card.addEventListener('click', () => {
      window.location.href = '/native-editor.html';
    });
    grid.prepend(card);

    const style = document.createElement('style');
    style.textContent = `
      .native-editor-card{border:1px solid rgba(193,68,45,.75);position:relative;overflow:hidden}
      .native-editor-card:after{content:"NOVO MOTOR";position:absolute;right:-34px;top:12px;transform:rotate(35deg);font-size:9px;font-weight:800;letter-spacing:.08em;padding:4px 34px;background:#c19665;color:#2a0d12}
      .native-editor-card:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(193,68,45,.18)}
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addEntry, { once:true });
  else addEntry();
  new MutationObserver(addEntry).observe(document.body, { childList:true, subtree:true });
})();
