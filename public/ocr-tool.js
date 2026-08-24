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
          <div style="height:10px;background:#2b3440;border-radius:999px;overflow:hidden;">
            <div id="ocrBar" style="height:100%;width:15%;background:#e2604a;transition:width .4s ease;"></div>
          </div>
          <div id="ocrPercent" style="margin-top:7px;font-size:13px;opacity:.8;">Preparando OCR…</div>
        </div>
      `;
      body.appendChild(wrap);

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
        bar.style.width = '12%';
        percent.textContent = 'Enviando PDF…';
        status.textContent = 'Preparando documento para OCR…';

        const fd = new FormData();
        fd.append('file', file);
        let timer;
        let started = Date.now();

        try {
          timer = setInterval(() => {
            const elapsed = Math.round((Date.now() - started) / 1000);
            const current = parseFloat(bar.style.width) || 12;
            bar.style.width = `${Math.min(90, current + 2)}%`;
            percent.textContent = `Reconhecendo texto… ${elapsed}s`;
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
          bar.style.width = '100%';
          percent.textContent = 'OCR concluído — 100%';
          status.textContent = 'PDF processado com sucesso. O arquivo agora possui uma camada de texto pesquisável.';

          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'pdf-editavel-ocr.pdf';
          link.className = 'btn';
          link.textContent = 'Baixar PDF editável';
          link.style.display = 'inline-block';
          link.style.marginTop = '12px';
          body.appendChild(link);
        } catch (err) {
          clearInterval(timer);
          bar.style.width = '0%';
          percent.textContent = 'OCR não concluído';
          status.textContent = err.message || 'Erro ao processar o PDF.';
        }
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
