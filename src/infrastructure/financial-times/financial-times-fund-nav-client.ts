import { z } from "zod";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import type { FundNavProvider, FundNavQuote } from "@/domain/market-data";

const pilotIsin = "FI4000439773";
const maximumBytes = 1_000_000;
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function text(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim();
}
function fullDate(cell: string): string {
  const match = text(cell).match(/^[A-Za-z]+, ([A-Za-z]+) (\d{2}), (\d{4})/);
  const month = match ? months.indexOf(match[1]!) + 1 : 0;
  const date = match && month ? `${match[3]}-${String(month).padStart(2, "0")}-${match[2]}` : "";
  if (!z.iso.date().safeParse(date).success) throw new Error("Invalid FT valuation date");
  return date;
}
async function readLimitedHtml(response: Response): Promise<string> {
  if (!response.body) throw new Error("No NAV data returned");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error("FT response exceeded the safety limit");
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    await reader.cancel();
  }
}

// First verified share class only. New funds need identity and parser coverage before registration.
export class FinancialTimesFundNavClient implements FundNavProvider {
  readonly id = "financial-times";
  constructor(private readonly options: { fetch?: typeof fetch; today?: () => string } = {}) {}
  supportsInstrumentCode(code: string): boolean { return code === pilotIsin; }

  async fetchSince(code: string, sinceDate: string): Promise<FundNavQuote[]> {
    if (!this.supportsInstrumentCode(code)) throw new Error("Unsupported FT fund ISIN");
    if (!z.iso.date().safeParse(sinceDate).success) throw new Error("Invalid monitoring date");
    const today = this.options.today?.() ?? portfolioCalendarDate(new Date().toISOString());
    const url = new URL("https://markets.ft.com/data/funds/tearsheet/historical");
    url.searchParams.set("s", `${code}:EUR`);
    const response = await (this.options.fetch ?? fetch)(url, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
      headers: { Accept: "text/html" },
    });
    if (!response.ok) throw new Error(`FT NAV request failed with ${response.status}`);
    const html = (await readLimitedHtml(response))
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    const symbol = html.match(/<div\b[^>]*class="[^"]*mod-tearsheet-overview__header__symbol[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const name = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    if (!symbol || text(symbol) !== `${code}:EUR` || !name || text(name) !== "OP-Europe Fund A") {
      throw new Error("FT fund identity or currency mismatch");
    }
    const table = html.match(/<table\b[^>]*class="[^"]*mod-tearsheet-historical-prices__results[^"]*"[^>]*>([\s\S]*?)<\/table>/)?.[1];
    if (!table) throw new Error("No NAV data returned");
    const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]!));
    if (headers.join("|") !== "Date|Open|High|Low|Close|Volume") throw new Error("Unexpected FT price columns");
    const quotes: FundNavQuote[] = [];
    const dates = new Set<string>();
    for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
      if (!cells.length) continue;
      if (cells.length !== 6) throw new Error("Unexpected FT price row");
      const asOf = fullDate(cells[0]!);
      const rawPrice = text(cells[4]!);
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(rawPrice)) throw new Error("Invalid FT NAV number format");
      const price = rawPrice.replaceAll(",", "");
      if (asOf > today || dates.has(asOf) || !/^\d+(?:\.\d+)?$/.test(price) || !Number.isFinite(Number(price)) || Number(price) <= 0) {
        throw new Error("Invalid FT NAV observation");
      }
      dates.add(asOf);
      if (asOf >= sinceDate) quotes.push({ instrumentCode: code, currency: "EUR", price, asOf, source: this.id });
    }
    if (!dates.size) throw new Error("No NAV data returned");
    return quotes.sort((a, b) => a.asOf.localeCompare(b.asOf));
  }
}
