import { z } from "zod";
import { danskeEuropeanEquitySource as fund } from "@/domain/public-fund-price-sources";
import type { FundNavProvider, FundNavQuote } from "@/domain/market-data";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";

function text(html: string) { return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim(); }
async function limitedHtml(response: Response) {
  if (!response.ok || !response.body) throw new Error(`Danske NAV request failed with ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new Error("Danske response exceeded the safety limit");
      html += decoder.decode(value, { stream: true });
    }
    return (html + decoder.decode()).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  } finally { await reader.cancel(); }
}

// Fixed public route, checked against the product's identity on every probe/refresh.
export class VerifiedDanskeFundNavClient implements FundNavProvider {
  readonly id = "danske-invest";
  constructor(private readonly options: { fetch?: typeof fetch; today?: () => string } = {}) {}
  supportsInstrumentCode(code: string) { return code === fund.isin; }
  async fetchSince(code: string, sinceDate: string): Promise<FundNavQuote[]> {
    if (!this.supportsInstrumentCode(code)) throw new Error("Unsupported public Danske ISIN");
    const today = this.options.today?.() ?? portfolioCalendarDate(new Date().toISOString());
    if (!z.iso.date().safeParse(sinceDate).success || !z.iso.date().safeParse(today).success || sinceDate > today) throw new Error("Invalid monitoring date");
    const signal = AbortSignal.timeout(8_000);
    const load = async (url: string | URL) => limitedHtml(await (this.options.fetch ?? fetch)(url, { cache: "no-store", redirect: "error", signal, headers: { Accept: "text/html" } }));
    const identity = await load(fund.identityUrl);
    const name = identity.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    const identityText = text(identity);
    if (!name || text(name) !== fund.name || !new RegExp(`\\bISIN: ${code}\\b`).test(identityText) ||
        !/<td\b[^>]*>\s*Perusvaluutta\s*<\/td>\s*<td\b[^>]*>\s*EUR\s*<\/td>/i.test(identity)) throw new Error("Danske fund identity or currency mismatch");
    const url = new URL("https://www.danskeinvest.fi/w/show_hist.hist_data");
    for (const [key, value] of Object.entries({ p_nId: fund.route.siteId, p_nFundgroup: fund.route.fundGroup, p_nFund: fund.route.fund, p_vDatoFra: sinceDate, p_vDatoTil: today, p_vFormat: "TABEL", p_vType: "DAG", p_vFelter: "IV;" })) url.searchParams.set(key, value);
    const html = await load(url);
    const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((m) => text(m[1]!));
    if (headers.join("|") !== "Pvm|Osuuden arvo") throw new Error("Unexpected Danske NAV columns");
    const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
    if (!body) throw new Error("No NAV data returned");
    const dates = new Set<string>(), quotes: FundNavQuote[] = [];
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1]!));
      if (cells.length !== 2 || !/^\d{2}\.\d{2}\.\d{4}$/.test(cells[0]!)) throw new Error("Invalid Danske NAV row");
      const [day, month, year] = cells[0]!.split('.');
      const asOf = `${year}-${month}-${day}`, raw = cells[1]!;
      if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$|^\d+(?:\.\d+)?$/.test(raw)) throw new Error("Invalid Danske NAV number");
      const price = raw.includes(',') ? raw.replaceAll('.', '').replace(',', '.') : raw;
      if (!z.iso.date().safeParse(asOf).success || asOf > today || dates.has(asOf) || !Number.isFinite(Number(price)) || Number(price) <= 0) throw new Error("Invalid Danske NAV observation");
      dates.add(asOf);
      if (asOf >= sinceDate) quotes.push({ instrumentCode: code, price, currency: fund.currency, asOf, source: this.id });
    }
    if (!dates.size) throw new Error("No NAV data returned");
    return quotes.sort((a, b) => a.asOf.localeCompare(b.asOf));
  }
}
