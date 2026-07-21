import { z } from "zod";

import type { FundNavProvider, FundNavQuote } from "@/domain/market-data";

const responseSchema = z.object({
  ErrCode: z.number(),
  Data: z.object({
    LSJZList: z.array(z.object({
      FSRQ: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      DWJZ: z.string().regex(/^\d+(?:\.\d+)?$/),
      JZZZL: z.string().optional(),
    })),
  }),
});

export class EastmoneyFundNavClient implements FundNavProvider {
  readonly id = "eastmoney";
  private readonly fetchFn: typeof fetch;

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.fetchFn = options.fetch ?? fetch;
  }

  async fetchSince(
    instrumentCode: string,
    sinceDate: string,
  ): Promise<FundNavQuote[]> {
    if (!/^\d{6}$/.test(instrumentCode)) {
      throw new Error(`Unsupported fund code: ${instrumentCode}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
      throw new Error(`Unsupported monitoring date: ${sinceDate}`);
    }

    const pageSize = 20;
    const items: Array<z.infer<typeof responseSchema>["Data"]["LSJZList"][number]> = [];
    for (let pageIndex = 1; pageIndex <= 250; pageIndex += 1) {
      const url = new URL("https://api.fund.eastmoney.com/f10/lsjz");
      url.searchParams.set("fundCode", instrumentCode);
      url.searchParams.set("pageIndex", String(pageIndex));
      url.searchParams.set("pageSize", String(pageSize));

      const response = await this.fetchFn(url, {
        headers: {
          Accept: "application/json",
          Referer: "https://fundf10.eastmoney.com/",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new Error(`Eastmoney NAV request failed with ${response.status}`);
      }
      const payload = responseSchema.parse(await response.json());
      if (payload.ErrCode !== 0) {
        throw new Error(`No NAV data returned for fund ${instrumentCode}`);
      }
      const pageItems = payload.Data.LSJZList;
      items.push(...pageItems);
      const oldestDate = pageItems.map((item) => item.FSRQ).sort().at(0);
      if (
        pageItems.length < pageSize ||
        (oldestDate !== undefined && oldestDate <= sinceDate)
      ) break;
      if (pageIndex === 250) {
        throw new Error(`NAV history pagination exceeded the safety limit for ${instrumentCode}`);
      }
    }

    const quotes = items
      .filter((item) => item.FSRQ >= sinceDate)
      .map((item): FundNavQuote => ({
        instrumentCode,
        price: item.DWJZ,
        currency: "CNY",
        asOf: item.FSRQ,
        ...(item.JZZZL ? { dailyChangePercent: item.JZZZL } : {}),
        source: "eastmoney",
      }));
    return [...new Map(quotes.map((quote) => [quote.asOf, quote])).values()]
      .sort((left, right) => left.asOf.localeCompare(right.asOf));
  }
}
