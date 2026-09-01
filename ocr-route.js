const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { buildSearchablePdf } = require('./vision-ocr.js');

// Acima disso, a etapa de renderizar todas as páginas em imagem (antes
// mesmo do OCR começar) tende a estourar o tempo limite na instância
// gratuita (CPU muito limitada) - melhor avisar de cara do que deixar a
// pessoa esperar vários minutos só para ver uma falha no final.
const MAX_OCR_FILE_MB = 40;

/** Traduz erros técnicos (timeout, falta de memória) em mensagens claras,
 * sem vazar comandos ou caminhos internos do servidor para o usuário. */
function friendlyOcrError(e, stage) {
  if (e.timedOut) {
    return `O ${stage} demorou demais e foi interrompido. Isso costuma acontecer com PDFs grandes ou com muitas páginas no plano gratuito atual (CPU bem limitada). Tente um arquivo menor, ou considere um plano com mais capacidade de processamento.`;
  }
  if (e.oomKilled) {
    return `O servidor ficou sem memória durante o ${stage}. Isso costuma acontecer com PDFs muito grandes ou com imagens de resolução muito alta no plano gratuito atual. Tente um arquivo menor.`;
  }
  return e.message;
}

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
      const fileMb = req.file.size / 1024 / 1024;
      if (fileMb > MAX_OCR_FILE_MB) {
        throw new Error(`Este arquivo tem ${fileMb.toFixed(1)} MB - o OCR está limitado a ${MAX_OCR_FILE_MB} MB no plano atual, para evitar que o processamento trave por falta de CPU/memória. Tente comprimir o PDF primeiro (ferramenta "Comprimir PDF") ou dividir em partes menores.`);
      }

      console.log(`[OCR] Iniciando: ${req.file.originalname} (${fileMb.toFixed(1)} MB) — motor: ${apiKey ? 'Google Cloud Vision' : 'Tesseract (local)'}`);
      await fs.promises.mkdir(workDir, { recursive: true });
      const prefix = path.join(workDir, 'pagina');

      // 150 DPI mantém boa precisão de OCR com menos dados para processar -
      // importante na instância gratuita, com CPU compartilhada e limitada.
      // Esse comando renderiza TODAS as páginas de uma vez, por isso tem
      // uma margem maior que as demais etapas (que processam página a página).
      console.log('[OCR] Renderizando páginas em imagem…');
      try {
        await run('pdftocairo', [
          '-png', '-r', '150', input, prefix
        ], { timeout: 480000 });
      } catch (renderErr) {
        throw new Error(friendlyOcrError(renderErr, 'preparo das páginas'));
      }

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
          try {
            await runTesseractPipeline(images, workDir, output, run, TMP);
          } catch (tessErr) {
            throw new Error(friendlyOcrError(tessErr, 'reconhecimento de texto'));
          }
        }
      } else {
        // Sem chave configurada: usa o Tesseract local (mais lento, mas não
        // depende de nenhuma conta externa).
        try {
          await runTesseractPipeline(images, workDir, output, run, TMP);
        } catch (tessErr) {
          throw new Error(friendlyOcrError(tessErr, 'reconhecimento de texto'));
        }
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
    ], { timeout: 480000 });

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
