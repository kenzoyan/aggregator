import type {
  FundNavProvider,
  MarketRefreshFailure,
  MarketPriceObservation,
} from "@/domain/market-data";
import type { PortfolioState, Position } from "@/domain/portfolio/types";
import {
  createSourceAccountDefinition,
  findSourceAccount,
  type SourceAccountDefinition,
} from "@/domain/source-accounts";

function accountProvider(
  sourceAccountId: string,
  sourceAccounts: readonly SourceAccountDefinition[] = [],
) {
  const account = sourceAccounts.find((candidate) => candidate.id === sourceAccountId);
  if (account) {
    return account.provider === "generic"
      ? createSourceAccountDefinition(account).provider
      : account.provider;
  }
  return findSourceAccount(sourceAccountId)?.provider;
}

export interface MarketRefreshResult {
  refreshedAt: string;
  updated: number;
  recordedPrices: number;
  unchanged: number;
  skipped: number;
  failed: MarketRefreshFailure[];
}

export function safeMarketRefreshFailure(error: unknown): MarketRefreshFailure {
  const message = error instanceof Error ? error.message : "";
  const trading212Status = message.match(
    /Trading 212 read failed with status (\d{3})/i,
  )?.[1];
  if (trading212Status === "401" || trading212Status === "403") {
    return {
      instrumentCode: "",
      category: "authentication",
      message: "Trading 212 credentials or read permissions were rejected",
    };
  }
  if (trading212Status === "429") {
    return {
      instrumentCode: "",
      category: "rate-limit",
      message: "Trading 212 rate limit reached; try again later",
    };
  }
  if (trading212Status) {
    return {
      instrumentCode: "",
      category: "provider-error",
      message: `Trading 212 request failed (HTTP ${trading212Status})`,
    };
  }
  const httpStatus = message.match(/request failed with (\d{3})/i)?.[1];
  if (httpStatus) {
    return {
      instrumentCode: "",
      category: "provider-error",
      message: `Market data provider request failed (HTTP ${httpStatus})`,
    };
  }
  if (/timed? out|abort/i.test(message)) {
    return {
      instrumentCode: "",
      category: "timeout",
      message: "Market data provider request timed out",
    };
  }
  if (/currency mismatch/i.test(message)) {
    return {
      instrumentCode: "",
      category: "unexpected-currency",
      message: "Market data provider returned an unexpected currency",
    };
  }
  if (/no nav data returned/i.test(message)) {
    return {
      instrumentCode: "",
      category: "no-data",
      message: "Market data provider returned no NAV data",
    };
  }
  if (/exceeded the safety limit|pagination exceeded/i.test(message)) {
    return {
      instrumentCode: "",
      category: "safety-limit",
      message: "Market data provider response exceeded safety limits",
    };
  }
  return {
    instrumentCode: "",
    category: "provider-error",
    message: "Market data provider could not be refreshed",
  };
}

function isDanskeIsinPosition(position: Position, sourceAccounts: readonly SourceAccountDefinition[] = []): position is Position & {
  instrumentCode: string;
} {
  return accountProvider(position.sourceAccountId, sourceAccounts) === "danske" &&
    position.currency === "EUR" &&
    Boolean(
      position.instrumentCode &&
      /^[A-Z]{2}[A-Z0-9]{10}$/.test(position.instrumentCode),
    );
}

function isDanskeFundCandidate(position: Position, sourceAccounts: readonly SourceAccountDefinition[] = []): position is Position & {
  instrumentCode: string;
} {
  return isDanskeIsinPosition(position, sourceAccounts) &&
    (position.assetType === undefined ||
      position.assetType === "fund" ||
      position.assetType === "etf");
}

export function hasFundNavRefreshTarget(
  position: Position,
  provider?: FundNavProvider,
  sourceAccounts: readonly SourceAccountDefinition[] = [],
): boolean {
  return supportsFundNavRefresh(position, provider, sourceAccounts) ||
    isDanskeFundCandidate(position, sourceAccounts);
}

export function safeMarketRefreshFailureMessage(error: unknown): string {
  return safeMarketRefreshFailure(error).message;
}

export function supportsFundNavRefresh(
  position: Position,
  provider?: FundNavProvider,
  sourceAccounts: readonly SourceAccountDefinition[] = [],
): position is Position & {
  instrumentCode: string;
} {
  const sourceProvider = accountProvider(position.sourceAccountId, sourceAccounts);
  const sourceSupportsNav = (
    (sourceProvider === "alipay" || sourceProvider === "wechat") &&
    (position.assetType === "fund" || position.assetType === "etf") &&
    position.currency === "CNY" &&
    Boolean(position.instrumentCode && /^\d{6}$/.test(position.instrumentCode))
  ) || (isDanskeIsinPosition(position, sourceAccounts) &&
    (provider?.supportsInstrumentCode?.(position.instrumentCode) ?? false));
  return sourceSupportsNav && Boolean(
    position.instrumentCode &&
    (provider?.supportsInstrumentCode?.(position.instrumentCode) ?? true),
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
  sourceAccounts?: readonly SourceAccountDefinition[];
  existingObservations: readonly MarketPriceObservation[];
  monitoringStartedAtByPosition: Readonly<Record<string, string>>;
  provider: FundNavProvider;
  record: (
    observations: readonly MarketPriceObservation[],
  ) => void | Promise<void>;
  now: string;
}): Promise<MarketRefreshResult> {
  const eligible = input.state.positions.filter((position) =>
    supportsFundNavRefresh(position, input.provider, input.sourceAccounts)
  );
  const configurationFailures: MarketRefreshFailure[] = input.state.positions
    .flatMap((position) => {
      if (!isDanskeFundCandidate(position, input.sourceAccounts)) return [];
      if (!input.provider.supportsInstrumentCode) return [];
      if (input.provider.supportsInstrumentCode(position.instrumentCode)) return [];
      return [{
        instrumentCode: position.instrumentCode,
        category: "configuration",
        message: "Automatic NAV route is not configured for this Danske Invest fund",
      }];
    });
  const pending: MarketPriceObservation[] = [];
  const failed: MarketRefreshFailure[] = [...configurationFailures];
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
        quote.asOf >= monitoringStart && (
          !knownDate || quote.asOf > knownDate || (
            quote.asOf === knownDate &&
            !input.existingObservations.some((observation) =>
              observation.sourceAccountId === position.sourceAccountId &&
              observation.instrumentId === position.instrumentId &&
              observation.asOf.slice(0, 10) === quote.asOf
            )
          )
        )
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
        ...safeMarketRefreshFailure(error),
        instrumentCode: position.instrumentCode,
      });
    }
  }

  if (pending.length > 0) await input.record(pending);

  return {
    refreshedAt: input.now,
    updated,
    recordedPrices: pending.length,
    unchanged,
    skipped: input.state.positions.length - eligible.length -
      configurationFailures.length,
    failed,
  };
}
