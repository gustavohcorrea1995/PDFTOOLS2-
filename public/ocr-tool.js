// Ferramenta OCR isolada. Não altera o editor PDF existente.
(() => {
  function boot() {
    const grid = document.getElementById('toolGrid');
    const hero = document.getElementById('hero');
    const workspace = document.getElementById('workspace');
    const title = document.getElementById('toolTitle');
    const body = document.getElementById('toolBody');
    if (!grid || !hero || !workspace || !title || !body) return;

    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <span class="stamp-mark">Editar</span>
      <div class="icon">🪄</div>
      <h3>Tornar PDF editável</h3>
      <p>Reconheça textos de PDFs escaneados com OCR e gere um PDF pesquisável.</p>
    `;
    card.onclick = open;
    grid.appendChild(card);

    if (new URLSearchParams(location.search).get('tool') === 'ocr') open();

    function open() {
      hero.classList.add('hidden');
      workspace.classList.remove('hidden');
      title.textContent = 'Tornar PDF editável';
      body.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <p class="hint">Use OCR para transformar um PDF escaneado em um PDF pesquisável e com camada de texto.</p>
        <div class="dropzone" id="ocrDrop">
          <div class="dz-title">Arraste um PDF escaneado aqui ou clique para escolher</div>
          <p>O arquivo será processado no servidor e não altera o editor atual.</p>
          <input id="ocrInput" type="file" accept=".pdf,application/pdf" style="display:none">
        </div>
        <div id="ocrStatus" class="hint">Aguardando PDF.</div>
        <div id="ocrProgress" style="display:none;margin:18px 0;">
          <div style="height:10px;background:#2b3440;border-radius:999px;overflow:hidden;position:relative;">
            <div id="ocrBar" style="height:100%;width:100%;background:linear-gradient(90deg,#c19665,#d4ac82);position:relative;overflow:hidden;">
              <div id="ocrBarShine" style="position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);transform:translateX(-100%);animation:ocrShine 1.3s linear infinite;"></div>
            </div>
          </div>
          <div id="ocrPercent" style="margin-top:7px;font-size:13px;opacity:.85;">Preparando OCR…</div>
        </div>
      `;
      body.appendChild(wrap);

      if (!document.getElementById('ocrShineStyle')) {
        const style = document.createElement('style');
        style.id = 'ocrShineStyle';
        style.textContent = '@keyframes ocrShine{to{transform:translateX(100%)}}';
        document.head.appendChild(style);
      }

      const drop = wrap.querySelector('#ocrDrop');
      const input = wrap.querySelector('#ocrInput');
      const status = wrap.querySelector('#ocrStatus');
      const progress = wrap.querySelector('#ocrProgress');
      const bar = wrap.querySelector('#ocrBar');
      const percent = wrap.querySelector('#ocrPercent');

      drop.onclick = () => input.click();
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
      drop.addEventListener('drop', e => {
        e.preventDefault();
        drop.classList.remove('drag');
        const file = e.dataTransfer.files?.[0];
        if (file) process(file);
      });
      input.onchange = () => {
        if (input.files?.[0]) process(input.files[0]);
      };

      async function process(file) {
        if (!/\.pdf$/i.test(file.name)) {
          status.textContent = 'Selecione um arquivo PDF.';
          return;
        }

        progress.style.display = 'block';
        percent.textContent = 'Enviando PDF…';
        status.textContent = 'Preparando documento para OCR…';

        const fd = new FormData();
        fd.append('file', file);
        let timer;
        let started = Date.now();

        try {
          timer = setInterval(() => {
            const elapsed = Math.round((Date.now() - started) / 1000);
            let msg = `Reconhecendo texto… ${elapsed}s`;
            if (elapsed > 90) msg = `Ainda processando (${elapsed}s) — documentos com várias páginas ou em alta resolução podem levar alguns minutos. Isso é normal, não feche esta aba.`;
            else if (elapsed > 30) msg = `Ainda processando (${elapsed}s) — pode levar um pouco mais em documentos maiores.`;
            percent.textContent = msg;
          }, 1000);

          const res = await fetch('/api/ocr/pdf', { method: 'POST', body: fd });
          if (!res.ok) {
            let msg = 'Falha ao executar o OCR.';
            try {
              const data = await res.json();
              msg = data.error || msg;
            } catch (_) {}
            throw new Error(msg);
          }

          const blob = await res.blob();
          clearInterval(timer);
          percent.textContent = 'OCR concluído!';
          status.textContent = 'PDF processado com sucesso. O arquivo agora possui uma camada de texto pesquisável.';
          progress.style.display = 'none';

          const link = document.createElement('button');
          link.className = 'btn';
          link.textContent = 'Baixar PDF editável';
          link.style.display = 'inline-block';
          link.style.marginTop = '12px';
          link.onclick = async () => {
            // O clique aqui é um gesto novo e "fresco" do usuário, então o
            // seletor nativo de local para salvar funciona normalmente,
            // mesmo o OCR já tendo terminado há um tempo.
            const save = await (window.pickSaveTarget
              ? window.pickSaveTarget('pdf-editavel-ocr.pdf')
              : { cancelled: false, deliver: async (b) => {
                  const url = URL.createObjectURL(b);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'pdf-editavel-ocr.pdf';
                  document.body.appendChild(a); a.click(); a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } });
            if (save.cancelled) return;
            try {
              await save.deliver(blob);
            } catch (e) {
              status.textContent = e.message || 'Erro ao salvar o arquivo.';
            }
          };
          body.appendChild(link);
        } catch (err) {
          clearInterval(timer);
          progress.style.display = 'none';
          status.textContent = err.message || 'Erro ao processar o PDF.';
        }
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
