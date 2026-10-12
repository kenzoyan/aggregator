import { z } from "zod";

import {
  bindingMatchesPosition,
  discoverPriceSourceCandidates,
  type PriceSourceBinding,
  type PriceSourceCandidate,
  type PriceSourceProviders,
} from "@/application/price-source-discovery";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import type { FundNavProvider, FundNavQuote } from "@/domain/market-data";
import type { PortfolioState, Position } from "@/domain/portfolio/types";
import { createSourceAccountDefinition, type SourceAccountDefinition } from "@/domain/source-accounts";

export const lookupSchema = z.object({
  sourceAccountId: z.string().trim().min(1).max(100),
  instrumentId: z.string().trim().min(1).max(200),
});
export const confirmSchema = lookupSchema.extend({ candidateId: z.string().trim().min(1).max(100) });

export interface PriceSourceDatabase {
  readPortfolioFacts(): { state: PortfolioState };
  readSourceAccounts(): SourceAccountDefinition[];
  readPriceSourceBindings(): PriceSourceBinding[];
  savePriceSourceBinding(binding: PriceSourceBinding): void;
}

export function currentPriceSourcePosition(database: PriceSourceDatabase, sourceAccountId: string, instrumentId: string): {
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

function latestValidQuote(quotes: readonly FundNavQuote[], candidate: PriceSourceCandidate, since: string, date: string): FundNavQuote | undefined {
  return quotes
    .filter((quote) => quote.instrumentCode === candidate.instrumentCode && quote.currency === candidate.currency &&
      quote.source === candidate.provider && z.iso.date().safeParse(quote.asOf).success &&
      quote.asOf >= since && quote.asOf <= date && Number.isFinite(Number(quote.price)) && Number(quote.price) > 0)
    .sort((left, right) => right.asOf.localeCompare(left.asOf))[0];
}

export function createPriceSourceService(input: {
  database: PriceSourceDatabase;
  fundNavProvider: FundNavProvider;
  priceSourceProviders?: PriceSourceProviders;
  now?: () => string;
}) {
  async function candidateQuote(candidate: PriceSourceCandidate): Promise<FundNavQuote | undefined> {
    const today = portfolioCalendarDate(input.now?.() ?? new Date().toISOString());
    const since = new Date(`${today}T00:00:00.000Z`);
    since.setUTCDate(since.getUTCDate() - 30);
    try {
      const provider = input.priceSourceProviders?.[candidate.provider] ??
        (candidate.provider === "eastmoney" ? input.fundNavProvider : undefined);
      if (!provider) return undefined;
      const start = since.toISOString().slice(0, 10);
      const quotes = await provider.fetchSince(candidate.instrumentCode, start);
      return latestValidQuote(quotes, candidate, start, today);
    } catch {
      return undefined;
    }
  }

  return {
    async lookup(args: unknown) {
      const parsed = lookupSchema.safeParse(args);
      if (!parsed.success) throw new PriceSourceError(400, "Choose a holding.");
      const current = currentPriceSourcePosition(input.database, parsed.data.sourceAccountId, parsed.data.instrumentId);
      if (!current) throw new PriceSourceError(404, "Holding was not found.");

      const binding = input.database.readPriceSourceBindings().find((item) =>
        bindingMatchesPosition(item, current.position)
      );
      if (binding) return { binding, candidates: [] };

      const candidates = discoverPriceSourceCandidates(current.position, current.provider);
      const quoted = await Promise.all(candidates.map(async (candidate) => {
        const quote = await candidateQuote(candidate);
        return {
          ...candidate,
          ...(quote ? { price: quote.price, priceAsOf: quote.asOf } : {}),
          quoteAvailable: Boolean(quote),
        };
      }));
      return { binding: null, candidates: quoted };
    },

    async confirm(args: unknown, canConfirm?: () => boolean) {
      const parsed = confirmSchema.safeParse(args);
      if (!parsed.success) throw new PriceSourceError(400, "Choose a price source candidate.");
      const current = currentPriceSourcePosition(input.database, parsed.data.sourceAccountId, parsed.data.instrumentId);
      if (!current) throw new PriceSourceError(404, "Holding was not found.");
      const existing = input.database.readPriceSourceBindings().find((item) =>
        bindingMatchesPosition(item, current.position)
      );
      if (existing) return { binding: existing };

      const candidate = discoverPriceSourceCandidates(current.position, current.provider)
        .find((item) => item.id === parsed.data.candidateId);
      if (!candidate) throw new PriceSourceError(409, "This source does not match the holding.");
      if (!await candidateQuote(candidate)) {
        throw new PriceSourceError(503, "A recent NAV could not be verified. Try again later.");
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
      const latest = currentPriceSourcePosition(input.database, parsed.data.sourceAccountId, parsed.data.instrumentId);
      if (!latest || !bindingMatchesPosition(binding, latest.position) ||
          !discoverPriceSourceCandidates(latest.position, latest.provider).some((item) => item.id === candidate.id)) {
        throw new PriceSourceError(409, "The holding changed. Choose the price source again.");
      }
      if (canConfirm && !canConfirm()) throw new PriceSourceError(409, "The price source review changed. Open it again.");
      input.database.savePriceSourceBinding(binding);
      return { binding };
    },
  };
}

export class PriceSourceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
