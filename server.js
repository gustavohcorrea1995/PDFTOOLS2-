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
const PORT = process.env.PORT || 10000;
const UP = path.join(__dirname, 'uploads');
const TMP = path.join(__dirname, 'tmp');
[UP, TMP].forEach(d => fs.mkdirSync(d, { recursive: true }));

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));

const ALLOWED_EXT = new Set(['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.jpg','.jpeg','.png','.webp','.gif','.bmp','.tif','.tiff']);
const MAX_FILE_SIZE = 200 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req,file,cb)=>cb(null,UP),
    filename: (req,file,cb)=>cb(null,uuid()+path.extname(file.originalname||'').toLowerCase())
  }),
  limits:{fileSize:MAX_FILE_SIZE,files:50,fields:20,parts:70},
  fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname||'').toLowerCase();if(!ALLOWED_EXT.has(ext))return cb(new Error(`Tipo de arquivo não permitido: ${ext||'sem extensão'}.`));cb(null,true);}
});
function run(cmd,args,options={}){return new Promise((resolve,reject)=>{execFile(cmd,args,{maxBuffer:20*1024*1024,timeout:options.timeout||180000,windowsHide:true},(err,stdout,stderr)=>{if(err){const detail=String(stderr||'').trim();reject(new Error(detail?`${err.message}: ${detail.slice(0,2500)}`:err.message));}else resolve(stdout);});});}
function cleanup(...files){files.filter(Boolean).forEach(file=>fs.rm(file,{recursive:true,force:true},()=>{}));}
function validatePdf(file){if(!file)throw new Error('Nenhum arquivo foi enviado.');if(path.extname(file.originalname||'').toLowerCase()!=='.pdf')throw new Error('Este recurso aceita somente PDF.');}
function safeFileId(fileId){const name=path.basename(String(fileId||''));if(!/^[0-9a-f-]{36}\.pdf$/i.test(name))throw new Error('Identificador de arquivo inválido.');return name;}
function parseRanges(str,pageCount){if(!String(str||'').trim())return [];return String(str).split(',').map(raw=>{const part=raw.trim();const m=part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw new Error(`Intervalo inválido: ${part}`);const start=Number(m[1]);const end=Number(m[2]||m[1]);if(start<1||end<start||start>pageCount)throw new Error(`Página inválida no intervalo: ${part}`);const arr=[];for(let p=start;p<=Math.min(end,pageCount);p++)arr.push(p-1);return arr;});}
async function sendFile(res,filePath,downloadName,extra=[],contentType='application/octet-stream',headers={}){try{const stat=await fs.promises.stat(filePath);res.status(200).set({'Content-Type':contentType,'Content-Disposition':`attachment; filename="${String(downloadName).replace(/"/g,'')}"`,'Content-Length':String(stat.size),'Cache-Control':'no-store, max-age=0',...headers});fs.createReadStream(filePath).pipe(res);res.on('finish',()=>cleanup(filePath,...extra));}catch(err){cleanup(filePath,...extra);if(!res.headersSent)res.status(500).json({error:err.message});}}
function waitForStreamClose(stream){return new Promise((resolve,reject)=>{stream.once('close',resolve);stream.once('error',reject);});}
async function makeZipFromDir(dir,zipPath){const output=fs.createWriteStream(zipPath);const archive=archiver('zip',{zlib:{level:6}});const done=waitForStreamClose(output);archive.on('error',err=>output.destroy(err));archive.pipe(output);for(const file of fs.readdirSync(dir).filter(Boolean))archive.file(path.join(dir,file),{name:file});await archive.finalize();await done;}
async function purgeOldFiles(){const cutoff=Date.now()-2*60*60*1000;for(const dir of [UP,TMP]){let entries=[];try{entries=await fs.promises.readdir(dir,{withFileTypes:true});}catch(_){continue;}await Promise.all(entries.map(async entry=>{const full=path.join(dir,entry.name);try{const stat=await fs.promises.stat(full);if(stat.mtimeMs<cutoff)await fs.promises.rm(full,{recursive:true,force:true});}catch(_){}}));}}
setInterval(()=>purgeOldFiles().catch(()=>{}),30*60*1000).unref();purgeOldFiles().catch(()=>{});

