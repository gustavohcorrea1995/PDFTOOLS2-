const fs = require('fs');
const { PDFDocument, StandardFonts } = require('pdf-lib');

// Precisa bater com a resolução usada em ocr-route.js para renderizar as
// páginas em imagem (pdftocairo -r 150) - é o que permite converter as
// coordenadas em pixel que o Google devolve para pontos de PDF.
const VISION_DPI = 150;
const PT_PER_PX = 72 / VISION_DPI;

/**
 * Chama a Cloud Vision API do Google para uma imagem já em base64.
 * Usa DOCUMENT_TEXT_DETECTION, otimizado para páginas de texto denso
 * (diferente de TEXT_DETECTION, pensado para texto curto em fotos soltas).
 */
async function annotateImage(imageBase64, apiKey) {
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: imageBase64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['pt'] }
      }]
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google Vision API respondeu ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const result = data.responses && data.responses[0];
  if (result && result.error) {
    throw new Error(`Google Vision API: ${result.error.message}`);
  }
  return result || {};
}

/**
 * Monta a lista de palavras (texto + caixa delimitadora em pixels) a partir
 * da resposta da Vision API. textAnnotations[0] é o texto inteiro da
 * página (usado só como referência) - o resto são as palavras individuais.
 */
function extractWords(annotation) {
  const all = annotation.textAnnotations || [];
  return all.slice(1).map(item => ({
    text: item.description || '',
    vertices: item.boundingPoly?.vertices || []
  })).filter(w => w.text.trim() && w.vertices.length >= 4);
}

/**
 * Recebe uma lista de caminhos de imagens PNG (uma por página, já
 * renderizadas antes) e devolve os bytes de um PDF pesquisável: a imagem
 * original de cada página como fundo, com uma camada de texto invisível
 * (mas selecionável/pesquisável) posicionada em cima de cada palavra
 * detectada pelo Google Cloud Vision.
 */
async function buildSearchablePdf(imagePaths, apiKey, onPageDone) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < imagePaths.length; i++) {
    const imageBytes = await fs.promises.readFile(imagePaths[i]);
    const base64 = imageBytes.toString('base64');

    const annotation = await annotateImage(base64, apiKey);
    const words = extractWords(annotation);

    const png = await pdfDoc.embedPng(imageBytes);
    const pageWidthPt = png.width * PT_PER_PX;
    const pageHeightPt = png.height * PT_PER_PX;
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    page.drawImage(png, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });

    for (const word of words) {
      const xs = word.vertices.map(v => v.x || 0);
      const ys = word.vertices.map(v => v.y || 0);
      const xMinPx = Math.min(...xs);
      const xMaxPx = Math.max(...xs);
      const yMinPx = Math.min(...ys);
      const yMaxPx = Math.max(...ys);

      const xPt = xMinPx * PT_PER_PX;
      const widthPt = (xMaxPx - xMinPx) * PT_PER_PX;
      const heightPt = (yMaxPx - yMinPx) * PT_PER_PX;
      // A imagem tem origem no canto superior esquerdo (y cresce para
      // baixo); o PDF tem origem no canto inferior esquerdo (y cresce
      // para cima) - por isso o flip aqui.
      const yPt = pageHeightPt - (yMaxPx * PT_PER_PX);

      if (widthPt <= 0 || heightPt <= 0) continue;

      // Ajusta o tamanho da fonte para a largura do texto invisível bater
      // com a largura real da palavra detectada - sem isso, ao selecionar
      // o texto num leitor de PDF, o realce ficaria maior ou menor que a
      // palavra de verdade por baixo.
      let fontSize = Math.max(4, heightPt * 0.88);
      const naturalWidth = font.widthOfTextAtSize(word.text, fontSize);
      if (naturalWidth > 0) {
        fontSize *= Math.min(3, Math.max(0.3, widthPt / naturalWidth));
      }

      page.drawText(word.text, {
        x: xPt,
        y: yPt,
        size: fontSize,
        font,
        opacity: 0
      });
    }

    if (onPageDone) onPageDone(i + 1, imagePaths.length, words.length);
  }

  return pdfDoc.save();
}

module.exports = { buildSearchablePdf };
