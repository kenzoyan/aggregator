import { NextResponse } from "next/server";
import { z } from "zod";

import {
  bindingMatchesPosition,
  discoverPriceSourceCandidates,
  type PriceSourceBinding,
} from "@/application/price-source-discovery";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import type { FundNavProvider, FundNavQuote } from "@/domain/market-data";
import type { PortfolioState, Position } from "@/domain/portfolio/types";
import { createSourceAccountDefinition, type SourceAccountDefinition } from "@/domain/source-accounts";

const lookupSchema = z.object({
  sourceAccountId: z.string().trim().min(1).max(100),
  instrumentId: z.string().trim().min(1).max(200),
});
const confirmSchema = lookupSchema.extend({ candidateId: z.string().trim().min(1).max(100) });

interface PriceSourceDatabase {
  readPortfolioFacts(): { state: PortfolioState };
  readSourceAccounts(): SourceAccountDefinition[];
  readPriceSourceBindings(): PriceSourceBinding[];
  savePriceSourceBinding(binding: PriceSourceBinding): void;
}

function currentPosition(database: PriceSourceDatabase, sourceAccountId: string, instrumentId: string): {
  position: Position;
  provider: string;
} | undefined {
  const account = database.readSourceAccounts().find((item) => item.id === sourceAccountId);
  const position = database.readPortfolioFacts().state.positions.find((item) =>
    item.sourceAccountId === sourceAccountId && item.instrumentId === instrumentId
  );
  if (!account || !position) return undefined;
  return {
    position,
    provider: account.provider === "generic"
      ? createSourceAccountDefinition(account).provider
      : account.provider,
  };
}

function latestValidQuote(quotes: readonly FundNavQuote[], code: string, date: string): FundNavQuote | undefined {
  return quotes
    .filter((quote) => quote.instrumentCode === code && quote.currency === "CNY" &&
      quote.source === "eastmoney" && /^\d{4}-\d{2}-\d{2}$/.test(quote.asOf) &&
      quote.asOf <= date && Number(quote.price) > 0)
    .sort((left, right) => right.asOf.localeCompare(left.asOf))[0];
}

export function createPriceSourceHandler(input: {
  database: PriceSourceDatabase;
  fundNavProvider: FundNavProvider;
  now?: () => string;
}) {
  async function candidateQuote(code: string): Promise<FundNavQuote | undefined> {
    const today = portfolioCalendarDate(input.now?.() ?? new Date().toISOString());
    const since = new Date(`${today}T00:00:00.000Z`);
    since.setUTCDate(since.getUTCDate() - 30);
    try {
      const quotes = await input.fundNavProvider.fetchSince(code, since.toISOString().slice(0, 10));
      return latestValidQuote(quotes, code, today);
    } catch {
      return undefined;
    }
  }

  return {
    async lookup(request: Request) {
      const url = new URL(request.url);
      const parsed = lookupSchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) return NextResponse.json({ error: "Choose a holding." }, { status: 400 });
      const current = currentPosition(input.database, parsed.data.sourceAccountId, parsed.data.instrumentId);
      if (!current) return NextResponse.json({ error: "Holding was not found." }, { status: 404 });

      const binding = input.database.readPriceSourceBindings().find((item) =>
        bindingMatchesPosition(item, current.position)
      );
      if (binding) return NextResponse.json({ binding, candidates: [] });

      const candidates = discoverPriceSourceCandidates(current.position, current.provider);
      const quoted = await Promise.all(candidates.map(async (candidate) => {
        const quote = await candidateQuote(candidate.instrumentCode);
        return {
          ...candidate,
          ...(quote ? { price: quote.price, priceAsOf: quote.asOf } : {}),
          quoteAvailable: Boolean(quote),
        };
      }));
      return NextResponse.json({ binding: null, candidates: quoted }, {
        headers: { "Cache-Control": "no-store" },
      });
    },

    async confirm(request: Request) {
      const parsed = confirmSchema.safeParse(await request.json().catch(() => ({})));
      if (!parsed.success) return NextResponse.json({ error: "Choose a price source candidate." }, { status: 400 });
      const current = currentPosition(input.database, parsed.data.sourceAccountId, parsed.data.instrumentId);
      if (!current) return NextResponse.json({ error: "Holding was not found." }, { status: 404 });
      const existing = input.database.readPriceSourceBindings().find((item) =>
        bindingMatchesPosition(item, current.position)
      );
      if (existing) return NextResponse.json({ binding: existing });

      const candidate = discoverPriceSourceCandidates(current.position, current.provider)
        .find((item) => item.id === parsed.data.candidateId);
      if (!candidate) return NextResponse.json({ error: "This source does not match the holding." }, { status: 409 });
      if (!await candidateQuote(candidate.instrumentCode)) {
        return NextResponse.json({ error: "A recent NAV could not be verified. Try again later." }, { status: 503 });
      }

      const binding: PriceSourceBinding = {
        sourceAccountId: current.position.sourceAccountId,
        instrumentId: current.position.instrumentId,
        instrumentName: current.position.displayName ?? candidate.name,
        instrumentCode: candidate.instrumentCode,
        currency: candidate.currency,
        shareClass: candidate.shareClass,
        provider: candidate.provider,
        identityUrl: candidate.identityUrl,
        confirmedAt: input.now?.() ?? new Date().toISOString(),
      };
      input.database.savePriceSourceBinding(binding);
      return NextResponse.json({ binding });
    },
  };
}
