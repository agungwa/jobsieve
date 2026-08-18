import { ParseError } from "../errors";

/**
 * Deterministic text extraction. No AI.
 *
 * PDF: pdf-parse first, unpdf fallback (pdf-parse has a known
 * "no module parent" failure mode under bundlers/non-Node runtimes like Bun).
 * DOCX: mammoth raw-text extraction.
 * TXT: direct decode.
 */

export interface TextExtractor {
  extract(buffer: Buffer): Promise<string>;
}

class TxtExtractor implements TextExtractor {
  async extract(buffer: Buffer): Promise<string> {
    return buffer.toString("utf-8");
  }
}

class DocxExtractor implements TextExtractor {
  async extract(buffer: Buffer): Promise<string> {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
}

class PdfExtractor implements TextExtractor {
  async extract(buffer: Buffer): Promise<string> {
    // 1. Try pdf-parse (v2: class-based API).
    try {
      const { PDFParse } = await import("pdf-parse");
      const pdf = new PDFParse({ data: buffer });
      try {
        const result = await pdf.getText({ pageJoiner: "\n" });
        if (result.text && result.text.trim().length > 0) {
          return result.text;
        }
        throw new Error("pdf-parse returned empty text");
      } finally {
        await pdf.destroy().catch(() => {});
      }
    } catch (pdfParseErr) {
      // 2. Fallback to unpdf.
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text } = await extractText(pdf, { mergePages: true });
        const merged = Array.isArray(text) ? text.join("\n") : text;
        if (merged && merged.trim().length > 0) {
          return merged;
        }
        throw new Error("unpdf also returned empty text");
      } catch (unpdfErr) {
        throw new ParseError(
          `PDF extraction failed (pdf-parse: ${(pdfParseErr as Error).message}; unpdf: ${(unpdfErr as Error).message})`,
          { format: "pdf", cause: unpdfErr },
        );
      }
    }
  }
}

export function extractorFor(contentType: string, filename: string): TextExtractor {
  const ct = contentType.toLowerCase();
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  if (ct.includes("pdf") || ext === "pdf") return new PdfExtractor();
  if (
    ct.includes("officedocument.wordprocessingml") ||
    ct.includes("msword") ||
    ext === "docx" ||
    ext === "doc"
  ) {
    return new DocxExtractor();
  }
  if (ct.startsWith("text/") || ext === "txt" || ext === "md") {
    return new TxtExtractor();
  }
  throw new ParseError(
    `Unsupported file type: ${contentType || ext}`,
    { format: ext || contentType },
  );
}
