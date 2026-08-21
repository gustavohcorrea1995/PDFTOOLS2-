import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.Base64;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.state.RenderingMode;

/**
 * Motor de edicao de PDF baseado em Apache PDFBox.
 *
 * Estrategia: em vez de tentar editar os tokens do content stream original
 * (fragil: a segmentacao interna do PDF raramente bate com as "palavras"
 * extraidas para a tela, o que causava trocas erradas e texto bagunçado),
 * este motor:
 *   1. Cobre a area original com um retangulo (redacao visual real).
 *   2. Desenha o texto novo por cima, na mesma posicao/tamanho.
 *
 * E a mesma estrategia ja usada com sucesso no motor MuPDF (/api/edit/annotate),
 * so que aqui via PDFBox.
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

    /** Quebra o texto em linhas para caber em maxWidth, usando a largura real da fonte. */
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

    static void applyEdit(PDDocument doc, PDPage page, Edit e) throws IOException {
        PDRectangle box = page.getCropBox();
        float pageH = box.getHeight();
        // e.x/e.y/e.w/e.h chegam em espaco "top-down" (origem no topo, como
        // extraido pelo servidor Node/MuPDF). O PDFBox usa origem embaixo a
        // esquerda, entao fazemos o flip vertical aqui.
        float padX = 1.5f, padY = 1.5f;
        float rectX = (float) e.x - padX;
        float rectYTop = pageH - (float) e.y;
        float rectHeight = (float) e.h + padY * 2;
        float rectY = rectYTop - (float) e.h - padY;
        float rectWidth = (float) e.w + padX * 2;

        try (PDPageContentStream cs = new PDPageContentStream(
                doc, page, PDPageContentStream.AppendMode.APPEND, true, true)) {

            // 1) Cobre a area original com retangulo branco (redacao visual).
            cs.setNonStrokingColor(1f, 1f, 1f);
            cs.addRect(rectX, rectY, rectWidth, rectHeight);
            cs.fill();

            if (e.deleted || e.replacement == null || e.replacement.isEmpty()) return;

            // 2) Desenha o texto novo por cima, na mesma posicao.
            PDFont font = new PDType1Font(
                    e.bold ? Standard14Fonts.FontName.HELVETICA_BOLD : Standard14Fonts.FontName.HELVETICA);
            float size = (float) (e.size > 0 ? e.size : Math.max(6, e.h));
            float lineHeight = size * 1.15f;
            float maxWidth = Math.max(10, (float) e.w + 4);

            List<String> lines = wrapText(font, size, e.replacement, maxWidth);
            float baselineY = pageH - (float) e.y - size * 0.85f;

            cs.setNonStrokingColor(e.r, e.g, e.b);
            if (e.bold) {
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
        }
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
            for (Edit e : edits) {
                int idx = e.page - 1;
                if (idx < 0 || idx >= doc.getNumberOfPages()) continue;
                PDPage page = doc.getPage(idx);
                applyEdit(doc, page, e);
                applied++;
            }
            doc.save(output.toFile());
        }
        System.out.println("NATIVE_CHANGED=" + applied + " NEW=0");
    }
}
