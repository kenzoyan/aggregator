import { z } from "zod";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { nordeaEuropeanIndexSource as fund } from "@/domain/public-fund-price-sources";
import type { FundNavProvider, FundNavQuote } from "@/domain/market-data";

const dataSchema = z.object({ Fund: z.object({
  ISIN: z.literal(fund.isin), MediumName: z.literal(fund.name), BasisValuta: z.literal(fund.currency),
  LatestNAV: z.object({ "@Date": z.iso.datetime({ offset: true }), "#": z.string().regex(/^\d+(?:\.\d+)?$/) }),
}) });

async function limitedHtml(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error(`Nordea NAV request failed with ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Nordea response exceeded the safety limit");
      html += decoder.decode(value, { stream: true });
    }
    return (html + decoder.decode()).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  } finally { await reader.cancel(); }
}

function attributeJson(value: string): unknown {
  const decoded = value.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = { "&quot;": '"', "&apos;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]!;
    const code = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    if (code > 0x10ffff) throw new Error("Invalid Nordea data entity");
    return String.fromCodePoint(code);
  });
  return JSON.parse(decoded);
}

// Latest dated unit NAV only. The chart's rebased performance and benchmark are not NAV history.
export class NordeaFundNavClient implements FundNavProvider {
  readonly id = "nordea-funds";
  constructor(private readonly options: { fetch?: typeof fetch; today?: () => string } = {}) {}
  supportsInstrumentCode(code: string) { return code === fund.isin; }
  async fetchSince(code: string, sinceDate: string): Promise<FundNavQuote[]> {
    if (!this.supportsInstrumentCode(code)) throw new Error("Unsupported Nordea fund ISIN");
    const today = this.options.today?.() ?? portfolioCalendarDate(new Date().toISOString());
    if (!z.iso.date().safeParse(sinceDate).success || !z.iso.date().safeParse(today).success || sinceDate > today) throw new Error("Invalid monitoring date");
    const html = await limitedHtml(await (this.options.fetch ?? fetch)(fund.identityUrl, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000), headers: { Accept: "text/html" },
    }));
    const attributes = [...html.matchAll(/<vue-chart-line\b[^>]*\s:chart-data=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)];
    if (attributes.length !== 1) throw new Error("Missing or ambiguous Nordea fund data");
    const { Fund } = dataSchema.parse(attributeJson(attributes[0]![1] ?? attributes[0]![2]!));
    // Preserve the source's valuation calendar date; converting midnight to UTC would shift it.
    const asOf = Fund.LatestNAV["@Date"].slice(0, 10), price = Fund.LatestNAV["#"];
    if (!z.iso.date().safeParse(asOf).success || asOf > today || !Number.isFinite(Number(price)) || Number(price) <= 0) throw new Error("Invalid Nordea NAV observation");
    return asOf < sinceDate ? [] : [{ instrumentCode: code, price, currency: fund.currency, asOf, source: this.id }];
  }
}
