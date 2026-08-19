(() => {
  const groups = [
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
      ['annotate', 'Texto / imagem', '✍️']
    ]}
  ];

  function findToolCard(id) {
    const titles = {
      merge: 'Juntar PDFs', split: 'Dividir PDF', edit: 'Organizar páginas',
      compress: 'Comprimir PDF', 'images-to-pdf': 'Imagens → PDF',
      'pdf-to-images': 'PDF → Imagens', 'office-to-pdf': 'Word/Excel/PPT → PDF',
      'pdf-to-office': 'PDF → Word', annotate: 'Adicionar texto/imagem'
    };
    return [...document.querySelectorAll('.tool-card')].find(c => c.querySelector('h3')?.textContent === titles[id]);
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

    const groupsRoot = nav.querySelector('.side-groups');
    groups.forEach((group, gi) => {
      const section = document.createElement('section');
      section.className = 'side-section';
      section.innerHTML = `<button class="side-section-title" type="button"><span>${group.title}</span><b>⌄</b></button><div class="side-items"></div>`;
      const items = section.querySelector('.side-items');
      group.items.forEach(([id, label, icon]) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'side-item'; button.dataset.tool = id;
        button.innerHTML = `<span class="side-item-icon">${icon}</span><span>${label}</span>`;
        button.onclick = () => {
          const card = findToolCard(id);
          if (card) card.click();
          nav.classList.remove('mobile-open');
        };
        items.appendChild(button);
      });
      section.querySelector('.side-section-title').onclick = () => section.classList.toggle('collapsed');
      groupsRoot.appendChild(section);
    });

    nav.querySelector('.side-home').onclick = () => document.getElementById('backBtn')?.click();

    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'side-mobile-toggle'; toggle.textContent = '☰'; toggle.setAttribute('aria-label','Abrir menu');
    toggle.onclick = () => nav.classList.toggle('mobile-open');
    document.body.appendChild(toggle);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once:true });
  else build();
})();
