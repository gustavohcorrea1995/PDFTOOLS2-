(() => {
  const labels = {
    '/api/merge': { title: 'Juntando PDFs', steps: ['Enviando arquivos', 'Combinando páginas', 'Preparando arquivo final'] },
    '/api/split': { title: 'Dividindo PDF', steps: ['Enviando arquivo', 'Separando páginas', 'Preparando arquivos'] },
    '/api/inspect': { title: 'Preparando seu PDF', steps: ['Enviando arquivo', 'Lendo estrutura e textos', 'Renderizando prévias'] },
    '/api/pages/edit': { title: 'Organizando páginas', steps: ['Enviando PDF', 'Aplicando alterações', 'Preparando arquivo final'] },
    '/api/compress': { title: 'Comprimindo PDF', steps: ['Enviando arquivo', 'Otimizando PDF', 'Finalizando arquivo'] },
    '/api/convert/images-to-pdf': { title: 'Criando PDF', steps: ['Enviando imagens', 'Montando páginas', 'Finalizando PDF'] },
    '/api/convert/pdf-to-images': { title: 'Convertendo páginas', steps: ['Enviando PDF', 'Renderizando páginas', 'Criando arquivo ZIP'] },
    '/api/convert/office': { title: 'Convertendo documento', steps: ['Enviando arquivo', 'Processando com o conversor', 'Preparando resultado'] }
  };

  // Rotas com sua própria experiência de carregamento dedicada (editor
  // nativo e OCR) - não devem ganhar este modal genérico por cima.
  const excluded = ['/api/preview/', '/api/ocr/', '/api/edit/native'];

  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'operationProgress';
    overlay.className = 'operation-progress hidden';
    overlay.innerHTML = `
      <div class="operation-progress-card" role="status" aria-live="polite">
        <div class="operation-progress-title">
          <span id="operationProgressTitle">Processando</span>
          <span class="operation-progress-percent" id="operationProgressPercent">0%</span>
        </div>
        <div class="operation-progress-stage" id="operationProgressStage">Preparando...</div>
        <div class="operation-progress-track"><div class="operation-progress-bar"></div></div>
        <div class="operation-progress-meta">
          <span id="operationProgressElapsed">0s</span>
          <span id="operationProgressHint">Enviando arquivo...</span>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  /**
   * Controla uma "sessão" de progresso para uma operação:
   * - 0-70%: progresso REAL de envio, medido em bytes pelo navegador
   *   (XMLHttpRequest.upload.onprogress) - não é estimativa.
   * - 70-92%: enquanto o servidor processa (não temos como saber o
   *   progresso real disso sem reformular cada ferramenta), a barra avança
   *   devagar e desacelera, deixando claro no texto que é uma estimativa e
   *   que o processamento continua.
   * - 100%: só quando a resposta realmente chega.
   */
  function createSession(url) {
    const root = ensureOverlay();
    const key = Object.keys(labels).find(k => url.includes(k));
    const config = labels[key] || { title: 'Processando arquivo', steps: ['Enviando arquivo', 'Processando no servidor', 'Preparando resultado'] };

    const titleEl = root.querySelector('#operationProgressTitle');
    const percentEl = root.querySelector('#operationProgressPercent');
    const stageEl = root.querySelector('#operationProgressStage');
    const bar = root.querySelector('.operation-progress-bar');
    const elapsedEl = root.querySelector('#operationProgressElapsed');
    const hintEl = root.querySelector('#operationProgressHint');

    titleEl.textContent = config.title;
    stageEl.textContent = config.steps[0];
    bar.style.width = '0%';
    bar.classList.remove('running');
    percentEl.textContent = '0%';
    hintEl.textContent = 'Enviando arquivo...';
    root.classList.remove('hidden');

    const startedAt = Date.now();
    let uploadDone = false;
    let percent = 0;
    let elapsedTimer = null;
    let creepTimer = null;

    function setPercent(p) {
      percent = Math.max(percent, Math.min(100, p));
      bar.style.width = `${percent}%`;
      percentEl.textContent = `${Math.round(percent)}%`;
    }

    elapsedTimer = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      elapsedEl.textContent = `${s}s`;
      if (uploadDone) {
        stageEl.textContent = config.steps[1] || 'Processando no servidor';
        hintEl.textContent = s >= 20
          ? 'Ainda processando. Não feche esta página.'
          : 'Arquivo enviado - processando no servidor.';
      }
    }, 500);

    function onUploadProgress(loaded, total) {
      if (!total) return;
      setPercent((loaded / total) * 70);
    }

    function onUploadComplete() {
      uploadDone = true;
      setPercent(70);
      bar.classList.add('running');
      stageEl.textContent = config.steps[1] || 'Processando no servidor';
      hintEl.textContent = 'Arquivo enviado - processando no servidor.';
      // Estimativa suave (nunca ultrapassa 92% sozinha) enquanto esperamos
      // a resposta - deixamos claro no texto que é isso, não um número exato.
      let step = 0;
      creepTimer = setInterval(() => {
        step += 1;
        const remaining = 92 - percent;
        setPercent(percent + remaining * 0.12);
        if (step > 200) clearInterval(creepTimer);
      }, 400);
    }

    function finish() {
      clearInterval(elapsedTimer);
      clearInterval(creepTimer);
      bar.classList.remove('running');
      stageEl.textContent = config.steps[2] || config.steps[config.steps.length - 1];
      setPercent(100);
      setTimeout(() => root.classList.add('hidden'), 300);
    }

    return { onUploadProgress, onUploadComplete, finish };
  }

  /**
   * Substitui window.fetch por uma versão que, para as rotas monitoradas,
   * usa XMLHttpRequest por baixo dos panos (para ter acesso a progresso real
   * de envio) mas devolve um objeto compatível com a API de fetch - o resto
   * do código (que já usa `await fetch(...).then(r => r.json())` etc.) não
   * precisa mudar nada.
   */
  function xhrFetch(url, options, session) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method || 'GET', url, true);
      if (options.headers) {
        Object.entries(options.headers).forEach(([k, v]) => {
          try { xhr.setRequestHeader(k, v); } catch (_) {}
        });
      }
      xhr.responseType = 'blob';
      if (xhr.upload) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) session.onUploadProgress(e.loaded, e.total);
        };
        xhr.upload.onload = () => session.onUploadComplete();
      }
      xhr.onerror = () => reject(new TypeError('Falha de rede ao enviar o arquivo.'));
      xhr.onabort = () => reject(new DOMException('Requisição cancelada.', 'AbortError'));
      xhr.onload = () => {
        const blob = xhr.response;
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          headers: { get: (name) => xhr.getResponseHeader(name) },
          blob: () => Promise.resolve(blob),
          json: () => blob.text().then(t => JSON.parse(t)),
          text: () => blob.text()
        });
      };
      xhr.send(options.body || null);
    });
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const options = args[1] || {};
    const isPost = (options.method || 'GET').toUpperCase() === 'POST';
    const tracked = url.includes('/api/') && !excluded.some(e => url.includes(e)) && isPost;

    if (!tracked) return originalFetch(...args);

    const session = createSession(url);
    try {
      const result = await xhrFetch(url, options, session);
      return result;
    } finally {
      session.finish();
    }
  };
})();
