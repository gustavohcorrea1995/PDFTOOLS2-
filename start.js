const childProcess = require('child_process');
const fs = require('fs');
const Module = require('module');
const path = require('path');

// Poppler's -jpegopt is valid only for JPEG output.
const originalExecFile = childProcess.execFile;
childProcess.execFile = function patchedExecFile(command, args, options, callback) {
  if (command === 'pdftocairo' && Array.isArray(args)) {
    const normalized = [...args];
    if (normalized.includes('-png')) {
      for (let i = normalized.length - 1; i >= 0; i--) {
        if (normalized[i] === '-jpegopt') normalized.splice(i, 2);
      }
    }
    args = normalized;
  }
  return originalExecFile.call(this, command, args, options, callback);
};

const serverPath = path.join(__dirname, 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

/*
 * EDITOR TEXT GEOMETRY — MuPDF character quads + real page bounds
 */
const replacement = `const textBoxes = [];
    try {
      const mupdf = await import('mupdf');
      const document = mupdf.Document.openDocument(bytes, 'application/pdf');
      try {
        for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex++) {
          const page = document.loadPage(pageIndex);
          const bounds = page.getBounds();
          const pageWidth = Math.max(1, bounds[2] - bounds[0]);
          const pageHeight = Math.max(1, bounds[3] - bounds[1]);
          const renderScale = 1100 / Math.max(pageWidth, pageHeight);
          let wordIndex = 0;
          let word = null;
          const finishWord = () => {
            if (!word || !word.text.trim()) { word = null; return; }
            const x = word.rect[0] - bounds[0];
            const y = word.rect[1] - bounds[1];
            const width = Math.max(0.5, word.rect[2] - word.rect[0]);
            const height = Math.max(0.5, word.rect[3] - word.rect[1]);
            textBoxes.push({ id: \`p\${pageIndex + 1}-w\${++wordIndex}\`, page: pageIndex + 1,
              x: x * renderScale, y: y * renderScale, width: width * renderScale, height: height * renderScale,
              pdfX: word.rect[0], pdfY: word.rect[1], pdfWidth: width, pdfHeight: height,
              text: word.text, fontSize: Math.max(4, word.size || height),
              pageWidthPx: pageWidth * renderScale, pageHeightPx: pageHeight * renderScale, renderScale });
            word = null;
          };
          page.toStructuredText('preserve-whitespace,preserve-spans').walk({
            onChar(c, _origin, font, size, quad) {
              const rect = [Math.min(quad[0], quad[2], quad[4], quad[6]), Math.min(quad[1], quad[3], quad[5], quad[7]),
                Math.max(quad[0], quad[2], quad[4], quad[6]), Math.max(quad[1], quad[3], quad[5], quad[7])];
              if (!word) word = { rect, text: '', font, size };
              else { word.rect[0]=Math.min(word.rect[0],rect[0]); word.rect[1]=Math.min(word.rect[1],rect[1]); word.rect[2]=Math.max(word.rect[2],rect[2]); word.rect[3]=Math.max(word.rect[3],rect[3]); }
              if (c === ' ' || c === '\\t') finishWord(); else word.text += c;
            },
            endLine() { finishWord(); }, endTextBlock() { finishWord(); }
          });
          finishWord(); page.destroy();
        }
      } finally { document.destroy(); }
    } catch (err) { console.error('Falha ao extrair geometria precisa:', err.message); }
    res.json({ fileId: finalName, pageCount, pageSizes, thumbnails, textBoxes });`;

const pattern = /const textBoxes = \\[];[\\s\\S]*?res\\.json\\(\\{ fileId: finalName, pageCount, pageSizes, thumbnails, textBoxes \\}\\);/;
if (pattern.test(source)) source = source.replace(pattern, replacement);

const serverModule = new Module(serverPath, module);
serverModule.filename = serverPath;
serverModule.paths = Module._nodeModulePaths(__dirname);

const ocrCall = `\nrequire(${JSON.stringify(path.join(__dirname, 'ocr-route.js'))})(app, { upload, UP, TMP, run, cleanup });\n`;
const pdfBoxCall = `\nrequire(${JSON.stringify(path.join(__dirname, 'pdfbox-route.js'))})(app, { UP, TMP });\n`;
const listenMarker = '\napp.listen(PORT, () => console.log(`PDFTools rodando na porta ${PORT}`));';
if (source.includes(listenMarker)) {
  source = source.replace(listenMarker, `${ocrCall}${pdfBoxCall}${listenMarker}`);
  console.log('PDFTools startup patch: OCR + Apache PDFBox native editor routes enabled.');
} else {
  console.warn('PDFTools startup patch: listen marker not found; auxiliary routes disabled.');
}

serverModule._compile(source, serverPath);