app.post('/api/merge',upload.array('files',50),async(req,res)=>{const inputs=(req.files||[]).map(f=>f.path);try{if(inputs.length<2)throw new Error('Selecione pelo menos 2 PDFs.');req.files.forEach(validatePdf);const out=await PDFDocument.create();for(const file of req.files){const src=await PDFDocument.load(await fs.promises.readFile(file.path),{ignoreEncryption:true});const pages=await out.copyPages(src,src.getPageIndices());pages.forEach(p=>out.addPage(p));}const outPath=path.join(TMP,uuid()+'.pdf');await fs.promises.writeFile(outPath,await out.save());await sendFile(res,outPath,'unido.pdf',inputs,'application/pdf');}catch(e){cleanup(...inputs);if(!res.headersSent)res.status(500).json({error:e.message});}});
app.post('/api/split',upload.single('file'),async(req,res)=>{const input=req.file?.path;try{validatePdf(req.file);const src=await PDFDocument.load(await fs.promises.readFile(input),{ignoreEncryption:true});const ranges=parseRanges(req.body.ranges,src.getPageCount());const groups=ranges.length?ranges:src.getPageIndices().map(i=>[i]);if(groups.length>100)throw new Error('Limite de 100 partes por operação.');const zipPath=path.join(TMP,uuid()+'.zip');const output=fs.createWriteStream(zipPath);const archive=archiver('zip',{zlib:{level:6}});const done=waitForStreamClose(output);archive.on('error',err=>output.destroy(err));archive.pipe(output);for(let i=0;i<groups.length;i++){const doc=await PDFDocument.create();const pages=await doc.copyPages(src,groups[i]);pages.forEach(p=>doc.addPage(p));archive.append(Buffer.from(await doc.save()),{name:`parte_${i+1}.pdf`});}await archive.finalize();await done;await sendFile(res,zipPath,'partes.zip',[input],'application/zip');}catch(e){cleanup(input);if(!res.headersSent)res.status(500).json({error:e.message});}});
app.post('/api/pages/edit',upload.single('file'),async(req,res)=>{const input=req.file?.path;try{validatePdf(req.file);const src=await PDFDocument.load(await fs.promises.readFile(input),{ignoreEncryption:true});const ops=JSON.parse(req.body.operations||'{}');const pageCount=src.getPageCount();let order=Array.isArray(ops.keepOrder)?ops.keepOrder.map(Number).map(n=>n-1):src.getPageIndices();const deleted=new Set((Array.isArray(ops.delete)?ops.delete:[]).map(Number).map(n=>n-1));if(order.some(i=>!Number.isInteger(i)||i<0||i>=pageCount))throw new Error('Ordem de páginas inválida.');order=order.filter(i=>!deleted.has(i));if(!order.length)throw new Error('O PDF final precisa ter pelo menos uma página.');const out=await PDFDocument.create();const pages=await out.copyPages(src,order);pages.forEach((page,idx)=>{const original=order[idx]+1;const rotation=Number(ops.rotations?.[original]||0);if(rotation)page.setRotation(degrees((page.getRotation().angle+rotation)%360));out.addPage(page);});const outPath=path.join(TMP,uuid()+'.pdf');await fs.promises.writeFile(outPath,await out.save());await sendFile(res,outPath,'editado.pdf',[input],'application/pdf');}catch(e){cleanup(input);if(!res.headersSent)res.status(500).json({error:e.message});}});
app.post('/api/compress',upload.single('file'),async(req,res)=>{const input=req.file?.path;const output=path.join(TMP,uuid()+'.pdf');try{validatePdf(req.file);const level=String(req.body.level||'ebook').toLowerCase();if(!['screen','ebook','printer','prepress','default'].includes(level))throw new Error('Nível de compressão inválido.');const originalSize=(await fs.promises.stat(input)).size;await run('gs',['-sDEVICE=pdfwrite','-dCompatibilityLevel=1.4',`-dPDFSETTINGS=/${level}`,'-dNOPAUSE','-dQUIET','-dBATCH',`-sOutputFile=${output}`,input],{timeout:240000});const compressedSize=(await fs.promises.stat(output)).size;const reduction=originalSize?Math.max(0,(1-compressedSize/originalSize)*100):0;await sendFile(res,output,'comprimido.pdf',[input],'application/pdf',{'X-Original-Size':String(originalSize),'X-Compressed-Size':String(compressedSize),'X-Compression-Percent':reduction.toFixed(2)});}catch(e){cleanup(input,output);if(!res.headersSent)res.status(500).json({error:e.message});}});
app.post('/api/convert/images-to-pdf',upload.array('files',50),async(req,res)=>{const inputs=(req.files||[]).map(f=>f.path);try{if(!req.files.length)throw new Error('Selecione pelo menos uma imagem.');const doc=await PDFDocument.create();const allowed=new Set(['.jpg','.jpeg','.png','.webp','.gif','.bmp','.tif','.tiff']);for(const file of req.files){if(!allowed.has(path.extname(file.originalname||'').toLowerCase()))throw new Error(`Imagem inválida: ${file.originalname}`);const sharp=require('sharp');const buf=await sharp(file.path).jpeg({quality:90,mozjpeg:true}).toBuffer();const img=await doc.embedJpg(buf);const page=doc.addPage([img.width,img.height]);page.drawImage(img,{x:0,y:0,width:img.width,height:img.height});}const outPath=path.join(TMP,uuid()+'.pdf');await fs.promises.writeFile(outPath,await doc.save());await sendFile(res,outPath,'imagens.pdf',inputs,'application/pdf');}catch(e){cleanup(...inputs);if(!res.headersSent)res.status(500).json({error:e.message});}});
app.post('/api/convert/pdf-to-images',upload.single('file'),async(req,res)=>{const input=req.file?.path;const workDir=path.join(TMP,uuid());try{validatePdf(req.file);const format=String(req.body.format||'png').toLowerCase();if(!['png','jpg','jpeg'].includes(format))throw new Error('Formato de imagem inválido.');await fs.promises.mkdir(workDir,{recursive:true});const flag=format==='png'?'-png':'-jpeg';await run('pdftocairo',[flag,'-r','150','-jpegopt','quality=88',input,path.join(workDir,'pagina')],{timeout:240000});const files=fs.readdirSync(workDir).filter(f=>/\.(png|jpg|jpeg)$/i.test(f)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));if(!files.length)throw new Error('Nenhuma página foi convertida.');const zipPath=path.join(TMP,uuid()+'.zip');await makeZipFromDir(workDir,zipPath);await sendFile(res,zipPath,'paginas.zip',[input,workDir],'application/zip');}catch(e){cleanup(input,workDir);if(!res.headersSent)res.status(500).json({error:e.message});}});
app.post('/api/convert/office',upload.single('file'),async(req,res)=>{const input=req.file?.path;const workDir=path.join(TMP,uuid());try{if(!req.file)throw new Error('Nenhum arquivo foi enviado.');const target=String(req.body.target||'pdf').toLowerCase();if(!['pdf','docx','pptx','xlsx','odt'].includes(target))throw new Error('Formato de saída inválido.');await fs.promises.mkdir(workDir,{recursive:true});const args=['--headless','--norestore','--nolockcheck','--nodefault','--nofirststartwizard'];const ext=path.extname(input).toLowerCase();if(ext==='.pdf'&&target!=='pdf')args.push('--infilter=writer_pdf_import');args.push('--convert-to',target,'--outdir',workDir,input);await run('soffice',args,{timeout:240000});const produced=fs.readdirSync(workDir).filter(f=>!f.startsWith('.~lock')).filter(f=>fs.statSync(path.join(workDir,f)).isFile());if(!produced.length)throw new Error('A conversão não gerou saída. Verifique o formato do arquivo e os logs do servidor.');const outName=produced[0];const outPath=path.join(workDir,outName);const mime=target==='pdf'?'application/pdf':'application/octet-stream';await sendFile(res,outPath,outName,[input,workDir],mime);}catch(e){cleanup(input,workDir);if(!res.headersSent)res.status(500).json({error:e.message});}});

