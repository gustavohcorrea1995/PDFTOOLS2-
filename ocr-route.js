const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');

module.exports = function registerOcrRoutes(app, { upload, UP, TMP, run, cleanup }) {
  app.post('/api/ocr/pdf', upload.single('file'), async (req, res) => {
    const input = req.file?.path;
    const workDir = path.join(TMP, uuid());

    try {
      if (!req.file) throw new Error('Nenhum arquivo foi enviado.');
      if (path.extname(req.file.originalname || '').toLowerCase() !== '.pdf') {
        throw new Error('O OCR aceita somente arquivos PDF.');
      }

      console.log(`[OCR] Iniciando: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} MB)`);
      await fs.promises.mkdir(workDir, { recursive: true });
      const prefix = path.join(workDir, 'pagina');

      // 150 DPI mantém boa precisão de OCR com menos dados para processar -
      // importante na instância gratuita, com CPU compartilhada e limitada.
      console.log('[OCR] Renderizando páginas em imagem…');
      await run('pdftocairo', [
        '-png', '-r', '150', input, prefix
      ], { timeout: 300000 });

      const images = fs.readdirSync(workDir)
        .filter(name => /^pagina-\d+\.png$/i.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (!images.length) throw new Error('Não foi possível renderizar as páginas para OCR.');
      if (images.length > 100) throw new Error('O OCR está limitado a 100 páginas por operação.');
      console.log(`[OCR] ${images.length} página(s) renderizada(s). Iniciando reconhecimento de texto…`);

      const ocrPdfs = [];

      for (let i = 0; i < images.length; i++) {
        const pageStart = Date.now();
        const imagePath = path.join(workDir, images[i]);
        const outBase = path.join(workDir, `ocr-${String(i + 1).padStart(4, '0')}`);

        await run('tesseract', [
          imagePath,
          outBase,
          '-l', 'por',
          'pdf'
        ], { timeout: 300000 });

        const ocrPdf = `${outBase}.pdf`;
        if (!fs.existsSync(ocrPdf)) {
          throw new Error(`O OCR não gerou a página ${i + 1}.`);
        }

        ocrPdfs.push(ocrPdf);
        console.log(`[OCR] Página ${i + 1}/${images.length} concluída em ${((Date.now() - pageStart) / 1000).toFixed(1)}s`);
      }

      console.log('[OCR] Juntando páginas…');
      const output = path.join(TMP, `${uuid()}.pdf`);
      await run('pdfunite', [...ocrPdfs, output], { timeout: 300000 });

      const stat = await fs.promises.stat(output);
      console.log(`[OCR] Concluído: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
      res.status(200).set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="pdf-editavel-ocr.pdf"',
        'Content-Length': String(stat.size),
        'X-OCR-Pages': String(images.length),
        'Cache-Control': 'no-store, max-age=0'
      });

      fs.createReadStream(output).pipe(res);
      res.on('finish', () => cleanup(input, workDir, output));
    } catch (e) {
      console.error(`[OCR] Falhou: ${e.message}`);
      cleanup(input, workDir);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });
};
