(() => {
  // Casca de navegacao unica para o app inteiro (pagina inicial com grid de
  // ferramentas + editor nativo, que e uma pagina HTML separada). Este
  // arquivo roda nas duas paginas (ambas incluem <script src="/sidebar.js">).
  const onNativeEditor = /native-editor\.html/i.test(location.pathname);

  const groups = [
    { title: 'Editor Pro', items: [
      ['native', 'Editor PDF Pro', '⚡']
    ]},
    { title: 'PDF', items: [
      ['merge', 'Juntar PDFs', '🧷'],
      ['split', 'Dividir PDF', '✂️'],
      ['edit', 'Organizar páginas', '🗂️'],
      ['compress', 'Comprimir PDF', '🗜️']
    ]},
    { title: 'Converter', items: [
      ['images-to-pdf', 'Imagens → PDF', '🖼️'],
      ['pdf-to-images', 'PDF → Imagens', '📷'],
      ['office-to-pdf', 'Office → PDF', '📝'],
      ['pdf-to-office', 'PDF → Word', '📄']
    ]},
    { title: 'Editar', items: [
      ['ocr', 'Tornar PDF editável', '🪄']
    ]}
  ];

  // Mapa id -> titulo exato do card na home, usado so quando ESTAMOS na
  // home (index.html) para achar e clicar no card correspondente.
  const titles = {
    merge: 'Juntar PDFs', split: 'Dividir PDF', edit: 'Organizar páginas',
    compress: 'Comprimir PDF', 'images-to-pdf': 'Imagens → PDF',
    'pdf-to-images': 'PDF → Imagens', 'office-to-pdf': 'Word/Excel/PPT → PDF',
    'pdf-to-office': 'PDF → Word', annotate: 'Adicionar texto/imagem',
    ocr: 'Tornar PDF editável', native: 'Editor PDF Pro'
  };

  function findToolCard(id) {
    return [...document.querySelectorAll('.tool-card')].find(c => c.querySelector('h3')?.textContent === titles[id]);
  }

  function goToTool(id, nav) {
    nav.classList.remove('mobile-open');
    if (id === 'native') {
      if (!onNativeEditor) window.location.href = '/native-editor.html';
      return;
    }
    if (onNativeEditor) {
      // Estamos numa pagina separada (editor nativo) - precisa navegar de
      // verdade. A home abre a ferramenta certa sozinha via ?tool=.
      window.location.href = `/?tool=${encodeURIComponent(id)}`;
      return;
    }
    const card = findToolCard(id);
    if (card) card.click();
  }

  function markActiveByTool(nav, id) {
    nav.querySelectorAll('.side-item').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === id));
  }

  function watchActiveTool(nav) {
    // Na home, o titulo da ferramenta aberta aparece em #toolTitle - usamos
    // isso para manter o item certo destacado no menu, sem precisar tocar
    // no app.js.
    const toolTitle = document.getElementById('toolTitle');
    const hero = document.getElementById('hero');
    if (!toolTitle) return;
    const reverseTitles = Object.fromEntries(Object.entries(titles).map(([id, label]) => [label, id]));
    const sync = () => {
      if (hero && !hero.classList.contains('hidden')) { markActiveByTool(nav, null); return; }
      const id = reverseTitles[toolTitle.textContent.trim()];
      markActiveByTool(nav, id || null);
    };
    new MutationObserver(sync).observe(toolTitle, { childList: true, characterData: true, subtree: true });
    if (hero) new MutationObserver(sync).observe(hero, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  function build() {
    if (document.getElementById('sideNav')) return;
    const nav = document.createElement('aside');
    nav.id = 'sideNav';
    nav.className = 'side-nav';
    nav.innerHTML = `
      <div class="side-brand"><div class="side-logo">PDF</div><div><strong>PDFTools</strong><span>Ferramentas PDF</span></div></div>
      <button class="side-home" type="button">⌂ <span>Início</span></button>
      <div class="side-groups"></div>
      <div class="side-footer">PDFTools2</div>`;
    document.body.prepend(nav);
    document.body.classList.add('has-side-nav');

    const groupsRoot = nav.querySelector('.side-groups');
    groups.forEach((group) => {
      const section = document.createElement('section');
      section.className = 'side-section';
      section.innerHTML = `<button class="side-section-title" type="button"><span>${group.title}</span><b>⌄</b></button><div class="side-items"></div>`;
      const items = section.querySelector('.side-items');
      group.items.forEach(([id, label, icon]) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'side-item'; button.dataset.tool = id;
        button.innerHTML = `<span class="side-item-icon">${icon}</span><span>${label}</span>`;
        button.onclick = () => goToTool(id, nav);
        items.appendChild(button);
      });
      section.querySelector('.side-section-title').onclick = () => section.classList.toggle('collapsed');
      groupsRoot.appendChild(section);
    });

    nav.querySelector('.side-home').onclick = () => {
      if (onNativeEditor) { window.location.href = '/'; return; }
      document.getElementById('backBtn')?.click();
      markActiveByTool(nav, null);
    };

    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'side-mobile-toggle'; toggle.textContent = '☰'; toggle.setAttribute('aria-label', 'Abrir menu');
    toggle.onclick = () => nav.classList.toggle('mobile-open');
    document.body.appendChild(toggle);

    if (onNativeEditor) markActiveByTool(nav, 'native');
    else watchActiveTool(nav);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
