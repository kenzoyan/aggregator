import {
  hasFundNavRefreshTarget,
  refreshFundNavs,
  safeMarketRefreshFailure,
  type MarketRefreshResult,
} from "@/application/market-refresh";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { marketObservationsFromTrading212Snapshot } from "@/application/trading212-market-data";
import type {
  FundNavProvider,
  MarketPriceObservation,
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
  }): void;
}

export interface MarketDataRefreshDependencies {
  database: MarketRefreshDatabase;
  fundNavProvider: FundNavProvider;
  refreshTrading212Snapshot?: () => Promise<OpeningSnapshotInput | undefined>;
  now?: () => string;
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
    if (
      automatic &&
      marketData.latestMarketRefresh &&
      portfolioCalendarDate(marketData.latestMarketRefresh.completedAt) ===
        portfolioCalendarDate(now)
    ) {
      return {
        automatic: true,
        skipped: true,
        reason: "already-refreshed-today",
        lastRefreshedAt: marketData.latestMarketRefresh.completedAt,
      };
    }

    const facts = input.database.readPortfolioFacts();
    const sourceAccounts = input.database.readSourceAccounts?.() ?? [];
    const hasRefreshablePosition = facts.state.positions.some((position) =>
      hasFundNavRefreshTarget(position, input.fundNavProvider, sourceAccounts) ||
      (Boolean(input.refreshTrading212Snapshot) &&
        position.sourceAccountId === trading212SourceAccountId)
    );
    if (automatic && !hasRefreshablePosition) {
      return {
        automatic: true,
        skipped: true,
        reason: "no-refreshable-positions",
      };
    }

    const observations: MarketPriceObservation[] = [];
    const result = await refreshFundNavs({
      state: facts.state,
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
      now,
    });

    let trading212Updated = 0;
    let trading212Included = false;
    const trading212Failures = [];
    if (input.refreshTrading212Snapshot) {
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
        });
      }
    }

    const combinedResult: MarketRefreshResult & { automatic: boolean } = {
      ...result,
      automatic,
      updated: result.updated + trading212Updated,
      recordedPrices: result.recordedPrices + trading212Updated,
      skipped: Math.max(0, result.skipped - trading212Updated),
      failed: [...result.failed, ...trading212Failures],
    };
    input.database.recordMarketData({
      observations,
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
