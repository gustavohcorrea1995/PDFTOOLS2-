/*
 * ClientPDF - processamento de PDF direto no navegador.
 *
 * Miniaturas (pdf.js) e as operações Juntar, Dividir, Organizar páginas e
 * Imagens -> PDF (pdf-lib) rodam aqui, sem enviar o arquivo ao servidor.
 * O servidor continua com as mesmas rotas (/api/inspect, /api/merge,
 * /api/split, /api/pages/edit, /api/convert/images-to-pdf): o app.js cai
 * nelas automaticamente se algo falhar no navegador.
 *
 * As bibliotecas ficam em /vendor e só são baixadas quando a primeira
 * ferramenta que precisa delas é usada.
 */
(() => {
  const VENDOR = '/vendor';
  const scriptPromises = {};
  const createdUrls = new Set();

  function loadScript(src) {
    if (!scriptPromises[src]) {
      scriptPromises[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete scriptPromises[src]; reject(new Error('Não foi possível carregar ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scriptPromises[src];
  }

  async function pdfjs() {
    await loadScript(`${VENDOR}/pdfjs/pdf.min.js`);
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('pdf.js indisponível.');
    lib.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdfjs/pdf.worker.min.js`;
    return lib;
  }

  async function pdfLib() {
    await loadScript(`${VENDOR}/pdf-lib.min.js`);
    if (!window.PDFLib) throw new Error('pdf-lib indisponível.');
    return window.PDFLib;
  }

  async function zipLib() {
    await loadScript(`${VENDOR}/fflate.min.js`);
    if (!window.fflate) throw new Error('fflate indisponível.');
    return window.fflate;
  }

  // Erros de validação (culpa da escolha do usuário, não do navegador):
  // o app.js mostra a mensagem e NÃO tenta o servidor.
  function userError(message) {
    const e = new Error(message);
    e.userError = true;
    return e;
  }

  // Dá ao navegador a chance de pintar o spinner antes de um trecho pesado.
  const breathe = () => new Promise(r => setTimeout(r, 30));

  function trackUrl(blob) {
    const url = URL.createObjectURL(blob);
    createdUrls.add(url);
    return url;
  }

  function revokeAll() {
    createdUrls.forEach(u => URL.revokeObjectURL(u));
    createdUrls.clear();
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Falha ao gerar imagem.')), type, quality);
    });
  }

  /**
   * Abre um PDF para gerar miniaturas. As páginas são renderizadas uma de
   * cada vez e sob demanda - nunca todas na memória ao mesmo tempo.
   */
  async function open(file) {
    const lib = await pdfjs();
    const task = lib.getDocument({
      data: await file.arrayBuffer(),
      cMapUrl: `${VENDOR}/pdfjs/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${VENDOR}/pdfjs/standard_fonts/`
    });
    const doc = await task.promise;
    let destroyed = false;
    let chain = Promise.resolve();

    async function renderNow(pageNum, maxSide) {
      if (destroyed) throw new Error('Documento fechado.');
      const page = await doc.getPage(pageNum);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = maxSide / Math.max(base.width, base.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // intent 'print' faz o pdf.js desenhar sem requestAnimationFrame;
        // com o padrão ('display') as miniaturas ficavam paradas enquanto a
        // aba ou a janela do navegador não estivesse visível.
        await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.8);
        canvas.width = canvas.height = 0;
        return trackUrl(blob);
      } finally {
        page.cleanup();
      }
    }

    return {
      pageCount: doc.numPages,
      // Enfileira: uma página por vez, na ordem em que foi pedida.
      render(pageNum, maxSide = 420) {
        const job = chain.then(() => renderNow(pageNum, maxSide));
        chain = job.catch(() => {});
        return job;
      },
      get destroyed() { return destroyed; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        chain.then(() => task.destroy()).catch(() => {});
      }
    };
  }

  async function loadForEdit(file) {
    const { PDFDocument } = await pdfLib();
    return PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  }

  function pdfBlob(bytes) {
    return new Blob([bytes], { type: 'application/pdf' });
  }

  // ---------- Juntar ----------
  async function merge(files) {
    if (files.length < 2) throw userError('Selecione pelo menos 2 PDFs.');
    const { PDFDocument } = await pdfLib();
    await breathe();
    const out = await PDFDocument.create();
    for (const file of files) {
      const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
      await breathe();
    }
    return pdfBlob(await out.save());
  }

  // ---------- Dividir ----------
  // groups: lista de [inicio, fim] em páginas 1-based (inclusive).
  async function split(file, groups) {
    const { PDFDocument } = await pdfLib();
    const { zipSync } = await zipLib();
    await breathe();
    const src = await loadForEdit(file);
    const pageCount = src.getPageCount();
    if (groups.length > 100) throw userError('Limite de 100 partes por operação.');
    const entries = {};
    for (let i = 0; i < groups.length; i++) {
      const [start, end] = groups[i];
      if (!(start >= 1 && end >= start && start <= pageCount)) throw userError(`Página inválida no intervalo: ${start}-${end}`);
      const indices = [];
      for (let p = start; p <= Math.min(end, pageCount); p++) indices.push(p - 1);
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, indices);
      pages.forEach(p => doc.addPage(p));
      // PDFs já são comprimidos por dentro: level 0 (só empacotar) é
      // praticamente instantâneo e o ZIP fica do mesmo tamanho.
      entries[`parte_${i + 1}.pdf`] = [await doc.save(), { level: 0 }];
      await breathe();
    }
    return new Blob([zipSync(entries)], { type: 'application/zip' });
  }

  // ---------- Organizar páginas ----------
  // ops: { keepOrder:[1-based], delete:[1-based], rotations:{ [1-based]: graus } }
  async function editPages(file, ops) {
    const { PDFDocument, degrees } = await pdfLib();
    await breathe();
    const src = await loadForEdit(file);
    const pageCount = src.getPageCount();
    let order = Array.isArray(ops.keepOrder) ? ops.keepOrder.map(n => Number(n) - 1) : src.getPageIndices();
    const deleted = new Set((ops.delete || []).map(n => Number(n) - 1));
    if (order.some(i => !Number.isInteger(i) || i < 0 || i >= pageCount)) throw userError('Ordem de páginas inválida.');
    order = order.filter(i => !deleted.has(i));
    if (!order.length) throw userError('O PDF final precisa ter pelo menos uma página.');
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, order);
    pages.forEach((page, idx) => {
      const original = order[idx] + 1;
      const rotation = Number((ops.rotations || {})[original] || 0);
      if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
      out.addPage(page);
    });
    return pdfBlob(await out.save());
  }

  // ---------- Imagens -> PDF ----------
  const MAX_IMAGE_SIDE = 16000;
  const MAX_IMAGE_AREA = 100e6;

  async function imageToJpegBytes(file) {
    // 'from-image' aplica a rotação EXIF da câmera (fotos de celular na
    // vertical), igual ao .rotate() do sharp no servidor.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const { width, height } = bitmap;
      if (!width || !height || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_AREA) {
        throw new Error('Imagem grande demais para o navegador.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff'; // fundo branco para PNGs com transparência
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0);
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      canvas.width = canvas.height = 0;
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  async function imagesToPdf(files) {
    if (!files.length) throw userError('Selecione pelo menos uma imagem.');
    if (typeof createImageBitmap !== 'function') throw new Error('Navegador sem createImageBitmap.');
    const { PDFDocument } = await pdfLib();
    await breathe();
    const doc = await PDFDocument.create();
    for (const file of files) {
      const img = await doc.embedJpg(await imageToJpegBytes(file));
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      await breathe();
    }
    return pdfBlob(await doc.save());
  }

  window.ClientPDF = { open, merge, split, editPages, imagesToPdf, revokeAll };
})();
