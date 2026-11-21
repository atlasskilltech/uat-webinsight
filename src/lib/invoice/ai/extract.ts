import "server-only";
import { ExtractedInvoiceSchema, EXTRACTION_SYSTEM_PROMPT, type ExtractedInvoice } from "./types";

/**
 * Provider-independent AI invoice extractor. OFF until AI_PROVIDER + AI_API_KEY
 * are set, so the pipeline degrades to "manual review" honestly instead of
 * fabricating fields. The model output is ALWAYS validated with Zod and its
 * totals are recomputed/cross-checked downstream — never trusted directly.
 */
export interface ExtractionResult {
  data: ExtractedInvoice;
  raw: unknown;
  provider: string;
  model: string;
}

export interface AIExtractor {
  readonly provider: string;
  readonly model: string;
  extract(input: { text: string }): Promise<ExtractionResult>;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_PROVIDER?.trim() && process.env.AI_API_KEY?.trim());
}

const JSON_SHAPE_HINT = `Return a JSON object with these keys (use null when not present):
invoiceNumber, invoiceDate (yyyy-mm-dd), dueDate (yyyy-mm-dd), poNumber, currency, paymentTerms,
supplierName, supplierAddress, supplierGstin, buyerName, buyerGstin,
lineItems: [{ description, hsnSac, quantity, unit, unitPrice, discount, gstRate }],
subtotal, discountTotal, taxableAmount, cgst, sgst, igst, cess, otherCharges, grandTotal,
amountPaid, balanceDue, bankDetails, fieldConfidence (object of field->0..1).`;

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

/** Anthropic Messages API extractor (uses the caller's own AI_API_KEY). */
class AnthropicExtractor implements AIExtractor {
  readonly provider = "anthropic";
  readonly model = process.env.AI_MODEL?.trim() || "claude-sonnet-5-5";

  async extract({ text }: { text: string }): Promise<ExtractionResult> {
    const key = process.env.AI_API_KEY?.trim();
    if (!key) throw new Error("AI_API_KEY is not set.");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4000,
        system: `${EXTRACTION_SYSTEM_PROMPT}\n\n${JSON_SHAPE_HINT}`,
        messages: [
          {
            role: "user",
            content: `<invoice_document>\n${text.slice(0, 60000)}\n</invoice_document>\n\nExtract the invoice as JSON.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      throw new Error(`AI extraction failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { content?: { text?: string }[] };
    const textOut = json.content?.map((c) => c.text ?? "").join("") ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(textOut));
    } catch {
      throw new Error("AI returned invalid JSON.");
    }
    const validated = ExtractedInvoiceSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`AI output failed validation: ${validated.error.issues[0]?.message ?? "schema mismatch"}`);
    }
    return { data: validated.data, raw: parsed, provider: this.provider, model: this.model };
  }
}

/** Return the configured extractor, or null when AI is off. */
export function getExtractor(): AIExtractor | null {
  if (!aiConfigured()) return null;
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (provider === "anthropic") return new AnthropicExtractor();
  // Unknown provider -> treated as not configured (honest).
  return null;
}
