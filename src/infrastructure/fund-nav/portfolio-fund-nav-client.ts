import type { FundNavProvider, FundNavQuote } from "@/domain/market-data";

export class PortfolioFundNavClient implements FundNavProvider {
  readonly id: string;

  constructor(private readonly providers: readonly FundNavProvider[]) {
    this.id = providers.map((provider) => provider.id).join("+");
  }

  supportsInstrumentCode(instrumentCode: string): boolean {
    return this.providers.some((provider) =>
      provider.supportsInstrumentCode?.(instrumentCode) ?? true
    );
  }

  fetchSince(instrumentCode: string, sinceDate: string): Promise<FundNavQuote[]> {
    const provider = this.providers.find((candidate) =>
      candidate.supportsInstrumentCode?.(instrumentCode) ?? true
    );
    if (!provider) throw new Error(`Unsupported fund identifier: ${instrumentCode}`);
    return provider.fetchSince(instrumentCode, sinceDate);
  }
}
