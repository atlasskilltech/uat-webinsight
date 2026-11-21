import "server-only";

/**
 * Provider-independent OCR abstraction. OCR converts scanned PDFs / images into
 * text for the AI extractor. It is OFF until OCR_PROVIDER is configured, so the
 * UI shows an honest "OCR not configured" state rather than faking a result.
 *
 * Implementations are added per provider. "tesseract" is supported if the
 * optional `tesseract.js` package is installed (not bundled by default to keep
 * the build light). Cloud providers can be added behind the same interface.
 */
export interface OcrProvider {
  readonly name: string;
  recognize(input: { buffer: Buffer; mimeType: string }): Promise<{ text: string }>;
}

export function ocrConfigured(): boolean {
  return Boolean(process.env.OCR_PROVIDER?.trim());
}

class TesseractOcr implements OcrProvider {
  readonly name = "tesseract";
  async recognize({ buffer }: { buffer: Buffer; mimeType: string }): Promise<{ text: string }> {
    const spec = "tesseract.js";
    let mod: { recognize: (img: Buffer, lang: string) => Promise<{ data: { text: string } }> };
    try {
      mod = (await import(spec)) as unknown as typeof mod;
    } catch {
      throw new Error("OCR_PROVIDER=tesseract but the tesseract.js package is not installed.");
    }
    const res = await mod.recognize(buffer, process.env.OCR_LANG?.trim() || "eng");
    return { text: res.data.text ?? "" };
  }
}

/** Return the configured OCR provider, or null when OCR is off. */
export function getOcrProvider(): OcrProvider | null {
  const name = process.env.OCR_PROVIDER?.trim().toLowerCase();
  if (!name) return null;
  if (name === "tesseract") return new TesseractOcr();
  // Unknown provider name — treated as not configured (honest), not faked.
  return null;
}
