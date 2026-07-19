import Decimal from "decimal.js";

const ECB_DAILY_RATES_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export interface EcbRates {
  asOf: string;
  eurPerUnit: Record<string, string>;
}

export class EcbFxClient {
  private readonly request: typeof fetch;

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.request = options.fetch ?? fetch;
  }

  async fetchLatestRates(): Promise<EcbRates> {
    const response = await this.request(ECB_DAILY_RATES_URL, {
      method: "GET",
      headers: { accept: "application/xml,text/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`ECB FX request failed with status ${response.status}`);
    }

    const xml = await response.text();
    const date = xml.match(/\btime=["']([^"']+)["']/)?.[1];
    if (!date) {
      throw new Error("ECB FX response did not include an observation date");
    }

    const eurPerUnit: Record<string, string> = { EUR: "1" };
    const quotePattern = /\bcurrency=["']([A-Z]{3})["'][^>]*\brate=["']([^"']+)["']/g;
    for (const match of xml.matchAll(quotePattern)) {
      eurPerUnit[match[1]] = new Decimal(1).div(match[2]).toString();
    }

    return { asOf: date, eurPerUnit };
  }
}
