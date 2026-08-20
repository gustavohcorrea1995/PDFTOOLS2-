(() => {
  if (window.__pdfToolsEditorUI) return;
  window.__pdfToolsEditorUI = true;

  const STYLE_ID = 'pdftools-editor-ui-style-v2';

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #toolBody.pdftools-editor-shell{
        position:relative;
        min-height:calc(100vh - 90px);
        padding:0 292px 24px 222px;
        box-sizing:border-box;
      }
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar{
        position:absolute!important;
        left:12px!important;
        top:0!important;
        width:194px!important;
        z-index:15000!important;
        box-sizing:border-box;
        display:flex!important;
        flex-direction:column!important;
        gap:6px!important;
        padding:10px!important;
        background:#171d25!important;
        border:1px solid #303b49!important;
        border-radius:12px!important;
        box-shadow:0 14px 36px rgba(0,0,0,.32)!important;
      }
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar button{
        width:100%!important;
        min-height:46px!important;
        padding:8px 12px!important;
        display:flex!important;
        flex-direction:row!important;
        align-items:center!important;
        justify-content:flex-start!important;
        gap:12px!important;
        border:1px solid #303b49!important;
        border-radius:8px!important;
        background:#202832!important;
        color:#eef3f7!important;
        font-size:15px!important;
        font-weight:700!important;
        text-align:left!important;
      }
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar button span{
        font-size:13px!important;
        font-weight:650!important;
      }
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar button:hover{background:#293542!important;border-color:#48586a!important}
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar button.active{background:#c83e2a!important;border-color:#f06b52!important;box-shadow:0 5px 16px rgba(200,62,42,.22)!important}
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar button:disabled{opacity:.38!important}
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar .sep{height:1px!important;background:#344150!important;margin:7px 2px!important}
      #toolBody.pdftools-editor-shell .pdf-editor-sidebar::before{
        content:'FERRAMENTAS';
        display:block;
        padding:4px 6px 8px;
        color:#9eabb9;
        font-size:11px;
        font-weight:800;
        letter-spacing:.11em;
      }

      .pdftools-editor-top{
        position:sticky;
        top:8px;
        z-index:14000;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:18px;
        min-height:58px;
        margin:0 0 12px;
        padding:9px 12px;
        background:#171d25;
        border:1px solid #303b49;
        border-radius:12px;
        box-shadow:0 10px 28px rgba(0,0,0,.22);
      }
      .pdftools-editor-top .editor-brand{display:flex;align-items:center;gap:10px;min-width:0}
      .pdftools-editor-top .editor-logo{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;background:#c83e2a;color:#fff;font-weight:900}
      .pdftools-editor-top .editor-name{font-weight:850;font-size:15px;color:#f4f7fa}
      .pdftools-editor-top .editor-sub{font-size:11px;color:#8997a7;margin-top:2px}
      .pdftools-editor-top .editor-status{display:flex;align-items:center;gap:7px;color:#aeb9c4;font-size:12px;white-space:nowrap}
      .pdftools-editor-top .dot{width:8px;height:8px;border-radius:50%;background:#52b788;box-shadow:0 0 0 3px rgba(82,183,136,.12)}

      .pdftools-properties{
        position:absolute;
        right:12px;
        top:72px;
        width:268px;
        box-sizing:border-box;
        background:#171d25;
        color:#eef3f7;
        border:1px solid #303b49;
        border-radius:12px;
        padding:14px;
        z-index:12000;
        box-shadow:0 14px 36px rgba(0,0,0,.28);
      }
      .pdftools-properties h4{margin:0 0 5px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#aab6c3}
      .pdftools-properties .prop-title{font-size:16px;font-weight:800;margin:0 0 12px}
      .pdftools-properties .prop-line{height:1px;background:#303b49;margin:12px 0}
      .pdftools-properties .prop-note{margin:0;color:#8997a7;font-size:12px;line-height:1.5}
      .pdftools-properties .coord-title{font-size:11px;font-weight:800;color:#aab6c3;text-transform:uppercase;letter-spacing:.08em;margin-top:12px}
      .pdftools-properties .coord-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
      .pdftools-properties .coord-box{padding:8px;background:#202832;border:1px solid #303b49;border-radius:7px}
      .pdftools-properties .coord-box small{display:block;color:#7f8c9b;font-size:10px}
      .pdftools-properties .coord-box strong{display:block;margin-top:2px;font-size:13px;color:#eef3f7}

      .pdftools-editor-shell .pdf-visual-editor{
        min-height:65vh!important;
        border-radius:12px!important;
        box-shadow:0 12px 30px rgba(0,0,0,.2)!important;
      }
      .pdftools-editor-shell .pdf-text-editor{z-index:20000!important}

      @media(max-width:1100px){
        #toolBody.pdftools-editor-shell{padding:0 0 24px}
        #toolBody.pdftools-editor-shell .pdf-editor-sidebar{position:sticky!important;left:auto!important;top:8px!important;width:100%!important;flex-direction:row!important;overflow:auto;margin-bottom:10px}
        #toolBody.pdftools-editor-shell .pdf-editor-sidebar::before{display:none}
        #toolBody.pdftools-editor-shell .pdf-editor-sidebar button{width:auto!important;min-width:120px!important}
        .pdftools-properties{position:relative;right:auto;top:auto;width:100%;margin-top:10px}
      }
    `;
    document.head.appendChild(style);
  }

  function build() {
    const root = document.getElementById('toolBody');
    const sidebar = root?.querySelector('.pdf-editor-sidebar');
    const editor = root?.querySelector('.pdf-visual-editor');
    if (!root || !sidebar || !editor) return false;
    if (root.dataset.editorUiReady === '2') return true;

    addStyle();
    root.classList.add('pdftools-editor-shell');
    root.dataset.editorUiReady = '2';

    const top = document.createElement('div');
    top.className = 'pdftools-editor-top';
    top.innerHTML = `
      <div class="editor-brand">
        <div class="editor-logo">P</div>
        <div><div class="editor-name">PDFTOOLS2 — Editor</div><div class="editor-sub">Edição visual com coordenadas PDF preservadas</div></div>
      </div>
      <div class="editor-status"><span class="dot"></span><span>Editor pronto</span></div>
    `;
    root.insertBefore(top, root.firstChild);

    // Mantém somente controles que já têm implementação real.
    const select = sidebar.querySelector('[data-tool="select"]');
    const text = sidebar.querySelector('[data-tool="text"]');
    const undo = sidebar.querySelector('[data-action="undo"]');
    const redo = sidebar.querySelector('[data-action="redo"]');
    sidebar.innerHTML = '';
    if (select) sidebar.appendChild(select);
    if (text) sidebar.appendChild(text);

    const sep = document.createElement('div');
    sep.className = 'sep';
    sidebar.appendChild(sep);

    const historyLabel = document.createElement('div');
    historyLabel.style.cssText = 'padding:3px 6px 2px;color:#9eabb9;font-size:10px;font-weight:800;letter-spacing:.1em;';
    historyLabel.textContent = 'HISTÓRICO';
    sidebar.appendChild(historyLabel);
    if (undo) sidebar.appendChild(undo);
    if (redo) sidebar.appendChild(redo);

    const props = document.createElement('aside');
    props.className = 'pdftools-properties';
    props.innerHTML = `
      <h4>Propriedades</h4>
      <div class="prop-title">Nenhum objeto selecionado</div>
      <p class="prop-note">Selecione um texto para editar. As coordenadas reais do PDF continuam sendo a referência do documento.</p>
      <div class="prop-line"></div>
      <div class="coord-title">Coordenadas PDF</div>
      <div class="coord-grid">
        <div class="coord-box"><small>X</small><strong>— pt</strong></div>
        <div class="coord-box"><small>Y</small><strong>— pt</strong></div>
        <div class="coord-box"><small>Largura</small><strong>— pt</strong></div>
        <div class="coord-box"><small>Altura</small><strong>— pt</strong></div>
      </div>
    `;
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
