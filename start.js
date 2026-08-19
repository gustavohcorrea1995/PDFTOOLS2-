const childProcess = require('child_process');
const fs = require('fs');
const Module = require('module');
const path = require('path');

// Poppler's -jpegopt is valid only for JPEG output.
// Keep the existing server implementation intact while normalizing
// PDF -> PNG arguments at process start.
const originalExecFile = childProcess.execFile;
childProcess.execFile = function patchedExecFile(command, args, options, callback) {
  if (command === 'pdftocairo' && Array.isArray(args)) {
    const normalized = [...args];
    const png = normalized.includes('-png');
    if (png) {
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

// pdftotext -bbox reports coordinates in PDF points from the top-left.
// The thumbnails are rendered by pdftocairo with -scale-to 1100, meaning
// each page has its own scale depending on its actual width/height.
// The old code used one fixed 1100/612 scale for every page, which caused
// the editor's text boxes to drift away from the real text.
const replacement = `const textBoxes = [];
    try {
      const bboxPath = path.join(previewDir, 'bbox.html');
      await run('pdftotext', ['-bbox', '-enc', 'UTF-8', input, bboxPath], { timeout: 120000 });
      const html = await fs.promises.readFile(bboxPath, 'utf8');
      const pages = [...html.matchAll(/<page[^>]*>([\\s\\S]*?)<\\/page>/gi)];

      pages.forEach((match, pageIndex) => {
        const pageSize = pageSizes[pageIndex] || { width: 612, height: 792 };
        const renderScale = 1100 / Math.max(pageSize.width, pageSize.height);

        const words = [...match[1].matchAll(
          /<word[^>]*xMin="([0-9.]+)"[^>]*yMin="([0-9.]+)"[^>]*xMax="([0-9.]+)"[^>]*yMax="([0-9.]+)"[^>]*>([\\s\\S]*?)<\\/word>/gi
        )];

        words.forEach((w, wordIndex) => {
          const text = w[5].replace(/<[^>]+>/g, '').trim();
          if (!text) return;

          const pdfX = parseFloat(w[1]);
          const pdfY = parseFloat(w[2]);
          const pdfWidth = Math.max(1, parseFloat(w[3]) - pdfX);
          const pdfHeight = Math.max(1, parseFloat(w[4]) - pdfY);

          textBoxes.push({
            id: \`p\${pageIndex + 1}-w\${wordIndex + 1}\`,
            page: pageIndex + 1,
            // These four display coordinates are now in the same pixel
            // coordinate system as the generated thumbnail.
            x: pdfX * renderScale,
            y: pdfY * renderScale,
            width: pdfWidth * renderScale,
            height: pdfHeight * renderScale,
            // Preserve PDF-space coordinates for the actual edit operation.
            pdfX,
            pdfY,
            pdfWidth,
            pdfHeight,
            fontSize: Math.max(6, pdfHeight * renderScale),
            pageWidthPx: pageSize.width * renderScale,
            pageHeightPx: pageSize.height * renderScale,
            renderScale
          });
        });
      });
    } catch (_) {}
    res.json({ fileId: finalName, pageCount, pageSizes, thumbnails, textBoxes });`;

const pattern = /const textBoxes = \[\];[\\s\\S]*?res\.json\(\{ fileId: finalName, pageCount, pageSizes, thumbnails, textBoxes \}\);/;

if (pattern.test(source)) {
  source = source.replace(pattern, replacement);
  console.log('PDFTools startup patch: editor coordinate mapping enabled.');
} else {
  console.warn('PDFTools startup patch: inspect block not found; starting original server.');
}

// Compile the patched server with /app/server.js as its filename so that
// __dirname and relative imports continue to behave exactly as before.
const serverModule = new Module(serverPath, module);
serverModule.filename = serverPath;
serverModule.paths = Module._nodeModulePaths(__dirname);
serverModule._compile(source, serverPath);
