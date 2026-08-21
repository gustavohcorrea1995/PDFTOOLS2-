import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.Base64;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.contentstream.PDFStreamEngine;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDFontDescriptor;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.state.RenderingMode;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.util.Matrix;

/**
 * Motor de edicao de PDF baseado em Apache PDFBox.
 *
 * Estrategia: cobrir a area original (redacao visual real) e desenhar o
 * texto novo por cima, na mesma posicao. Editar os tokens do content
 * stream original in-place e inerentemente fragil (a segmentacao interna
 * do PDF raramente bate com a extracao por palavra), entao evitamos isso
 * por completo.
 *
 * Para o resultado ficar visualmente fiel ao original mesmo em edicao em
 * massa, o motor:
 *   1. Detecta a fonte realmente usada na posicao de cada edicao (lendo o
 *      content stream, so para identificacao - nunca para editar tokens).
 *   2. Reaproveita a fonte original embutida sempre que ela contem os
 *      glifos necessarios para o texto novo; caso contrario cai para uma
 *      fonte padrao equivalente (serifada/sem-serifa, negrito/italico).
 *   3. Amostra a cor de fundo real ao redor da area editada, em vez de
 *      sempre usar branco.
 *   4. Agrupa as edicoes por pagina e usa um unico content stream por
 *      pagina, para escalar bem com muitas edicoes de uma vez.
 */
public class NativePdfEditor {

    static class Edit {
        int page;
        String original, replacement;
        double x, y, w, h, size;
        boolean deleted, bold, italic, underline;
        float r = 0.07f, g = 0.07f, b = 0.07f;

        Edit(int page, String original, String replacement, double x, double y, double w, double h,
             boolean deleted, double size, String colorField) {
            this.page = page;
            this.original = original;
            this.replacement = replacement;
            this.x = x; this.y = y; this.w = w; this.h = h;
            this.deleted = deleted;
            this.size = size;

            String[] parts = (colorField == null ? "#111111" : colorField).split("\\|", -1);
            String hex = parts.length > 0 && parts[0].startsWith("#") ? parts[0] : "#111111";
            this.bold = Arrays.asList(parts).contains("B");
            this.italic = Arrays.asList(parts).contains("I");
            this.underline = Arrays.asList(parts).contains("U");
            try {
                int rgb = Integer.parseInt(hex.substring(1), 16);
                this.r = ((rgb >> 16) & 0xFF) / 255f;
                this.g = ((rgb >> 8) & 0xFF) / 255f;
                this.b = (rgb & 0xFF) / 255f;
            } catch (Exception ignored) { /* mantem cor padrao */ }
        }
    }

    /** Um "run" de texto detectado no content stream original, so para identificar a fonte usada. */
    static class Run {
        float x, y, size;
        PDFont font;
    }

    /** Le o content stream so para coletar posicao/fonte de cada trecho de texto - nunca edita nada. */
    static class FontProbe extends PDFStreamEngine {
        final List<Run> runs = new ArrayList<>();

        @Override
        protected void showText(byte[] string) throws IOException {
            PDFont font = getGraphicsState().getTextState().getFont();
            if (font != null) {
                Matrix m = getTextMatrix();
                Run run = new Run();
                run.x = m.getTranslateX();
                run.y = m.getTranslateY();
                run.size = getGraphicsState().getTextState().getFontSize();
                run.font = font;
                runs.add(run);
            }
            super.showText(string);
        }
    }

