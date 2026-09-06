import type { FundNavProvider, FundNavQuote } from "@/domain/market-data";

export interface DanskeFundRoute {
  fund: string;
  fundGroup: string;
  siteId: string;
}

function isoDate(finnishDate: string): string {
  const [day, month, year] = finnishDate.split(".");
  return `${year}-${month}-${day}`;
}

function decimalValue(localizedValue: string): string {
  return localizedValue.includes(",")
    ? localizedValue.replaceAll(".", "").replace(",", ".")
    : localizedValue;
}

export class DanskeInvestFundNavClient implements FundNavProvider {
  readonly id = "danske-invest";
  private readonly fetchFn: typeof fetch;
  private readonly today: () => string;
  private readonly fundRoutes: Readonly<Record<string, DanskeFundRoute>>;

  constructor(options: {
    fetch?: typeof fetch;
    today?: () => string;
    fundRoutes?: Readonly<Record<string, DanskeFundRoute>>;
  } = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.today = options.today ?? (() => new Date().toISOString().slice(0, 10));
    this.fundRoutes = options.fundRoutes ?? {};
  }

  supportsInstrumentCode(instrumentCode: string): boolean {
    return instrumentCode in this.fundRoutes;
  }

  async fetchSince(
    instrumentCode: string,
    sinceDate: string,
  ): Promise<FundNavQuote[]> {
    const route = this.fundRoutes[instrumentCode];
    if (!route) throw new Error(`Unsupported Danske Invest ISIN: ${instrumentCode}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
      throw new Error(`Unsupported monitoring date: ${sinceDate}`);
    }

    const url = new URL("https://www.danskeinvest.fi/w/show_hist.hist_data");
    url.searchParams.set("p_nId", route.siteId);
    url.searchParams.set("p_nFundgroup", route.fundGroup);
    url.searchParams.set("p_nFund", route.fund);
    url.searchParams.set("p_vDatoFra", sinceDate);
    url.searchParams.set("p_vDatoTil", this.today());
    url.searchParams.set("p_vFormat", "TABEL");
    url.searchParams.set("p_vType", "DAG");
    url.searchParams.set("p_vFelter", "IV;");

    const response = await this.fetchFn(url, {
      headers: { Accept: "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`Danske Invest NAV request failed with ${response.status}`);
    }
    const html = await response.text();
    if (html.length > 2_000_000) {
      throw new Error("Danske Invest NAV response exceeded the safety limit");
    }
    const rowPattern = /<tr[^>]*>\s*<td[^>]*>\s*(\d{2}\.\d{2}\.\d{4})\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>/gi;
    const quotes: FundNavQuote[] = [];
    for (const match of html.matchAll(rowPattern)) {
      const asOf = isoDate(match[1]!);
      if (asOf < sinceDate) continue;
      quotes.push({
        instrumentCode,
        price: decimalValue(match[2]!),
        currency: "EUR",
        asOf,
        source: this.id,
      });
    }
    if (quotes.length === 0 && !html.includes("<table")) {
      throw new Error(`No NAV data returned for Danske Invest fund ${instrumentCode}`);
    }
    return quotes.sort((left, right) => left.asOf.localeCompare(right.asOf));
  }
}
