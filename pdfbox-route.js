const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { v4: uuid } = require('uuid');

// Remove fisicamente o conteudo original das areas editadas usando a API de
// redacao nativa do MuPDF (geometrica, sem heuristica de casamento de texto -
// o mesmo mecanismo ja usado com sucesso no motor legado /api/edit/annotate).
// Sem este passo, "cobrir + desenhar por cima" deixa o texto original ainda
// selecionavel/copiavel por baixo do que foi desenhado.
async function redactRegions(inputPath, edits) {
  const mupdf = await import('mupdf');
  const document = mupdf.Document.openDocument(await fs.promises.readFile(inputPath), 'application/pdf');
  const pdf = document.asPDF();
  const pagesToRedact = new Set();
  try {
    for (const e of edits) {
      const pageIndex = Number(e.page) - 1;
      const x = Number(e.pdfX), y = Number(e.pdfY), w = Number(e.pdfWidth), h = Number(e.pdfHeight);
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.countPages()) continue;
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
      const page = pdf.loadPage(pageIndex);
      const bounds = page.getBounds();
      const pad = 1.5;
      const rect = [
        Math.max(bounds[0], x - pad), Math.max(bounds[1], y - pad),
        Math.min(bounds[2], x + w + pad), Math.min(bounds[3], y + h + pad),
      ];
      const redaction = page.createAnnotation('Redact');
      redaction.setRect(rect);
      redaction.update();
      pagesToRedact.add(pageIndex);
      page.destroy();
    }
    for (const index of pagesToRedact) {
      const page = pdf.loadPage(index);
      page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, mupdf.PDFPage.REDACT_TEXT_REMOVE);
      page.destroy();
    }
    return Buffer.from(pdf.saveToBuffer('garbage=4,compress=yes').asUint8Array());
  } finally {
    document.destroy();
  }
}

module.exports = function registerPdfBoxRoute(app, { UP, TMP }) {
  app.post('/api/edit/native', async (req, res) => {
    let manifest = null;
    let redactedInput = null;
    let output = null;
    try {
      const fileId = path.basename(String(req.body.fileId || ''));
      if (!/^[0-9a-f-]{36}\.pdf$/i.test(fileId)) return res.status(400).json({ error: 'Identificador de PDF inválido.' });
      const input = path.join(UP, fileId);
      if (!fs.existsSync(input)) return res.status(404).json({ error: 'PDF original não encontrado.' });
      const edits = Array.isArray(req.body.edits) ? req.body.edits : [];
      if (!edits.length || edits.length > 500) return res.status(400).json({ error: 'Nenhuma alteração válida foi enviada.' });

      manifest = path.join(TMP, `${uuid()}.tsv`);
      output = path.join(TMP, `${uuid()}.pdf`);
      const lines = [];
      const b64 = value => Buffer.from(String(value ?? ''), 'utf8').toString('base64');
      for (const e of edits) {
        const page=Number(e.page),x=Number(e.pdfX),y=Number(e.pdfY),w=Number(e.pdfWidth),h=Number(e.pdfHeight);
        if(!Number.isInteger(page)||page<1||![x,y,w,h].every(Number.isFinite))continue;
        const original=String(e.originalText??''),replacement=String(e.text??''),originalField=original||'__NEW__';
        lines.push([page,b64(originalField),b64(replacement),x,y,Math.max(.1,w),Math.max(.1,h),e.deleted===true,Math.max(4,Number(e.fontSize)||10),String(e.color||'#111111')].join('\t'));
      }
      if(!lines.length)return res.status(400).json({error:'As alterações não possuem coordenadas válidas.'});
      await fs.promises.writeFile(manifest,lines.join('\n'),'utf8');

      // 1) Remove de verdade o conteudo original de toda area editada
      //    (inclusive as que vao receber texto novo, nao so as excluidas -
      //    senao o texto antigo continuaria copiavel por baixo do novo).
      let engineInput = input;
      try {
        const redactedBytes = await redactRegions(input, edits);
        redactedInput = path.join(TMP, `${uuid()}.pdf`);
        await fs.promises.writeFile(redactedInput, redactedBytes);
        engineInput = redactedInput;
      } catch (redactErr) {
        console.error('Falha na redação real (MuPDF), seguindo apenas com cobertura visual:', redactErr.message);
      }

      // 2) Desenha o texto novo (com fonte/fundo detectados) sobre o PDF ja redigido.
      const java=process.env.JAVA_BIN||'java',jar=process.env.PDFBOX_JAR||'/opt/pdfbox/pdfbox-app-3.0.8.jar',engine=process.env.PDFBOX_ENGINE_JAR||'/opt/pdfbox/pdfbox-engine.jar';
      if(!fs.existsSync(jar)||!fs.existsSync(engine))throw new Error('Motor PDFBox não está instalado no servidor.');

      const stdout=await new Promise((resolve,reject)=>{
        execFile(java,['-Xms64m','-Xmx768m','-cp',`${engine}:${jar}`,'NativePdfEditor',engineInput,output,manifest],{timeout:240000,maxBuffer:8*1024*1024},(err,out,stderr)=>{
          if(err)return reject(new Error(`${err.message}${stderr?`: ${String(stderr).slice(0,2500)}`:''}`));
          console.log(`PDFBox native editor: ${String(out).trim()}`);resolve(String(out));
        });
      });

      if(!fs.existsSync(output))throw new Error('O motor PDFBox não gerou o PDF de saída.');
      const stat=await fs.promises.stat(output);if(!stat.size)throw new Error('O PDFBox retornou um arquivo vazio.');
      res.status(200).set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="PDFTools2-editado.pdf"','Content-Length':String(stat.size),'Cache-Control':'no-store,max-age=0','X-PDFTools-Engine':'MuPDF-redact+PDFBox-3.0.8-native'});
      fs.createReadStream(output).pipe(res);res.on('finish',()=>fs.rm(output,{force:true},()=>{}));
    }catch(e){if(output)fs.rm(output,{force:true},()=>{});if(!res.headersSent)res.status(500).json({error:e.message||'Falha no motor PDFBox.'});}
    finally{if(manifest)fs.rm(manifest,{force:true},()=>{});if(redactedInput)fs.rm(redactedInput,{force:true},()=>{});}
  });
};
