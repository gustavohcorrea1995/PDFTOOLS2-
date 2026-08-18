const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const archiver = require('archiver');
const { execFile } = require('child_process');
const { PDFDocument, degrees, rgb, StandardFonts } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

const UP = path.join(__dirname, 'uploads');
const TMP = path.join(__dirname, 'tmp');
[UP, TMP].forEach(d => fs.mkdirSync(d, { recursive: true }));

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UP),
    filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname))
  }),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});

// ---------- helpers ----------

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 200 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function cleanup(...files) {
  files.forEach(f => {
    if (!f) return;
    fs.rm(f, { recursive: true, force: true }, () => {});
  });
}

function parseRanges(str, pageCount) {
  // "1-3,5,7-8" -> array of arrays of 0-indexed page numbers, one group per PDF output
  return str.split(',').map(s => s.trim()).filter(Boolean).map(part => {
    const [a, b] = part.split('-').map(n => parseInt(n, 10));
    const start = Math.max(1, a);
    const end = Math.min(pageCount, b || a);
    const arr = [];
    for (let i = start; i <= end; i++) arr.push(i - 1);
    return arr;
  });
}

async function sendFileAndCleanup(res, filePath, downloadName, extraFiles = []) {
  try {
    // Envia o PDF diretamente na resposta antes de apagar o temporário.
    // Isso evita falhas de download no Render causadas pelo res.download()
    // enquanto o arquivo temporário é removido.
    const data = await fs.promises.readFile(filePath);

    res.status(200);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    });

    res.end(data);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    cleanup(filePath, ...extraFiles);
  }
}

// ---------- MERGE ----------
app.post('/api/merge', upload.array('files'), async (req, res) => {
  const inputs = req.files.map(f => f.path);
  try {
    const merged = await PDFDocument.create();
    for (const file of req.files) {
      const bytes = fs.readFileSync(file.path);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const outBytes = await merged.save();
    const outPath = path.join(TMP, uuid() + '.pdf');
    fs.writeFileSync(outPath, outBytes);
    sendFileAndCleanup(res, outPath, 'unido.pdf', inputs);
  } catch (e) {
    cleanup(...inputs);
    res.status(500).json({ error: e.message });
  }
});

// ---------- SPLIT ----------
app.post('/api/split', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  try {
    const bytes = fs.readFileSync(inputPath);
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();
    const ranges = req.body.ranges
      ? parseRanges(req.body.ranges, pageCount)
      : src.getPageIndices().map(i => [i]); // no ranges = one PDF per page

    const zipPath = path.join(TMP, uuid() + '.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');
    archive.pipe(output);

    for (let i = 0; i < ranges.length; i++) {
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, ranges[i]);
      pages.forEach(p => doc.addPage(p));
      const outBytes = await doc.save();
      archive.append(Buffer.from(outBytes), { name: `parte_${i + 1}.pdf` });
    }
    await archive.finalize();
    output.on('close', () => sendFileAndCleanup(res, zipPath, 'partes.zip', [inputPath]));
  } catch (e) {
    cleanup(inputPath);
    res.status(500).json({ error: e.message });
  }
});

// ---------- PAGE OPS: delete / rotate / reorder ----------
app.post('/api/pages/edit', upload.single('file'), async (req, res) => {
  // body: operations = JSON { keepOrder: [1,3,2], rotations: {"1": 90}, delete: [4] }
  const inputPath = req.file.path;
  try {
    const bytes = fs.readFileSync(inputPath);
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();
    const ops = JSON.parse(req.body.operations || '{}');
    const deleteSet = new Set((ops.delete || []).map(n => n - 1));
    let order = ops.keepOrder ? ops.keepOrder.map(n => n - 1) : src.getPageIndices();
    order = order.filter(i => !deleteSet.has(i));

    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, order);
    pages.forEach((p, idx) => {
      const originalPageNum = order[idx] + 1;
      const rot = ops.rotations && ops.rotations[originalPageNum];
      if (rot) p.setRotation(degrees((p.getRotation().angle + rot) % 360));
      out.addPage(p);
    });
    const outBytes = await out.save();
    const outPath = path.join(TMP, uuid() + '.pdf');
    fs.writeFileSync(outPath, outBytes);
    sendFileAndCleanup(res, outPath, 'editado.pdf', [inputPath]);
  } catch (e) {
    cleanup(inputPath);
    res.status(500).json({ error: e.message });
  }
});

