# PDFTools — versão limpa

## O que foi corrigido

1. A pré-visualização do PDF agora é renderizada no servidor e enviada ao navegador como `data:image/jpeg;base64,...`.
2. O navegador não faz mais uma segunda chamada para `/api/preview`, eliminando a imagem quebrada que aparecia no editor.
3. As caixas de texto continuam sendo posicionadas sobre o texto real.
4. Ao clicar em **Excluir**, o servidor usa redação real do MuPDF (`Redact` + `applyRedactions`) para remover o conteúdo do PDF, em vez de apenas desenhar uma faixa branca.
5. Ao editar um texto, o conteúdo original é redigido primeiro; só depois o novo texto é desenhado.
6. O servidor usa coordenadas em pontos do PDF para a redação, sem misturar pixels da prévia com pontos do PDF.
7. O Dockerfile instala Poppler, Ghostscript e LibreOffice para manter as outras ferramentas do PDFTools funcionando.

## Como publicar no Render

Envie/substitua estes arquivos no repositório:

- `server.js`
- `package.json`
- `Dockerfile`
- `render.yaml`
- `public/app.js`
- `public/index.html`
- `public/styles.css`

Não use o `package-lock.json` antigo desta versão. O Render vai gerar uma instalação nova a partir do `package.json`.

Depois faça um novo deploy.

## Teste do editor

1. Abra **Adicionar texto/imagem**.
2. Envie um PDF.
3. A página deve aparecer na própria tela — sem ícone de imagem quebrada.
4. Clique em um telefone, CPF, e-mail etc.
5. Clique em **Excluir**.
6. Salve o PDF.
7. Abra o PDF salvo e tente selecionar/copiar o trecho apagado.

O conteúdo selecionado para exclusão é removido por redação permanente antes do PDF final ser gerado.
