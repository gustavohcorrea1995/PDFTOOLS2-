FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     poppler-utils \
     ghostscript \
     libreoffice \
     fonts-liberation \
     tesseract-ocr \
     tesseract-ocr-por \
     tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads tmp

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "start.js"]
