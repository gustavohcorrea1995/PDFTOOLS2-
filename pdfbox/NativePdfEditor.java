import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.Base64;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.contentstream.PDFStreamEngine;
import org.apache.pdfbox.contentstream.operator.Operator;
import org.apache.pdfbox.cos.*;
import org.apache.pdfbox.io.IOUtils;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDStream;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.state.PDTextState;
import org.apache.pdfbox.util.Matrix;
import org.apache.pdfbox.util.Vector;
import org.apache.pdfbox.pdfparser.PDFStreamParser;
import org.apache.pdfbox.pdfwriter.ContentStreamWriter;

/**
 * PDFTools2 native text engine.
 *
 * It edits the existing Tj/TJ COSString in the page content stream instead of
 * covering the original text and drawing another copy over it. New text is
 * added as a new PDF text object only when there was no original object.
 */
public class NativePdfEditor {
    static class Edit {
        int page;
        String original;
        String replacement;
        double x, y, w, h;
        boolean deleted;
        int size;
        String color;
        Edit(int page, String original, String replacement, double x, double y, double w, double h,
             boolean deleted, int size, String color) {
            this.page=page; this.original=original; this.replacement=replacement;
            this.x=x; this.y=y; this.w=w; this.h=h; this.deleted=deleted; this.size=size; this.color=color;
        }
    }

    static class Run {
        String text;
        float x, y;
        PDFont font;
        float fontSize;
        Run(String text, float x, float y, PDFont font, float fontSize) {
            this.text=text; this.x=x; this.y=y; this.font=font; this.fontSize=fontSize;
        }
    }

    static class Collector extends PDFStreamEngine {
        final List<Run> runs = new ArrayList<>();
        @Override protected void showText(byte[] string) throws IOException {
            PDFont font = getGraphicsState().getTextState().getFont();
            if (font != null) {
                String text = decode(font, string);
                Matrix m = getTextMatrix();
                PDTextState ts = getGraphicsState().getTextState();
                runs.add(new Run(text, m.getTranslateX(), m.getTranslateY(), font, ts.getFontSize()));
            }
            super.showText(string);
        }
    }

    static String decode(PDFont font, byte[] bytes) throws IOException {
        StringBuilder out = new StringBuilder();
        try (ByteArrayInputStream in = new ByteArrayInputStream(bytes)) {
            while (in.available() > 0) {
                int code = font.readCode(in);
                String u = font.toUnicode(code);
                if (u != null) out.append(u);
            }
        }
        return out.toString();
    }

    static boolean near(Run r, Edit e, PDPage page) {
        if (r == null) return true;
        double pageH = page.getCropBox().getHeight();
        double targetX = e.x;
        double targetY = pageH - e.y - e.h;
        double dx = Math.abs(r.x - targetX);
        double dy = Math.abs(r.y - targetY);
        double tolX = Math.max(18, e.w * 0.75);
        double tolY = Math.max(18, e.h * 1.5);
        return dx <= tolX && dy <= tolY;
    }

    static byte[] encode(PDFont font, String text) throws IOException {
        return font.encode(text);
    }

    static boolean replaceOnPage(PDDocument doc, PDPage page, List<Edit> edits) throws IOException {
        if (edits.isEmpty() || !page.hasContents()) return false;

        Collector collector = new Collector();
        collector.processPage(page);
        List<Run> runs = collector.runs;
        int runIndex = 0;
        boolean changed = false;

        PDFStreamParser parser = new PDFStreamParser(page);
        List<Object> tokens = parser.parse();
        List<Object> out = new ArrayList<>(tokens.size());
        PDFont currentFont = null;

        for (int i=0; i<tokens.size(); i++) {
            Object token = tokens.get(i);
            if (token instanceof Operator) {
                Operator op = (Operator) token;
                String name = op.getName();
                if ("Tf".equals(name) && out.size() >= 2 && out.get(out.size()-2) instanceof COSName) {
                    currentFont = page.getResources().getFont((COSName) out.get(out.size()-2));
                }
                if ("Tj".equals(name) && !out.isEmpty() && out.get(out.size()-1) instanceof COSString && currentFont != null) {
                    COSString s = (COSString) out.get(out.size()-1);
                    String text = decode(currentFont, s.getBytes());
                    Run run = runIndex < runs.size() ? runs.get(runIndex++) : null;
                    Edit hit = findEdit(edits, text, run, page);
                    if (hit != null) {
                        if (hit.deleted || hit.replacement.isEmpty()) s.setValue(new byte[0]);
                        else s.setValue(encode(currentFont, hit.replacement));
                        changed = true;
                    }
                } else if ("TJ".equals(name) && !out.isEmpty() && out.get(out.size()-1) instanceof COSArray && currentFont != null) {
                    COSArray arr = (COSArray) out.get(out.size()-1);
                    StringBuilder all = new StringBuilder();
                    List<COSString> strings = new ArrayList<>();
                    for (COSBase b : arr) {
                        if (b instanceof COSString) {
                            COSString cs = (COSString)b; strings.add(cs); all.append(decode(currentFont, cs.getBytes()));
                        }
                    }
                    String text = all.toString();
                    Run run = runIndex < runs.size() ? runs.get(runIndex++) : null;
                    Edit hit = findEdit(edits, text, run, page);
                    if (hit != null && !strings.isEmpty()) {
                        strings.get(0).setValue(hit.deleted || hit.replacement.isEmpty() ? new byte[0] : encode(currentFont, hit.replacement));
                        for (int k=1;k<strings.size();k++) strings.get(k).setValue(new byte[0]);
                        changed = true;
                    }
                }
            }
            out.add(token);
        }

        if (changed) {
            PDStream newContents = new PDStream(doc);
            try (OutputStream os = newContents.createOutputStream(COSName.FLATE_DECODE)) {
                ContentStreamWriter writer = new ContentStreamWriter(os);
                writer.writeTokens(out);
            }
            page.setContents(newContents);
        }
        return changed;
    }

