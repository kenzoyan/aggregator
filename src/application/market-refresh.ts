import type {
  FundNavProvider,
  MarketRefreshFailure,
  MarketPriceObservation,
} from "@/domain/market-data";
import type { PortfolioState, Position } from "@/domain/portfolio/types";
import { findSourceAccount } from "@/domain/source-accounts";

export interface MarketRefreshResult {
  refreshedAt: string;
  updated: number;
  recordedPrices: number;
  unchanged: number;
  skipped: number;
  failed: MarketRefreshFailure[];
}

function supportsFundNavRefresh(position: Position): position is Position & {
  instrumentCode: string;
} {
  const accountProvider = findSourceAccount(position.sourceAccountId)?.provider;
  return (
    (accountProvider === "alipay" || accountProvider === "wechat") &&
    (position.assetType === "fund" || position.assetType === "etf") &&
    position.currency === "CNY" &&
    Boolean(position.instrumentCode && /^\d{6}$/.test(position.instrumentCode))
  );
}

function newestKnownPriceDate(
  position: Position,
  observations: readonly MarketPriceObservation[],
): string | undefined {
  return [
    position.priceAsOf?.slice(0, 10),
    ...observations
      .filter((candidate) =>
        candidate.sourceAccountId === position.sourceAccountId &&
        candidate.instrumentId === position.instrumentId
      )
      .map((candidate) => candidate.asOf.slice(0, 10)),
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

export async function refreshFundNavs(input: {
  state: PortfolioState;
  existingObservations: readonly MarketPriceObservation[];
  monitoringStartedAtByPosition: Readonly<Record<string, string>>;
  provider: FundNavProvider;
  record: (
    observations: readonly MarketPriceObservation[],
  ) => void | Promise<void>;
  now: string;
}): Promise<MarketRefreshResult> {
  const eligible = input.state.positions.filter(supportsFundNavRefresh);
  const pending: MarketPriceObservation[] = [];
  const failed: MarketRefreshFailure[] = [];
  let unchanged = 0;
  let updated = 0;

  for (const position of eligible) {
    try {
      const positionKey = `${position.sourceAccountId}:${position.instrumentId}`;
      const monitoringStart = (
        input.monitoringStartedAtByPosition[positionKey] ??
        position.priceAsOf ??
        input.now
      ).slice(0, 10);
      const knownDate = newestKnownPriceDate(position, input.existingObservations);
      const fetchStart = knownDate && knownDate >= monitoringStart
        ? knownDate
        : monitoringStart;
      const quotes = await input.provider.fetchSince(
        position.instrumentCode,
        fetchStart,
      );
      const newQuotes = quotes.filter((quote) =>
        quote.asOf >= monitoringStart && (!knownDate || quote.asOf > knownDate)
      );
      if (newQuotes.length === 0) {
        unchanged += 1;
        continue;
      }
      for (const quote of newQuotes) {
        if (quote.currency !== position.currency) {
          throw new Error(
            `Currency mismatch: expected ${position.currency}, received ${quote.currency}`,
          );
        }
        pending.push({
          sourceAccountId: position.sourceAccountId,
          instrumentId: position.instrumentId,
          instrumentCode: position.instrumentCode,
          price: quote.price,
          currency: quote.currency,
          asOf: quote.asOf,
          recordedAt: input.now,
          source: quote.source,
        });
      }
      updated += 1;
    } catch (error) {
      failed.push({
        instrumentCode: position.instrumentCode,
        message: error instanceof Error ? error.message : "Unknown market data error",
      });
    }
  }

  if (pending.length > 0) await input.record(pending);

  return {
    refreshedAt: input.now,
    updated,
    recordedPrices: pending.length,
    unchanged,
    skipped: input.state.positions.length - eligible.length,
    failed,
  };
}
