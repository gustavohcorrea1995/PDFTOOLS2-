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

/*
 * EDITOR TEXT GEOMETRY
 *
 * Do not rely on the order of xMin/yMin/xMax/yMax attributes emitted by
 * Poppler. Different Poppler versions can serialize the attributes in a
 * different order. The old regex assumed one exact order and silently lost
 * words that did not match it.
 *
 * We also use -bbox-layout. It gives us every extracted <word> while keeping
 * the page boundaries. For selectable PDF text this is the authoritative
 * text geometry available from Poppler.
 *
 * The preview is rendered with pdftocairo -scale-to 1100. Each page gets its
 * own render scale: 1100 / max(pageWidth, pageHeight). This makes the PDF
 * coordinates and preview pixels share the same coordinate system before the
 * browser applies its responsive CSS scale.
 */
const replacement = `const textBoxes = [];
    try {
      const bboxPath = path.join(previewDir, 'bbox.html');
      await run('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', input, bboxPath], { timeout: 120000 });
      const html = await fs.promises.readFile(bboxPath, 'utf8');
      const pages = [...html.matchAll(/<page\\b[^>]*>([\\s\\S]*?)<\\/page>/gi)];

      const decodeText = (value) => String(value || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '\"')
        .replace(/&#39;/g, "'")
        .replace(/\\s+/g, ' ')
        .trim();

      const attr = (attrs, name) => {
        const match = String(attrs || '').match(new RegExp('\\\\b' + name + '\\\\s*=\\\\s*[\\\"\\\\\']([^\\\"\\\\\']+)[\\\"\\\\\']', 'i'));
        return match ? Number(match[1]) : NaN;
      };

      pages.forEach((match, pageIndex) => {
        const pageSize = pageSizes[pageIndex] || { width: 612, height: 792 };
        const renderScale = 1100 / Math.max(pageSize.width, pageSize.height);
        const pageMarkup = match[1];

        const wordMatches = [...pageMarkup.matchAll(/<word\\b([^>]*)>([\\s\\S]*?)<\\/word>/gi)];
        let wordIndex = 0;

        wordMatches.forEach((wordMatch) => {
          const attrs = wordMatch[1];
          const text = decodeText(wordMatch[2]);
          if (!text) return;

          const pdfX = attr(attrs, 'xMin');
          const pdfY = attr(attrs, 'yMin');
          const pdfXMax = attr(attrs, 'xMax');
          const pdfYMax = attr(attrs, 'yMax');

          if (![pdfX, pdfY, pdfXMax, pdfYMax].every(Number.isFinite)) return;
          if (pdfXMax <= pdfX || pdfYMax <= pdfY) return;

          const pdfWidth = Math.max(0.5, pdfXMax - pdfX);
          const pdfHeight = Math.max(0.5, pdfYMax - pdfY);
          wordIndex += 1;

          textBoxes.push({
            id: \`p\${pageIndex + 1}-w\${wordIndex}\`,
            page: pageIndex + 1,
            // Preview-space coordinates.
            x: pdfX * renderScale,
            y: pdfY * renderScale,
            width: pdfWidth * renderScale,
            height: pdfHeight * renderScale,
            // Original PDF coordinates used when saving the edit.
            pdfX,
            pdfY,
            pdfWidth,
            pdfHeight,
            text,
            fontSize: Math.max(4, pdfHeight * renderScale),
            pageWidthPx: pageSize.width * renderScale,
            pageHeightPx: pageSize.height * renderScale,
            renderScale
          });
        });
      });
    } catch (err) {
      console.error('Falha ao extrair geometria de texto do PDF:', err.message);
    }
    res.json({ fileId: finalName, pageCount, pageSizes, thumbnails, textBoxes });`;

const pattern = /const textBoxes = \\[];[\\s\\S]*?res\\.json\\(\\{ fileId: finalName, pageCount, pageSizes, thumbnails, textBoxes \\}\\);/;

if (pattern.test(source)) {
  source = source.replace(pattern, replacement);
  console.log('PDFTools startup patch: precise text geometry enabled.');
} else {
  console.warn('PDFTools startup patch: inspect block not found; starting original server.');
}

const serverModule = new Module(serverPath, module);
serverModule.filename = serverPath;
serverModule.paths = Module._nodeModulePaths(__dirname);
serverModule._compile(source, serverPath);