    static List<Edit> readManifest(Path path) throws IOException {
        List<Edit> result = new ArrayList<>();
        for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
            if (line.isBlank()) continue;
            String[] p = line.split("\\t", -1);
            if (p.length < 10) continue;
            int page = Integer.parseInt(p[0]);
            String original = new String(Base64.getDecoder().decode(p[1]), StandardCharsets.UTF_8);
            String replacement = new String(Base64.getDecoder().decode(p[2]), StandardCharsets.UTF_8);
            double x = Double.parseDouble(p[3]);
            double y = Double.parseDouble(p[4]);
            double w = Double.parseDouble(p[5]);
            double h = Double.parseDouble(p[6]);
            boolean deleted = Boolean.parseBoolean(p[7]);
            double size = Double.parseDouble(p[8]);
            String color = p[9];
            result.add(new Edit(page, original, replacement, x, y, w, h, deleted, size, color));
        }
        return result;
    }

    /** Acha o "run" de texto original mais proximo da posicao da edicao (so para saber a fonte usada ali). */
    static Run nearestRun(List<Run> runs, float pageH, Edit e) {
        float targetY = pageH - (float) e.y - (float) e.h * 0.5f;
        Run best = null;
        double bestDist = Double.MAX_VALUE;
        for (Run run : runs) {
            double dx = Math.abs(run.x - e.x);
            double dy = Math.abs(run.y - targetY);
            double dist = dx + dy * 1.5;
            if (dist < bestDist) { bestDist = dist; best = run; }
        }
        return (best != null && bestDist < 60) ? best : null;
    }

    static boolean looksBold(PDFont font) {
        if (font == null) return false;
        String name = font.getName() == null ? "" : font.getName().toLowerCase();
        if (name.contains("bold")) return true;
        try {
            PDFontDescriptor d = font.getFontDescriptor();
            if (d != null && d.isForceBold()) return true;
        } catch (Exception ignored) {}
        return false;
    }

    static boolean looksItalic(PDFont font) {
        if (font == null) return false;
        String name = font.getName() == null ? "" : font.getName().toLowerCase();
        if (name.contains("italic") || name.contains("oblique")) return true;
        try {
            PDFontDescriptor d = font.getFontDescriptor();
            if (d != null && d.getItalicAngle() != 0) return true;
        } catch (Exception ignored) {}
        return false;
    }

    /** Fonte padrao equivalente (serifada/sem-serifa/monoespacada) quando nao da para reaproveitar a original. */
    static PDFont fallbackFont(String originalName, boolean bold, boolean italic) {
        String lower = originalName == null ? "" : originalName.toLowerCase();
        boolean serif = lower.contains("times") || lower.contains("serif") || lower.contains("georgia")
                || lower.contains("garamond") || lower.contains("cambria") || lower.contains("minion")
                || lower.contains("book");
        boolean mono = lower.contains("courier") || lower.contains("mono") || lower.contains("consolas");

        Standard14Fonts.FontName fontName;
        if (mono) {
            fontName = bold && italic ? Standard14Fonts.FontName.COURIER_BOLD_OBLIQUE
                    : bold ? Standard14Fonts.FontName.COURIER_BOLD
                    : italic ? Standard14Fonts.FontName.COURIER_OBLIQUE
                    : Standard14Fonts.FontName.COURIER;
        } else if (serif) {
            fontName = bold && italic ? Standard14Fonts.FontName.TIMES_BOLD_ITALIC
                    : bold ? Standard14Fonts.FontName.TIMES_BOLD
                    : italic ? Standard14Fonts.FontName.TIMES_ITALIC
                    : Standard14Fonts.FontName.TIMES_ROMAN;
        } else {
            fontName = bold && italic ? Standard14Fonts.FontName.HELVETICA_BOLD_OBLIQUE
                    : bold ? Standard14Fonts.FontName.HELVETICA_BOLD
                    : italic ? Standard14Fonts.FontName.HELVETICA_OBLIQUE
                    : Standard14Fonts.FontName.HELVETICA;
        }
        return new PDType1Font(fontName);
    }

    /**
     * Decide qual fonte usar para o texto novo: tenta reaproveitar a fonte
     * original detectada (se ela conseguir codificar o texto novo), senao
     * cai para uma fonte padrao equivalente.
     */
    static PDFont resolveFont(Run run, String newText, boolean wantBold, boolean wantItalic) {
        if (run != null && run.font != null && newText != null && !newText.isEmpty()) {
            try {
                run.font.encode(newText);
                return run.font; // a fonte original tem todos os glifos necessarios - reaproveita
            } catch (Exception ignored) {
                // a fonte original (comum em fontes "subset") nao contem os glifos do texto novo
            }
        }
        boolean bold = wantBold || looksBold(run != null ? run.font : null);
        boolean italic = wantItalic || looksItalic(run != null ? run.font : null);
        String baseName = run != null && run.font != null ? String.valueOf(run.font.getName()) : "";
        return fallbackFont(baseName, bold, italic);
    }

    /** Amostra a cor media ao redor (nao dentro) da caixa, para estimar a cor de fundo real da pagina. */
    static float[] sampleBackground(BufferedImage raster, float scale, Edit e) {
        if (raster == null) return null;
        int margin = 4;
        int x0 = (int) Math.round(e.x * scale) - margin;
        int y0 = (int) Math.round(e.y * scale) - margin;
        int x1 = (int) Math.round((e.x + e.w) * scale) + margin;
        int y1 = (int) Math.round((e.y + e.h) * scale) + margin;
        long rs = 0, gs = 0, bs = 0;
        int n = 0;
        for (int x = x0; x < x1; x++) {
            for (int y = y0; y < y1; y++) {
                boolean onRing = x < x0 + margin || x >= x1 - margin || y < y0 + margin || y >= y1 - margin;
                if (!onRing) continue;
                if (x < 0 || y < 0 || x >= raster.getWidth() || y >= raster.getHeight()) continue;
                int rgb = raster.getRGB(x, y);
                rs += (rgb >> 16) & 0xFF; gs += (rgb >> 8) & 0xFF; bs += rgb & 0xFF;
                n++;
            }
        }
        if (n == 0) return null;
        return new float[]{ rs / (float) n / 255f, gs / (float) n / 255f, bs / (float) n / 255f };
    }

    /** Quebra o texto em linhas para caber em maxWidth, usando a largura real da fonte escolhida. */
    static List<String> wrapText(PDFont font, float size, String text, float maxWidth) throws IOException {
        List<String> lines = new ArrayList<>();
        for (String paragraph : text.split("\n", -1)) {
            StringBuilder line = new StringBuilder();
            for (String word : paragraph.split(" ", -1)) {
                String candidate = line.length() == 0 ? word : line + " " + word;
                float width = font.getStringWidth(candidate.isEmpty() ? " " : candidate) / 1000f * size;
                if (width > maxWidth && line.length() > 0) {
                    lines.add(line.toString());
                    line = new StringBuilder(word);
                } else {
                    line = new StringBuilder(candidate);
                }
            }
            lines.add(line.toString());
        }
        return lines;
    }

    static void applyEdit(PDPageContentStream cs, float pageH, List<Run> runs,
                           BufferedImage raster, float rasterScale, Edit e) throws IOException {
        // e.x/e.y/e.w/e.h chegam em espaco "top-down" (origem no topo, como
        // extraido pelo servidor Node/MuPDF). O PDFBox usa origem embaixo a
        // esquerda, entao fazemos o flip vertical aqui.
        float padX = 1.5f, padY = 1.5f;
        float rectX = (float) e.x - padX;
        float rectYTop = pageH - (float) e.y;
        float rectHeight = (float) e.h + padY * 2;
        float rectY = rectYTop - (float) e.h - padY;
        float rectWidth = (float) e.w + padX * 2;

        float[] bg = sampleBackground(raster, rasterScale, e);
        if (bg != null) cs.setNonStrokingColor(bg[0], bg[1], bg[2]);
        else cs.setNonStrokingColor(1f, 1f, 1f);
        cs.addRect(rectX, rectY, rectWidth, rectHeight);
        cs.fill();

        if (e.deleted || e.replacement == null || e.replacement.isEmpty()) return;

        Run run = nearestRun(runs, pageH, e);
        PDFont font = resolveFont(run, e.replacement, e.bold, e.italic);
        float size = (float) (e.size > 0 ? e.size : Math.max(6, e.h));
        float lineHeight = size * 1.15f;
        float maxWidth = Math.max(10, (float) e.w + 4);

        List<String> lines = wrapText(font, size, e.replacement, maxWidth);
        float baselineY = pageH - (float) e.y - size * 0.85f;

        cs.setNonStrokingColor(e.r, e.g, e.b);
        boolean fontAlreadyBold = font.getName() != null && font.getName().toLowerCase().contains("bold");
        boolean simulateBold = e.bold && !fontAlreadyBold;
        if (simulateBold) {
            cs.setRenderingMode(RenderingMode.FILL_STROKE);
            cs.setLineWidth(size * 0.02f);
            cs.setStrokingColor(e.r, e.g, e.b);
        }

        for (String line : lines) {
            cs.beginText();
            cs.setFont(font, size);
            cs.newLineAtOffset((float) e.x, baselineY);
            cs.showText(line);
            cs.endText();

            if (e.underline) {
                float underlineY = baselineY - size * 0.12f;
                float lineWidth = font.getStringWidth(line) / 1000f * size;
                cs.setLineWidth(Math.max(0.6f, size * 0.05f));
                cs.moveTo((float) e.x, underlineY);
                cs.lineTo((float) e.x + lineWidth, underlineY);
                cs.stroke();
            }
            baselineY -= lineHeight;
        }

        if (simulateBold) cs.setRenderingMode(RenderingMode.FILL);
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            throw new IllegalArgumentException("Uso: NativePdfEditor input.pdf output.pdf manifest.tsv");
        }
        Path input = Paths.get(args[0]);
        Path output = Paths.get(args[1]);
        Path manifest = Paths.get(args[2]);

        List<Edit> edits = readManifest(manifest);
        int applied = 0;

        try (PDDocument doc = Loader.loadPDF(input.toFile())) {
            Map<Integer, List<Edit>> byPage = new LinkedHashMap<>();
            for (Edit e : edits) {
                if (e.page >= 1) byPage.computeIfAbsent(e.page, k -> new ArrayList<>()).add(e);
            }

            PDFRenderer renderer = new PDFRenderer(doc);
            float rasterDpi = 150f;
            float rasterScale = rasterDpi / 72f;

            for (Map.Entry<Integer, List<Edit>> entry : byPage.entrySet()) {
                int idx = entry.getKey() - 1;
                if (idx < 0 || idx >= doc.getNumberOfPages()) continue;
                PDPage page = doc.getPage(idx);
                float pageH = page.getCropBox().getHeight();

                // Deteccao de fonte e amostragem de fundo acontecem ANTES de
                // qualquer modificacao nesta pagina, para refletir o estado
                // original real (nao o que ja foi coberto por edicoes
                // anteriores na mesma pagina).
                FontProbe probe = new FontProbe();
                try { probe.processPage(page); } catch (Exception ignored) { /* pagina sem texto extraivel */ }

                BufferedImage raster = null;
                try { raster = renderer.renderImageWithDPI(idx, rasterDpi); } catch (Exception ignored) {}

                // Um unico content stream por pagina, mesmo com muitas
                // edicoes nela - essencial para edicao em massa eficiente.
                try (PDPageContentStream cs = new PDPageContentStream(
                        doc, page, PDPageContentStream.AppendMode.APPEND, true, true)) {
                    for (Edit e : entry.getValue()) {
                        applyEdit(cs, pageH, probe.runs, raster, rasterScale, e);
                        applied++;
                    }
                }
            }

            doc.save(output.toFile());
        }
        System.out.println("NATIVE_CHANGED=" + applied + " NEW=0");
    }
}