    static Edit findEdit(List<Edit> edits, String text, Run run, PDPage page) {
        Edit best=null; double bestScore=Double.MAX_VALUE;
        for (Edit e: edits) {
            if (e.original == null || !e.original.equals(text)) continue;
            if (run != null && !near(run,e,page)) continue;
            double score = run == null ? 0 : Math.abs(run.x-e.x)+Math.abs((page.getCropBox().getHeight()-run.y)-e.y);
            if (score < bestScore) { best=e; bestScore=score; }
        }
        return best;
    }

    static void addNewText(PDDocument doc, PDPage page, Edit e) throws IOException {
        if (e.deleted || e.replacement == null || e.replacement.isEmpty()) return;
        PDFont font = PDType1Fallback(doc);
        float pageH = page.getCropBox().getHeight();
        float y = (float)(pageH - e.y - Math.max(8,e.h));
        int size = e.size > 0 ? e.size : 10;
        try (org.apache.pdfbox.pdmodel.PDPageContentStream cs = new org.apache.pdfbox.pdmodel.PDPageContentStream(doc,page,
                org.apache.pdfbox.pdmodel.PDPageContentStream.AppendMode.APPEND,true,true)) {
            cs.beginText(); cs.setFont(font,size); cs.newLineAtOffset((float)e.x,y); cs.showText(e.replacement); cs.endText();
        }
    }

    static PDFont PDType1Fallback(PDDocument doc) throws IOException {
        return new org.apache.pdfbox.pdmodel.font.PDType1Font(Standard14Fonts.FontName.HELVETICA);
    }

    static List<Edit> readManifest(Path path) throws IOException {
        List<Edit> result = new ArrayList<>();
        for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
            if (line.isBlank()) continue;
            String[] p=line.split("\\t",-1);
            if (p.length < 10) continue;
            int page=Integer.parseInt(p[0]);
            String original=new String(Base64.getDecoder().decode(p[1]),StandardCharsets.UTF_8);
            String replacement=new String(Base64.getDecoder().decode(p[2]),StandardCharsets.UTF_8);
            double x=Double.parseDouble(p[3]), y=Double.parseDouble(p[4]), w=Double.parseDouble(p[5]), h=Double.parseDouble(p[6]);
            boolean deleted=Boolean.parseBoolean(p[7]);
            int size=Integer.parseInt(p[8]);
            String color=p[9];
            result.add(new Edit(page,original,replacement,x,y,w,h,deleted,size,color));
        }
        return result;
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("Uso: NativePdfEditor input.pdf output.pdf manifest.tsv");
        Path input=Paths.get(args[0]), output=Paths.get(args[1]), manifest=Paths.get(args[2]);
        List<Edit> edits=readManifest(manifest);
        try (PDDocument doc=Loader.loadPDF(input.toFile())) {
            Map<Integer,List<Edit>> byPage=new LinkedHashMap<>();
            for(Edit e:edits) byPage.computeIfAbsent(e.page,k->new ArrayList<>()).add(e);
            int nativeChanged=0, newCount=0;
            for(Map.Entry<Integer,List<Edit>> entry:byPage.entrySet()) {
                int idx=entry.getKey()-1;
                if(idx<0 || idx>=doc.getNumberOfPages()) continue;
                PDPage page=doc.getPage(idx);
                List<Edit> newOnes=new ArrayList<>(), existing=new ArrayList<>();
                for(Edit e:entry.getValue()) { if(e.original==null || e.original.isEmpty() || e.original.equals("__NEW__")) newOnes.add(e); else existing.add(e); }
                if(replaceOnPage(doc,page,existing)) nativeChanged++;
                for(Edit e:newOnes) { addNewText(doc,page,e); newCount++; }
            }
            doc.save(output.toFile());
            System.out.println("NATIVE_CHANGED="+nativeChanged+" NEW="+newCount);
        }
    }
}
