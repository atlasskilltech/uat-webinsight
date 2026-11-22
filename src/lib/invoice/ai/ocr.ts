import "server-only";
import { ocrProviderConfigured } from "../config";
import { DocumentAiOcr } from "./documentai";

/**
 * Provider-independent OCR abstraction. OCR converts scanned PDFs / images into
 * text for the AI extractor. It is OFF until OCR_PROVIDER is configured, so the
 * UI shows an honest "OCR not configured" state rather than faking a result.
 *
 * Implementations are added per provider. "tesseract" is supported if the
 * optional `tesseract.js` package is installed (not bundled by default to keep
 * the build light). "documentai" (Google Cloud Document AI Invoice Parser) is
 * supported when its DOCAI_* vars + a service-account credential are set.
 */
export interface OcrProvider {
  readonly name: string;
  recognize(input: { buffer: Buffer; mimeType: string }): Promise<{ text: string }>;
}

/**
 * Whether the selected OCR provider is fully configured. Delegates to the pure
 * (env-only) validator in config so provider requirements live in one place
 * (e.g. Document AI needs its DOCAI_* vars + a service-account credential).
 */
export function ocrConfigured(): boolean {
  return ocrProviderConfigured();
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

/** Return the configured OCR provider, or null when OCR is off/misconfigured. */
export function getOcrProvider(): OcrProvider | null {
  const name = process.env.OCR_PROVIDER?.trim().toLowerCase();
  if (!name) return null;
  if (name === "tesseract") return new TesseractOcr();
  if (name === "documentai") {
    // Only return a provider when fully configured, so a half-set DOCAI config
    // stays honestly "off" (null) instead of throwing mid-pipeline.
    if (!ocrProviderConfigured()) return null;
    return new DocumentAiOcr();
  }
  // Unknown provider name — treated as not configured (honest), not faked.
  return null;
}