app.post('/api/inspect',upload.single('file'),async(req,res)=>{const input=req.file?.path;let previewDir=null;let finalName=null;try{validatePdf(req.file);const bytes=await fs.promises.readFile(input);const src=await PDFDocument.load(bytes,{ignoreEncryption:true});const pageCount=src.getPageCount();const pageSizes=src.getPages().map(p=>{const s=p.getSize();return{width:s.width,height:s.height};});const id=uuid();finalName=id+'.pdf';await fs.promises.copyFile(input,path.join(UP,finalName));previewDir=path.join(TMP,'thumbs_'+id);await fs.promises.mkdir(previewDir,{recursive:true});await run('pdftocairo',['-jpeg','-jpegopt','quality=76','-scale-to','1100',input,path.join(previewDir,'page')],{timeout:240000});const files=fs.readdirSync(previewDir).filter(f=>/^page-\d+\.jpg$/i.test(f)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));const thumbnails=files.map(f=>'data:image/jpeg;base64,'+fs.readFileSync(path.join(previewDir,f)).toString('base64'));const textBoxes=[];try{const bboxPath=path.join(previewDir,'bbox.html');await run('pdftotext',['-bbox','-enc','UTF-8',input,bboxPath],{timeout:120000});const html=await fs.promises.readFile(bboxPath,'utf8');const pages=[...html.matchAll(/<page[^>]*>([\s\S]*?)<\/page>/gi)];pages.forEach((match,pageIndex)=>{const words=[...match[1].matchAll(/<word[^>]*xMin="([0-9.]+)"[^>]*yMin="([0-9.]+)"[^>]*xMax="([0-9.]+)"[^>]*yMax="([0-9.]+)"[^>]*>([\s\S]*?)<\/word>/gi)];words.forEach((w,wordIndex)=>{const text=w[5].replace(/<[^>]+>/g,'').trim();if(!text)return;const pdfX=parseFloat(w[1]),pdfY=parseFloat(w[2]);const pdfWidth=Math.max(1,parseFloat(w[3])-pdfX),pdfHeight=Math.max(1,parseFloat(w[4])-pdfY);textBoxes.push({id:`p${pageIndex+1}-w${wordIndex+1}`,page:pageIndex+1,x:pdfX,y:pdfY,width:pdfWidth,height:pdfHeight,pdfX,pdfY,pdfWidth,pdfHeight,text,fontSize:Math.max(6,pdfHeight)});});});}catch(_){}res.json({fileId:finalName,pageCount,pageSizes,thumbnails,textBoxes});}catch(e){cleanup(finalName?path.join(UP,finalName):null);if(!res.headersSent)res.status(500).json({error:e.message});}finally{cleanup(input,previewDir);}});
app.get('/api/preview/:id/:page',async(req,res)=>{let dir=null;try{const id=safeFileId(req.params.id);const page=Number(req.params.page);if(!Number.isInteger(page)||page<1)return res.status(400).send('Página inválida.');const pdfPath=path.join(UP,id);if(!fs.existsSync(pdfPath))return res.status(404).send('PDF não encontrado.');dir=path.join(TMP,uuid());await fs.promises.mkdir(dir,{recursive:true});const prefix=path.join(dir,'page');await run('pdftocairo',['-f',String(page),'-l',String(page),'-singlefile','-png','-scale-to','1600',pdfPath,prefix],{timeout:120000});const image=prefix+'.png';if(!fs.existsSync(image))return res.status(404).send('Página não encontrada.');res.type('png').sendFile(path.resolve(image),()=>cleanup(dir));}catch(e){cleanup(dir);if(!res.headersSent)res.status(500).send(e.message);}});
app.use('/uploads',express.static(UP,{index:false,dotfiles:'deny',maxAge:'5m'}));

