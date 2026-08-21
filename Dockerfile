FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     poppler-utils \
     ghostscript \
     libreoffice \
     fonts-liberation \
     openjdk-17-jdk-headless \
     curl \
     ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# Apache PDFBox 3.0.8 standalone distribution.
RUN mkdir -p /opt/pdfbox \
  && curl -fsSL https://archive.apache.org/dist/pdfbox/3.0.8/pdfbox-app-3.0.8.jar -o /opt/pdfbox/pdfbox-app-3.0.8.jar \
  && test -s /opt/pdfbox/pdfbox-app-3.0.8.jar \
  && jar tf /opt/pdfbox/pdfbox-app-3.0.8.jar >/dev/null

COPY . .

# Compile the isolated native editor. The existing Node/MuPDF editor is untouched.
RUN javac -encoding UTF-8 -cp /opt/pdfbox/pdfbox-app-3.0.8.jar -d /opt/pdfbox pdfbox/NativePdfEditor.java \
  && jar --create --file /opt/pdfbox/pdfbox-engine.jar -C /opt/pdfbox NativePdfEditor.class -C /opt/pdfbox 'NativePdfEditor$Edit.class' -C /opt/pdfbox 'NativePdfEditor$Run.class' -C /opt/pdfbox 'NativePdfEditor$Collector.class' \
  && test -s /opt/pdfbox/pdfbox-engine.jar

RUN mkdir -p uploads tmp

ENV NODE_ENV=production
ENV PORT=10000
ENV PDFBOX_JAR=/opt/pdfbox/pdfbox-app-3.0.8.jar
ENV PDFBOX_ENGINE_JAR=/opt/pdfbox/pdfbox-engine.jar
EXPOSE 10000

CMD ["node", "start.js"]
