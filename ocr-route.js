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

      await fs.promises.mkdir(workDir, { recursive: true });
      const prefix = path.join(workDir, 'pagina');

      // 200 DPI é um bom equilíbrio entre precisão do OCR e tempo/memória.
      await run('pdftocairo', [
        '-png', '-r', '200', input, prefix
      ], { timeout: 300000 });

      const images = fs.readdirSync(workDir)
        .filter(name => /^pagina-\d+\.png$/i.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (!images.length) throw new Error('Não foi possível renderizar as páginas para OCR.');
      if (images.length > 100) throw new Error('O OCR está limitado a 100 páginas por operação.');

      const ocrPdfs = [];

      for (let i = 0; i < images.length; i++) {
        const imagePath = path.join(workDir, images[i]);
        const outBase = path.join(workDir, `ocr-${String(i + 1).padStart(4, '0')}`);

        await run('tesseract', [
          imagePath,
          outBase,
          '-l', 'por+eng',
          'pdf'
        ], { timeout: 300000 });

        const ocrPdf = `${outBase}.pdf`;
        if (!fs.existsSync(ocrPdf)) {
          throw new Error(`O OCR não gerou a página ${i + 1}.`);
        }

        ocrPdfs.push(ocrPdf);
      }

      const output = path.join(TMP, `${uuid()}.pdf`);
      await run('pdfunite', [...ocrPdfs, output], { timeout: 300000 });

      const stat = await fs.promises.stat(output);
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
      cleanup(input, workDir);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });
};
