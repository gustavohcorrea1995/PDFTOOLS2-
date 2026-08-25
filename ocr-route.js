const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { buildSearchablePdf } = require('./vision-ocr.js');

module.exports = function registerOcrRoutes(app, { upload, UP, TMP, run, cleanup }) {
  app.post('/api/ocr/pdf', upload.single('file'), async (req, res) => {
    const input = req.file?.path;
    const workDir = path.join(TMP, uuid());
    const apiKey = process.env.GOOGLE_VISION_API_KEY;

    try {
      if (!req.file) throw new Error('Nenhum arquivo foi enviado.');
      if (path.extname(req.file.originalname || '').toLowerCase() !== '.pdf') {
        throw new Error('O OCR aceita somente arquivos PDF.');
      }

      console.log(`[OCR] Iniciando: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} MB) — motor: ${apiKey ? 'Google Cloud Vision' : 'Tesseract (local)'}`);
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

      const output = path.join(TMP, `${uuid()}.pdf`);
      let engineUsed = 'tesseract';

      if (apiKey) {
        // Caminho principal: Google Cloud Vision (rápido, roda fora do servidor).
        try {
          const imagePaths = images.map(name => path.join(workDir, name));
          const pdfBytes = await buildSearchablePdf(imagePaths, apiKey, (page, total, wordCount) => {
            console.log(`[OCR] Página ${page}/${total} concluída via Google Vision — ${wordCount} palavra(s)`);
          });
          await fs.promises.writeFile(output, pdfBytes);
          engineUsed = 'google-vision';
        } catch (visionErr) {
          console.error(`[OCR] Google Vision falhou, caindo para Tesseract: ${visionErr.message}`);
          await runTesseractPipeline(images, workDir, output, run, TMP);
        }
      } else {
        // Sem chave configurada: usa o Tesseract local (mais lento, mas não
        // depende de nenhuma conta externa).
        await runTesseractPipeline(images, workDir, output, run, TMP);
      }

      if (!fs.existsSync(output)) throw new Error('O OCR não gerou nenhum arquivo de saída.');
      const stat = await fs.promises.stat(output);
      console.log(`[OCR] Concluído (${engineUsed}): ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
      res.status(200).set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="pdf-editavel-ocr.pdf"',
        'Content-Length': String(stat.size),
        'X-OCR-Pages': String(images.length),
        'X-OCR-Engine': engineUsed,
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

/** Caminho antigo (Tesseract, roda dentro do próprio servidor) - agora usado
 * como alternativa automática, quando não há chave do Google Vision ou ela falha. */
async function runTesseractPipeline(images, workDir, output, run, TMP) {
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
    console.log(`[OCR] Página ${i + 1}/${images.length} concluída via Tesseract em ${((Date.now() - pageStart) / 1000).toFixed(1)}s`);
  }

  console.log('[OCR] Juntando páginas…');
  await run('pdfunite', [...ocrPdfs, output], { timeout: 300000 });
}
