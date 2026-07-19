import Decimal from "decimal.js";
import { z } from "zod";

import type { OpeningSnapshotInput } from "@/domain/portfolio/types";

const accountSummarySchema = z.object({
  cash: z.object({
    availableToTrade: z.number(),
    inPies: z.number(),
    reservedForOrders: z.number(),
  }),
  currency: z.string(),
  id: z.number(),
  investments: z.object({
    currentValue: z.number(),
    realizedProfitLoss: z.number(),
    totalCost: z.number(),
    unrealizedProfitLoss: z.number(),
  }),
  totalValue: z.number(),
});

const positionsSchema = z.array(
  z.object({
    averagePricePaid: z.number(),
    createdAt: z.string(),
    currentPrice: z.number(),
    instrument: z.object({
      currency: z.string(),
      isin: z.string(),
      name: z.string(),
      ticker: z.string(),
    }),
    quantity: z.number(),
    quantityAvailableForTrading: z.number(),
    quantityInPies: z.number(),
    walletImpact: z.object({
      currency: z.string(),
      currentValue: z.number(),
      fxImpact: z.number(),
      totalCost: z.number(),
      unrealizedProfitLoss: z.number(),
    }),
  }),
);

export interface Trading212ClientOptions {
  apiKey: string;
  apiSecret: string;
  environment: "demo" | "live";
  fetch?: typeof fetch;
  now?: () => Date;
}

export class Trading212Client {
  private readonly request: typeof fetch;
  private readonly now: () => Date;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(options: Trading212ClientOptions) {
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.baseUrl = `https://${options.environment}.trading212.com/api/v0`;
    this.headers = {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${options.apiKey}:${options.apiSecret}`).toString("base64")}`,
    };
  }

  private async get(path: string): Promise<unknown> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Trading 212 read failed with status ${response.status}`);
    }
    return response.json();
  }

  async fetchOpeningSnapshot(input: {
    id: string;
    sourceAccountId: string;
  }): Promise<OpeningSnapshotInput> {
    const [summaryValue, positionsValue] = await Promise.all([
      this.get("/equity/account/summary"),
      this.get("/equity/positions"),
    ]);
    const summary = accountSummarySchema.parse(summaryValue);
    const positions = positionsSchema.parse(positionsValue);
    const cash = new Decimal(summary.cash.availableToTrade)
      .plus(summary.cash.inPies)
      .plus(summary.cash.reservedForOrders);

    return {
      id: input.id,
      sourceAccountId: input.sourceAccountId,
      asOf: this.now().toISOString(),
      portfolioCash: {
        amount: cash.toString(),
        currency: summary.currency.toUpperCase(),
      },
      positions: positions.map((position) => ({
        instrumentId: position.instrument.ticker,
        quantity: new Decimal(position.quantity).toString(),
        currency: position.walletImpact.currency.toUpperCase(),
        costBasis: new Decimal(position.walletImpact.totalCost).toString(),
        reportedPriorReturn: new Decimal(
          position.walletImpact.unrealizedProfitLoss,
        ).toString(),
      })),
    };
  }
}
