import {
  hasFundNavRefreshTarget,
  refreshFundNavs,
  safeMarketRefreshFailure,
  type MarketRefreshResult,
} from "@/application/market-refresh";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { applyConfirmedPriceSources, bindingMatchesPosition, type PriceSourceBinding, type PriceSourceRefreshStatus } from "@/application/price-source-discovery";
import { marketObservationsFromTrading212Snapshot } from "@/application/trading212-market-data";
import type {
  FundNavProvider,
  MarketPriceObservation,
  MarketRefreshFailure,
  MarketRefreshRecord,
} from "@/domain/market-data";
import type {
  OpeningSnapshotInput,
  PortfolioState,
} from "@/domain/portfolio/types";
import { trading212SourceAccountId } from "@/domain/source-accounts";
import type { SourceAccountDefinition } from "@/domain/source-accounts";

export type MarketDataRefreshMode = "manual" | "automatic";

export type MarketDataRefreshOutcome =
  | (MarketRefreshResult & { automatic: boolean })
  | {
      automatic: true;
      skipped: true;
      reason: "already-refreshed-today";
      lastRefreshedAt: string;
    }
  | {
      automatic: true;
      skipped: true;
      reason: "no-refreshable-positions";
    };

interface MarketRefreshDatabase {
  readSourceAccounts?(): SourceAccountDefinition[];
  readPriceSourceBindings?(): PriceSourceBinding[];
  readPortfolioFacts(): {
    state: PortfolioState;
    openingSnapshots: OpeningSnapshotInput[];
  };
  readMarketData(): {
    observations: MarketPriceObservation[];
    latestMarketRefresh?: MarketRefreshRecord;
  };
  recordMarketData(input: {
    observations: readonly MarketPriceObservation[];
    refresh: MarketRefreshRecord;
    priceSourceStatuses?: readonly PriceSourceRefreshStatus[];
  }): void;
}

export interface MarketDataRefreshDependencies {
  database: MarketRefreshDatabase;
  fundNavProvider: FundNavProvider;
  refreshTrading212Snapshot?: () => Promise<OpeningSnapshotInput | undefined>;
  now?: () => string;
}

const retryDelayMs = 30 * 60 * 1000;
const retryableCategories = new Set<MarketRefreshFailure["category"]>([
  "timeout",
  "rate-limit",
  "provider-error",
]);

function retryableFailure(failure: MarketRefreshFailure): boolean {
  return Boolean(
    failure.sourceAccountId && failure.instrumentId &&
    retryableCategories.has(failure.category) &&
    (failure.retryCount ?? 0) < 1,
  );
}

function failureKey(failure: Pick<MarketRefreshFailure, "sourceAccountId" | "instrumentId">): string {
  return `${failure.sourceAccountId}:${failure.instrumentId}`;
}