// ---------- EDITOR: precise redaction + replacement ----------
app.post('/api/edit/annotate',upload.single('image'),async(req,res)=>{
  try{
    const fileName=safeFileId(req.body.fileId);
    const filePath=path.join(UP,fileName);
    if(!fs.existsSync(filePath))return res.status(400).json({error:'Arquivo não encontrado. Reenvie o PDF.'});
    const anns=JSON.parse(req.body.annotations||'[]');
    if(!Array.isArray(anns)||anns.length>500)throw new Error('Quantidade de anotações inválida.');
    const mupdf=await import('mupdf');
    const document=mupdf.Document.openDocument(await fs.promises.readFile(filePath),'application/pdf');
    const pdf=document.asPDF();
    const redactions=[];
    try{
      for(const a of anns){
        if(!a||!String(a.id||'').startsWith('p'))continue;
        const pageIndex=Number(a.page)-1;
        const x=Number(a.pdfX),y=Number(a.pdfY),w=Number(a.pdfWidth),h=Number(a.pdfHeight);
        if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=pdf.countPages()||![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)continue;
        const page=pdf.loadPage(pageIndex);
        const bounds=page.getBounds();
        const padX=Math.min(1.25,Math.max(0.35,w*0.035));
        const padY=Math.min(1.25,Math.max(0.35,h*0.12));
        const rect=[Math.max(bounds[0],x-padX),Math.max(bounds[1],y-padY),Math.min(bounds[2],x+w+padX),Math.min(bounds[3],y+h+padY)];
        // Aplicamos imediatamente. A documentação do MuPDF confirma que applyRedaction
        // remove de forma permanente o texto atingido pelo retângulo.
        const red=page.createAnnotation('Redact');
        red.setRect(rect);
        red.update();
        red.applyRedaction(false,mupdf.PDFPage.REDACT_IMAGE_PIXELS,mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,mupdf.PDFPage.REDACT_TEXT_REMOVE);
        page.destroy();
        redactions.push({page:Number(a.page),x,y,w,h,deleted:a.deleted===true});
      }
      var redacted=Buffer.from(pdf.saveToBuffer('garbage=4,compress=yes').asUint8Array());
    }finally{document.destroy();}

    // O preenchimento branco é feito somente depois que o conteúdo original foi removido.
    // Assim nunca temos o texto original aparecendo por baixo do novo.
    const out=await PDFDocument.load(redacted,{ignoreEncryption:true});
    const font=await out.embedFont(StandardFonts.Helvetica);
    for(const a of anns){
      if(!a||!String(a.id||'').startsWith('p'))continue;
      const page=out.getPage(Number(a.page)-1);if(!page)continue;
      const ph=page.getHeight();
      const x=Number(a.pdfX)||0,y=Number(a.pdfY)||0,w=Number(a.pdfWidth)||20,h=Number(a.pdfHeight)||12;
      const size=Math.max(4,Math.min(Number(a.fontSize)||h,h));
      const padX=Math.min(1.25,Math.max(0.35,w*0.035));
      const padY=Math.min(1.25,Math.max(0.35,h*0.12));
      const rx=Math.max(0,x-padX),ryTop=Math.max(0,y-padY),rw=w+padX*2,rh=h+padY*2;
      page.drawRectangle({x:rx,y:Math.max(0,ph-ryTop-rh),width:rw,height:rh,color:rgb(1,1,1),borderWidth:0});
      if(a.deleted!==true&&String(a.text||'').length){
        const c=String(a.color||'#111111').replace('#','');
        const rr=parseInt(c.slice(0,2),16)/255||0.067,gg=parseInt(c.slice(2,4),16)/255||0.067,bb=parseInt(c.slice(4,6),16)/255||0.067;
        page.drawText(String(a.text),{x,y:Math.max(0,ph-y-size),size,font,color:rgb(rr,gg,bb),maxWidth:Math.max(10,w)});
      }
    }
    const outPath=path.join(TMP,uuid()+'.pdf');
    await fs.promises.writeFile(outPath,await out.save({useObjectStreams:false}));
    await sendFile(res,outPath,'editado.pdf',[],'application/pdf');
  }catch(e){if(!res.headersSent)res.status(500).json({error:e.message});}
});

app.get('/api/health',(req,res)=>res.json({ok:true,uptime:Math.round(process.uptime()),timestamp:new Date().toISOString()}));
app.use((err,req,res,next)=>{cleanup(req.file?.path,...(req.files||[]).map(f=>f.path));if(err instanceof multer.MulterError)return res.status(413).json({error:err.code==='LIMIT_FILE_SIZE'?'Arquivo maior que 200 MB.':`Upload inválido: ${err.message}`});if(err)return res.status(400).json({error:err.message||'Erro ao processar a solicitação.'});next();});
app.listen(PORT,()=>console.log(`PDFTools rodando na porta ${PORT}`));