// ---------- COMPRESS (ghostscript) ----------
app.post('/api/compress', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const level = req.body.level || 'ebook'; // screen | ebook | printer
  const outPath = path.join(TMP, uuid() + '.pdf');
  try {
    await run('gs', [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=/${level}`,
      '-dNOPAUSE', '-dQUIET', '-dBATCH',
      `-sOutputFile=${outPath}`, inputPath
    ]);
    sendFileAndCleanup(res, outPath, 'comprimido.pdf', [inputPath]);
  } catch (e) {
    cleanup(inputPath, outPath);
    res.status(500).json({ error: e.message });
  }
});

// ---------- CONVERT: images -> pdf ----------
app.post('/api/convert/images-to-pdf', upload.array('files'), async (req, res) => {
  const inputs = req.files.map(f => f.path);
  try {
    const sharp = require('sharp');
    const doc = await PDFDocument.create();
    for (const file of req.files) {
      const buf = await sharp(file.path).jpeg({ quality: 90 }).toBuffer();
      const img = await doc.embedJpg(buf);
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const outBytes = await doc.save();
    const outPath = path.join(TMP, uuid() + '.pdf');
    fs.writeFileSync(outPath, outBytes);
    sendFileAndCleanup(res, outPath, 'imagens.pdf', inputs);
  } catch (e) {
    cleanup(...inputs);
    res.status(500).json({ error: e.message });
  }
});

// ---------- CONVERT: pdf -> images (poppler) ----------
app.post('/api/convert/pdf-to-images', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const format = (req.body.format || 'png').toLowerCase();
  const workDir = path.join(TMP, uuid());
  fs.mkdirSync(workDir);
  try {
    const flag = format === 'jpg' || format === 'jpeg' ? '-jpeg' : '-png';
    await run('pdftoppm', [flag, '-r', '150', inputPath, path.join(workDir, 'page')]);
    const zipPath = path.join(TMP, uuid() + '.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');
    archive.pipe(output);
    fs.readdirSync(workDir).forEach(f => archive.file(path.join(workDir, f), { name: f }));
    await archive.finalize();
    output.on('close', () => sendFileAndCleanup(res, zipPath, 'paginas.zip', [inputPath, workDir]));
  } catch (e) {
    cleanup(inputPath, workDir);
    res.status(500).json({ error: e.message });
  }
});

// ---------- CONVERT: office <-> pdf (LibreOffice headless) ----------
app.post('/api/convert/office', upload.single('file'), async (req, res) => {
  // target: pdf | docx | pptx | xlsx | odt
  const inputPath = req.file.path;
  const target = (req.body.target || 'pdf').toLowerCase();
  const workDir = path.join(TMP, uuid());
  fs.mkdirSync(workDir);
  try {
    const args = ['--headless', '--norestore'];
    // Converting FROM pdf TO an editable format needs an explicit import filter,
    // otherwise LibreOffice can't find an export chain and silently fails.
    if (path.extname(inputPath).toLowerCase() === '.pdf' && target !== 'pdf') {
      args.push('--infilter=writer_pdf_import');
    }
    args.push('--convert-to', target, '--outdir', workDir, inputPath);
    await run('soffice', args);
    const produced = fs.readdirSync(workDir)[0];
    if (!produced) throw new Error('A conversão não gerou saída. Verifique o formato do arquivo.');
    const outPath = path.join(workDir, produced);
    sendFileAndCleanup(res, outPath, produced, [inputPath, workDir]);
  } catch (e) {
    cleanup(inputPath, workDir);
    res.status(500).json({ error: e.message });
  }
});

// ---------- INSPECT: page count + thumbnails for the editor ----------
app.post('/api/inspect', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  let doc = null;
  try {
    const bytes = fs.readFileSync(inputPath);
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();
    const pageSizes = src.getPages().map(p => {
      const { width, height } = p.getSize();
      return { width, height };
    });

    const id = uuid();
    const finalName = id + '.pdf';
    fs.copyFileSync(inputPath, path.join(UP, finalName));

    // O editor usa uma prévia rasterizada a 120 DPI. As imagens são
    // devolvidas como data URLs para que o navegador não precise fazer
    // uma segunda requisição ao armazenamento temporário do Render.
    const previewDir = path.join(UP, 'thumbs_' + id);
    fs.mkdirSync(previewDir, { recursive: true });

    await run('pdftoppm', [
      '-jpeg',
      '-jpegopt', 'quality=82',
      '-r', '120',
      inputPath,
      path.join(previewDir, 'page')
    ]);

    const files = fs.readdirSync(previewDir)
      .filter(f => /^page-\d+\.jpg$/i.test(f))
      .sort((a,b) => {
        const na = Number(a.match(/(\d+)/)[1]);
        const nb = Number(b.match(/(\d+)/)[1]);
        return na - nb;
      });

    const thumbnails = files.map(file => {
      const jpg = fs.readFileSync(path.join(previewDir, file));
      return 'data:image/jpeg;base64,' + jpg.toString('base64');
    });

    // Coordenadas dos textos em pontos (72 DPI), com origem no topo.
    // O pdftotext -bbox fornece exatamente esse sistema de coordenadas.
    const textBoxes = [];
    try {
      const bboxPath = path.join(previewDir, 'bbox.html');
      await run('pdftotext', [
        '-bbox', '-enc', 'UTF-8', inputPath, bboxPath
      ]);
      const html = fs.readFileSync(bboxPath, 'utf8');
      const pages = [...html.matchAll(/<page[^>]*>([\s\S]*?)<\/page>/gi)];
      const PT_TO_PX = 120 / 72;

      pages.forEach((pageMatch, pageIndex) => {
        const words = [...pageMatch[1].matchAll(
          /<word[^>]*xMin="([0-9.]+)"[^>]*yMin="([0-9.]+)"[^>]*xMax="([0-9.]+)"[^>]*yMax="([0-9.]+)"[^>]*>([\s\S]*?)<\/word>/gi
        )];

        words.forEach((w, wordIndex) => {
          const text = w[5].replace(/<[^>]+>/g, '').trim();
          if(!text) return;

          const pdfX = parseFloat(w[1]);
          const pdfY = parseFloat(w[2]);
          const pdfWidth = Math.max(1, parseFloat(w[3]) - pdfX);
          const pdfHeight = Math.max(1, parseFloat(w[4]) - pdfY);

          textBoxes.push({
            id: `p${pageIndex + 1}-w${wordIndex + 1}`,
            page: pageIndex + 1,
            x: pdfX * PT_TO_PX,
            y: pdfY * PT_TO_PX,
            width: pdfWidth * PT_TO_PX,
            height: pdfHeight * PT_TO_PX,
            pdfX, pdfY, pdfWidth, pdfHeight,
            text,
            fontSize: Math.max(6, pdfHeight)
          });
        });
      });
    } catch(err) {
      console.log('PDF sem camada de texto ou falha na extração:', err.message);
    }

    res.json({ fileId: finalName, pageCount, pageSizes, thumbnails, textBoxes });

    // A prévia já foi enviada como data URL; depois da resposta podemos
    // remover as imagens temporárias sem quebrar o navegador.
    cleanup(previewDir);
  } catch(e) {
    console.error('Erro no /api/inspect:', e);
    res.status(500).json({ error: e.message });
  } finally {
    cleanup(inputPath);
  }
});

// ---------- PREVIEW: entrega as páginas renderizadas do editor ----------
app.get('/api/preview/:id/:page', (req, res) => {
  try {
    const id = req.params.id.replace(/\.pdf$/i, '');
    const page = Number(req.params.page);

    if(!Number.isInteger(page) || page < 1){
      return res.status(400).send('Página inválida.');
    }

    const filePath = path.join(
      UP,
      'thumbs_' + id,
      `p-${page}.png`
    );

    if(!fs.existsSync(filePath)){
      return res.status(404).send('Página do PDF não encontrada.');
    }

    res.type('png').sendFile(path.resolve(filePath));
  } catch(e) {
    res.status(500).send(e.message);
  }
});

app.use('/uploads', express.static(UP));

// ---------- EDIT: add text / image overlay ----------
app.post('/api/edit/annotate', upload.single('image'), async (req, res) => {
  try {
    const { fileId, annotations } = req.body;
    const filePath = path.join(UP, fileId);

    if(!fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'Arquivo não encontrado. Reenvie o PDF.' });
    }

    const anns = JSON.parse(annotations || '[]');
    const originalBytes = fs.readFileSync(filePath);

    // ================================================================
    // 1) REDAÇÃO REAL / IRREVERSÍVEL COM MUPDF
    // ================================================================
    // MuPDF trabalha em pontos com origem no canto superior esquerdo,
    // que é o mesmo sistema usado pelos boxes extraídos pelo pdftotext.
    // Assim não existe a conversão pixels -> pontos que estava causando
    // deslocamentos nas versões anteriores.
    const mupdf = await import('mupdf');
    const document = mupdf.Document.openDocument(originalBytes, 'application/pdf');
    const pdfDoc = document.asPDF();
    const redactedPages = new Set();

    try {
      for(const a of anns) {
        if(!a || !a.id || !String(a.id).startsWith('p')) continue;
        if(a.deleted !== true && a.text === undefined) continue;

        const pageIndex = Number(a.page) - 1;
        if(!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDoc.countPages()) continue;

        const x = Number(a.pdfX ?? a.x);
        const y = Number(a.pdfY ?? a.y);
        const w = Number(a.pdfWidth ?? a.width);
        const h = Number(a.pdfHeight ?? a.height);

        if(![x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0) continue;

        const page = pdfDoc.loadPage(pageIndex);
        const bounds = page.getBounds();
        const pad = 1.5;
        const x1 = Math.max(bounds[0], x - pad);
        const y1 = Math.max(bounds[1], y - pad);
        const x2 = Math.min(bounds[2], x + w + pad);
        const y2 = Math.min(bounds[3], y + h + pad);

        if(x2 > x1 && y2 > y1) {
          const redact = page.createAnnotation('Redact');
          redact.setRect([x1, y1, x2, y2]);
          redact.update();
          redactedPages.add(pageIndex);
        }
        page.destroy();
      }

      // Remove permanentemente texto, pixels de imagens e line art
      // cobertos pela região redigida.
      for(const pageIndex of redactedPages) {
        const page = pdfDoc.loadPage(pageIndex);
        page.applyRedactions(
          false,
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE
        );
        page.destroy();
      }

      // garbage=4 evita deixar objetos órfãos da versão anterior do PDF.
      var redactedBytes = Buffer.from(
        pdfDoc.saveToBuffer('garbage=4,compress=yes').asUint8Array()
      );
    } finally {
      document.destroy();
    }

    // ================================================================
    // 2) APARÊNCIA FINAL E TEXTO DE SUBSTITUIÇÃO
    // ================================================================
    // A redação já aconteceu acima. A caixa branca abaixo é apenas visual;
    // o conteúdo antigo já não existe no PDF.
    const outDoc = await PDFDocument.load(redactedBytes, { ignoreEncryption: true });
    const font = await outDoc.embedFont(StandardFonts.Helvetica);

    for(const a of anns) {
      if(!a || !a.id || !String(a.id).startsWith('p')) continue;

      const page = outDoc.getPage(Number(a.page) - 1);
      if(!page) continue;

      const pageHeight = page.getHeight();
      const x = Number(a.pdfX ?? a.x) || 0;
      const y = Number(a.pdfY ?? a.y) || 0;
      const w = Number(a.pdfWidth ?? a.width) || 20;
      const h = Number(a.pdfHeight ?? a.height) || 12;
      const fontSize = Math.max(4, Math.min(Number(a.fontSize) || h, h));
      const pad = 1.5;

      page.drawRectangle({
        x: Math.max(0, x - pad),
        y: Math.max(0, pageHeight - y - h - pad),
        width: w + pad * 2,
        height: h + pad * 2,
        color: rgb(1,1,1),
        borderWidth: 0
      });

      if(a.deleted !== true && String(a.text || '').length) {
        page.drawText(String(a.text), {
          x,
          y: pageHeight - y - fontSize,
          size: fontSize,
          font,
          color: rgb(0.1,0.1,0.1),
          maxWidth: Math.max(10, w)
        });
      }
    }

    // Limpa metadados comuns para evitar que informações antigas continuem
    // expostas por propriedades do documento.
    try {
      outDoc.setTitle('');
      outDoc.setAuthor('');
      outDoc.setSubject('');
      outDoc.setKeywords([]);
    } catch(_) {}

    const outBytes = await outDoc.save({ useObjectStreams: false });
    const outPath = path.join(TMP, uuid() + '.pdf');
    fs.writeFileSync(outPath, outBytes);

    sendFileAndCleanup(res, outPath, 'editado.pdf', req.file ? [req.file.path] : []);
  } catch(e) {
    console.error('Erro na edição/redação:', e);
    if(req.file?.path) cleanup(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`PDFTools rodando em http://localhost:${PORT}`));
