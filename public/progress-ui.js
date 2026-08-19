(() => {
  const labels = {
    '/api/inspect': { title: 'Preparando seu PDF', steps: ['Enviando arquivo', 'Lendo estrutura e textos', 'Renderizando prévias'] },
    '/api/pages/edit': { title: 'Organizando páginas', steps: ['Enviando PDF', 'Aplicando alterações', 'Preparando arquivo final'] },
    '/api/edit/annotate': { title: 'Salvando edição', steps: ['Enviando alterações', 'Editando conteúdo do PDF', 'Preparando arquivo final'] },
    '/api/compress': { title: 'Comprimindo PDF', steps: ['Enviando arquivo', 'Otimizando PDF', 'Finalizando arquivo'] },
    '/api/convert/pdf-to-images': { title: 'Convertendo páginas', steps: ['Enviando PDF', 'Renderizando páginas', 'Criando arquivo ZIP'] },
    '/api/convert/office': { title: 'Convertendo documento', steps: ['Enviando arquivo', 'Processando com o conversor', 'Preparando resultado'] }
  };
  let overlay=null,timer=null,startedAt=0,currentStepTimer=null;
  function ensureOverlay(){
    if(overlay)return overlay;
    overlay=document.createElement('div');overlay.id='operationProgress';overlay.className='operation-progress hidden';
    overlay.innerHTML='<div class="operation-progress-card" role="status" aria-live="polite"><div class="operation-progress-title" id="operationProgressTitle">Processando</div><div class="operation-progress-stage" id="operationProgressStage">Preparando...</div><div class="operation-progress-track"><div class="operation-progress-bar"></div></div><div class="operation-progress-meta"><span id="operationProgressElapsed">0s</span><span id="operationProgressHint">O processamento está acontecendo no servidor.</span></div></div>';
    document.body.appendChild(overlay);return overlay;
  }
  function show(url){
    const root=ensureOverlay(),key=Object.keys(labels).find(k=>url.includes(k)),config=labels[key]||{title:'Processando arquivo',steps:['Enviando arquivo','Processando no servidor','Preparando resultado']};
    root.querySelector('#operationProgressTitle').textContent=config.title;root.querySelector('#operationProgressStage').textContent=config.steps[0];root.querySelector('#operationProgressHint').textContent='O processamento está acontecendo no servidor.';
    const bar=root.querySelector('.operation-progress-bar');bar.style.width='18%';bar.classList.add('running');root.classList.remove('hidden');startedAt=Date.now();clearInterval(timer);clearTimeout(currentStepTimer);
    timer=setInterval(()=>{const s=Math.floor((Date.now()-startedAt)/1000);root.querySelector('#operationProgressElapsed').textContent=`${s}s`;root.querySelector('#operationProgressHint').textContent=s>=15?'Ainda processando. Não feche esta página.':s>=5?'Arquivos maiores e a instância gratuita podem levar mais tempo.':'O processamento está acontecendo no servidor.'},500);
    let index=0;const advance=()=>{index+=1;if(index>=config.steps.length)return;root.querySelector('#operationProgressStage').textContent=config.steps[index];bar.style.width=`${Math.min(82,18+index*30)}%`;currentStepTimer=setTimeout(advance,4500)};currentStepTimer=setTimeout(advance,2500);
  }
  function hide(){if(!overlay)return;clearInterval(timer);clearTimeout(currentStepTimer);const bar=overlay.querySelector('.operation-progress-bar');bar.style.width='100%';bar.classList.remove('running');setTimeout(()=>overlay?.classList.add('hidden'),250)}
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{const url=typeof args[0]==='string'?args[0]:args[0]?.url||'';const tracked=url.includes('/api/')&&!url.includes('/api/preview/');if(tracked)show(url);try{return await originalFetch(...args)}finally{if(tracked)hide()}};
})();