export function createMarketDataRefresh(
  input: MarketDataRefreshDependencies,
) {
  let automaticRefreshTail = Promise.resolve();

  async function perform(
    mode: MarketDataRefreshMode = "manual",
  ): Promise<MarketDataRefreshOutcome> {
    const now = input.now?.() ?? new Date().toISOString();
    const automatic = mode === "automatic";
    const marketData = input.database.readMarketData();
    const latest = marketData.latestMarketRefresh;
    const alreadyRefreshedToday = Boolean(
      automatic && latest &&
      portfolioCalendarDate(latest.completedAt) === portfolioCalendarDate(now),
    );
    const retryFailures = alreadyRefreshedToday && latest &&
      Date.parse(now) - Date.parse(latest.completedAt) >= retryDelayMs
      ? latest.failures.filter(retryableFailure)
      : [];
    if (alreadyRefreshedToday && latest && retryFailures.length === 0) {
      return {
        automatic: true,
        skipped: true,
        reason: "already-refreshed-today",
        lastRefreshedAt: latest.completedAt,
      };
    }

    const facts = input.database.readPortfolioFacts();
    const bindings = input.database.readPriceSourceBindings?.() ?? [];
    const confirmedState = applyConfirmedPriceSources(facts.state, bindings);
    const bindingKeys = new Set(bindings.filter((binding) =>
      facts.state.positions.some((position) => bindingMatchesPosition(binding, position))
    ).map((binding) => `${binding.sourceAccountId}:${binding.instrumentId}:${binding.instrumentCode}`));
    const sourceAccounts = input.database.readSourceAccounts?.() ?? [];
    const retryTargetKeys = new Set(retryFailures.map(failureKey));
    const retrying = retryFailures.length > 0;
    const refreshState = retrying ? {
      ...confirmedState,
      positions: confirmedState.positions.filter((position) =>
        retryTargetKeys.has(`${position.sourceAccountId}:${position.instrumentId}`)
      ),
    } : confirmedState;
    const refreshTrading212 = Boolean(
      input.refreshTrading212Snapshot &&
      (!retrying || retryTargetKeys.has(`${trading212SourceAccountId}:snapshot`)),
    );
    const hasRefreshablePosition = refreshState.positions.some((position) =>
      hasFundNavRefreshTarget(position, input.fundNavProvider, sourceAccounts)
    ) || (refreshTrading212 && facts.state.positions.some((position) =>
      position.sourceAccountId === trading212SourceAccountId
    ));
    if (automatic && !hasRefreshablePosition) {
      return {
        automatic: true,
        skipped: true,
        reason: "no-refreshable-positions",
      };
    }

    const observations: MarketPriceObservation[] = [];
    const priceSourceStatuses: PriceSourceRefreshStatus[] = [];
    const result = await refreshFundNavs({
      state: refreshState,
      sourceAccounts,
      existingObservations: marketData.observations,
      monitoringStartedAtByPosition: Object.fromEntries(
        facts.openingSnapshots
          .flatMap((snapshot) => snapshot.positions.map((position) => ({
            key: `${snapshot.sourceAccountId}:${position.instrumentId}`,
            asOf: snapshot.asOf,
          })))
          .sort((left, right) => right.asOf.localeCompare(left.asOf))
          .map((item) => [item.key, item.asOf]),
      ),
      provider: input.fundNavProvider,
      record: (recorded) => { observations.push(...recorded); },
      onAttempt: (attempt) => {
        if (bindingKeys.has(`${attempt.sourceAccountId}:${attempt.instrumentId}:${attempt.instrumentCode}`)) {
          const savedNavDate = attempt.outcome === "unchanged"
            ? marketData.observations
              .filter((observation) => observation.sourceAccountId === attempt.sourceAccountId &&
                observation.instrumentId === attempt.instrumentId && observation.source === "eastmoney")
              .map((observation) => observation.asOf.slice(0, 10)).sort().at(-1)
            : attempt.latestPriceAsOf;
          priceSourceStatuses.push({
            ...attempt,
            provider: "eastmoney",
            ...(savedNavDate ? { latestPriceAsOf: savedNavDate } : {}),
          });
        }
      },
      now,
    });

    let trading212Updated = 0;
    let trading212Included = false;
    const trading212Failures: MarketRefreshFailure[] = [];
    if (refreshTrading212 && input.refreshTrading212Snapshot) {
      try {
        const snapshot = await input.refreshTrading212Snapshot();
        if (snapshot) {
          trading212Included = true;
          const confirmedPositionIds = new Set(
            facts.state.positions
              .filter((position) => position.sourceAccountId === snapshot.sourceAccountId)
              .map((position) => position.instrumentId),
          );
          const refreshed = marketObservationsFromTrading212Snapshot(snapshot)
            .filter((observation) => confirmedPositionIds.has(observation.instrumentId));
          observations.push(...refreshed);
          trading212Updated = refreshed.length;
        }
      } catch (error) {
        trading212Included = true;
        trading212Failures.push({
          ...safeMarketRefreshFailure(error),
          instrumentCode: "Trading 212",
          sourceAccountId: trading212SourceAccountId,
          instrumentId: "snapshot",
        });
      }
    }

    const carriedFailures = retrying && latest
      ? latest.failures.filter((failure) => !retryTargetKeys.has(failureKey(failure)))
      : [];
    const attemptedFailures = [...result.failed, ...trading212Failures].map((failure) => ({
      ...failure,
      ...(retrying ? { retryCount: 1 } : {}),
    }));

    const combinedResult: MarketRefreshResult & { automatic: boolean } = {
      ...result,
      automatic,
      updated: result.updated + trading212Updated,
      recordedPrices: result.recordedPrices + trading212Updated,
      skipped: Math.max(0, result.skipped - trading212Updated),
      failed: [...carriedFailures, ...attemptedFailures],
    };
    input.database.recordMarketData({
      observations,
      priceSourceStatuses,
      refresh: {
        mode,
        provider: `${input.fundNavProvider.id}${trading212Included ? "+trading212" : ""}`,
        completedAt: combinedResult.refreshedAt,
        updated: combinedResult.updated,
        unchanged: combinedResult.unchanged,
        failed: combinedResult.failed.length,
        failures: combinedResult.failed,
      },
    });
    return combinedResult;
  }

  return async function refresh(
    mode: MarketDataRefreshMode = "manual",
  ): Promise<MarketDataRefreshOutcome> {
    if (mode !== "automatic") return perform(mode);

    const previousAutomaticRefresh = automaticRefreshTail;
    let releaseAutomaticRefresh!: () => void;
    automaticRefreshTail = new Promise<void>((resolve) => {
      releaseAutomaticRefresh = resolve;
    });
    await previousAutomaticRefresh;
    try {
      return await perform(mode);
    } finally {
      releaseAutomaticRefresh();
    }
  };
}
