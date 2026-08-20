(() => {
  if (window.__pdfToolsEditorUI) return;
  window.__pdfToolsEditorUI = true;

  const STYLE_ID = 'pdftools-editor-ui-style';
  const TOOLS = [
    ['select', '↖', 'Selecionar', true],
    ['text', 'T', 'Texto', true],
    ['image', '▧', 'Imagem', false],
    ['shape', '□', 'Formas', false],
    ['mark', '▰', 'Marcações', false],
    ['signature', '✍', 'Assinatura', false],
    ['pages', '▤', 'Páginas', false]
  ];

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #toolBody.pdftools-editor-shell{position:relative;min-height:70vh;padding-left:92px}
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar{position:absolute!important;left:0!important;top:0!important;width:78px!important;z-index:15000!important}
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar .side-note{display:none!important}
      .pdftools-editor-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 14px;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:12px}
      .pdftools-editor-top .editor-name{font-weight:800;font-size:16px}.pdftools-editor-top .editor-sub{font-size:12px;color:var(--muted);margin-top:3px}
      .pdftools-editor-status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.pdftools-editor-status .dot{width:8px;height:8px;border-radius:50%;background:#52b788}
      .pdftools-properties{position:absolute;right:12px;top:74px;width:250px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;z-index:12000;box-shadow:0 12px 32px rgba(0,0,0,.25)}
      .pdftools-properties h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.pdftools-properties p{margin:0;color:var(--muted);font-size:12px;line-height:1.45}
      .pdftools-tool-group{margin:7px 0 4px;padding:7px 8px 4px;color:#c7d0da;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}
      .pdftools-tool-extra{display:grid;gap:5px;padding:0 7px 5px}.pdftools-tool-extra button{display:flex!important;flex-direction:row!important;justify-content:flex-start!important;gap:8px!important;min-height:38px!important;font-size:14px!important}.pdftools-tool-extra button span{font-size:11px!important}
      .pdftools-tool-disabled{opacity:.45!important;cursor:not-allowed!important}
      @media(max-width:900px){#toolBody.pdftools-editor-shell{padding-left:0}.pdftools-editor-top{margin-top:8px}.pdftools-properties{position:relative;right:auto;top:auto;width:100%;margin:10px 0}}
    `;
    document.head.appendChild(style);
  }

  function build() {
    const root = document.getElementById('toolBody');
    const sidebar = root?.querySelector('.pdf-editor-sidebar');
    const editor = root?.querySelector('.pdf-visual-editor');
    if (!root || !sidebar || !editor) return false;
    if (root.dataset.editorUiReady === '1') return true;

    addStyle();
    root.classList.add('pdftools-editor-shell');
    root.dataset.editorUiReady = '1';

    const top = document.createElement('div');
    top.className = 'pdftools-editor-top';
    top.innerHTML = `
      <div><div class="editor-name">Editor de PDF</div><div class="editor-sub">Edite sem alterar as coordenadas do documento original.</div></div>
      <div class="pdftools-editor-status"><span class="dot"></span> Editor pronto</div>
    `;
    root.insertBefore(top, root.firstChild);

    // Organiza visualmente a barra existente sem substituir seus eventos.
    const select = sidebar.querySelector('[data-tool="select"]');
    const text = sidebar.querySelector('[data-tool="text"]');
    const undo = sidebar.querySelector('[data-action="undo"]');
    const redo = sidebar.querySelector('[data-action="redo"]');
    sidebar.innerHTML = '';
    if (select) sidebar.appendChild(select);
    if (text) sidebar.appendChild(text);

    const group = document.createElement('div');
    group.className = 'pdftools-tool-group';
    group.textContent = 'Ferramentas';
    sidebar.appendChild(group);

    const extra = document.createElement('div');
    extra.className = 'pdftools-tool-extra';
    TOOLS.slice(2).forEach(([key, icon, label, enabled]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = enabled ? '' : 'pdftools-tool-disabled';
      button.title = enabled ? label : `${label} — em breve`;
      button.innerHTML = `${icon}<span>${label}${enabled ? '' : ' • em breve'}</span>`;
      if (!enabled) button.disabled = true;
      extra.appendChild(button);
    });
    sidebar.appendChild(extra);

    const history = document.createElement('div');
    history.className = 'pdftools-tool-group';
    history.textContent = 'Histórico';
    sidebar.appendChild(history);
    if (undo) sidebar.appendChild(undo);
    if (redo) sidebar.appendChild(redo);

    const props = document.createElement('div');
    props.className = 'pdftools-properties';
    props.innerHTML = '<h4>Propriedades</h4><p>Selecione um objeto para ver suas propriedades e coordenadas. As ferramentas novas serão conectadas a este painel sem alterar as caixas existentes.</p>';
    root.appendChild(props);
    return true;
  }

  function start() {
    if (build()) return;
    const workspace = document.getElementById('workspace');
    if (!workspace) return;
    const observer = new MutationObserver(() => {
      if (build()) observer.disconnect();
    });
    observer.observe(workspace, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
