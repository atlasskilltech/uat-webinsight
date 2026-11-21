import "server-only";

/**
 * Native (embedded) text extraction from a PDF, using pdf-parse. Works WITHOUT
 * any external provider for text-based PDFs. Scanned/image PDFs yield little or
 * no text — the caller then falls back to OCR (if configured).
 *
 * We import pdf-parse's internal lib directly to avoid its index.js "debug mode"
 * which reads a bundled test file when require.main is undefined.
 */
export interface PdfTextResult {
  text: string;
  pages: number;
}

export async function extractPdfText(buf: Buffer): Promise<PdfTextResult | null> {
  try {
    const spec = "pdf-parse/lib/pdf-parse.js";
    const mod = (await import(spec)) as unknown as {
      default?: (b: Buffer) => Promise<{ text?: string; numpages?: number }>;
    };
    const pdf = (mod.default ?? (mod as unknown as (b: Buffer) => Promise<{ text?: string; numpages?: number }>));
    const res = await pdf(buf);
    return { text: (res.text ?? "").trim(), pages: res.numpages ?? 0 };
  } catch {
    return null;
  }
}

/** Heuristic: does this PDF have a usable embedded text layer? */
export function hasUsableText(result: PdfTextResult | null): boolean {
  return !!result && result.text.replace(/\s+/g, "").length >= 40;
}
