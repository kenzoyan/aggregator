import Decimal from "decimal.js";

import type { DashboardHolding } from "@/application/demo-dashboard";
import type {
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import { sourceAccountDashboardLabel } from "@/domain/source-accounts";
import type {
  OpeningSnapshotInput,
  PortfolioState,
  Position,
} from "@/domain/portfolio/types";
import { valuePortfolio, type FxObservation } from "@/domain/portfolio/valuation";

function latestMarketPrice(
  position: Position,
  observations: readonly MarketPriceObservation[],
  priceAsOfLimit: string,
): MarketPriceObservation | undefined {
  return observations
    .filter((candidate) =>
      candidate.sourceAccountId === position.sourceAccountId &&
      candidate.instrumentId === position.instrumentId &&
      candidate.currency === position.currency &&
      candidate.asOf <= priceAsOfLimit.slice(0, 10)
    )
    .sort((left, right) =>
      left.asOf.localeCompare(right.asOf) ||
      left.recordedAt.localeCompare(right.recordedAt)
    )
    .at(-1);
}

function priceTimelineTime(priceAsOf: string, currentAsOf: string): string {
  const endOfNavDate = `${priceAsOf}T23:59:59.999Z`;
  return endOfNavDate > currentAsOf ? currentAsOf : endOfNavDate;
}

function marketPriceFreshness(priceAsOf: string, asOf: string) {
  const age = new Date(asOf).getTime() - new Date(priceAsOf).getTime();
  const fundNavFreshnessWindowMs = 4 * 24 * 60 * 60 * 1000;
  return age <= fundNavFreshnessWindowMs ? "fresh" as const : "stale" as const;
}

export function createDashboardReadModel(input: {
  state: PortfolioState;
  asOf: string;
  snapshotTimes: Readonly<Record<string, string>>;
  marketPrices?: readonly MarketPriceObservation[];
  latestMarketRefresh?: MarketRefreshRecord;
  eurPerUnit: Readonly<Record<string, string>>;
  fxAsOf: string;
  accountLabels?: Readonly<Record<string, string>>;
}) {
  const marketPrices = input.marketPrices ?? [];
  const prices = input.state.positions.flatMap((position) => {
    const quantity = new Decimal(position.quantity);
    if (quantity.eq(0)) return [];
    const marketPrice = latestMarketPrice(position, marketPrices, input.asOf);
    return [{
      instrumentId: position.instrumentId,
      price: marketPrice?.price ?? position.observedPrice ?? new Decimal(position.costBasis)
          .plus(position.reportedPriorReturn)
          .div(quantity)
          .toString(),
      ...(!marketPrice && position.reportedMarketValue
        ? { reportedMarketValue: position.reportedMarketValue }
        : {}),
      currency: position.currency,
      asOf: marketPrice?.asOf ?? position.priceAsOf ??
        input.snapshotTimes[position.sourceAccountId] ?? input.asOf,
      source: marketPrice?.source ?? position.priceSource ?? "confirmed-snapshot",
      freshness: marketPrice
        ? marketPriceFreshness(marketPrice.asOf, input.asOf)
        : position.sourceAccountId.includes("trading212")
          ? "fresh" as const
          : "manual" as const,
    }];
  });
  const fxRates: FxObservation[] = Object.entries(input.eurPerUnit).map(
    ([currency, eurPerUnit]) => ({
      currency,
      eurPerUnit,
      asOf: input.fxAsOf,
      source: "ecb",
    }),
  );
  const valuation = valuePortfolio({
    state: input.state,
    asOf: input.asOf,
    prices,
    fxRates,
  });

  const holdings: DashboardHolding[] = [
    ...valuation.positions.map((position) => {
      const sourcePosition = input.state.positions.find((candidate) =>
        candidate.sourceAccountId === position.sourceAccountId &&
        candidate.instrumentId === position.instrumentId
      );
      const category: DashboardHolding["category"] =
        sourcePosition?.assetType === "fund" || sourcePosition?.assetType === "etf"
          ? "Fund"
          : sourcePosition?.assetType === "stock"
            ? "Stock"
            : sourcePosition?.assetType === "bond"
              ? "Bond"
              : "Unclassified";

      return {
        id: `${position.sourceAccountId}:${position.instrumentId}`,
        name: sourcePosition?.displayName ?? position.instrumentId,
        symbol: sourcePosition?.instrumentCode ?? position.instrumentId,
        source: sourceAccountDashboardLabel(position.sourceAccountId, input.accountLabels),
        category,
        currency: position.currency as DashboardHolding["currency"],
        originalValue: `${position.originalValue} ${position.currency}`,
        eurValue: Number(position.eurValue),
        changeEur: 0,
        changePercent: 0,
        freshness: position.freshness,
        asOf: position.priceAsOf.slice(0, 16).replace("T", " "),
      };
    }),
    ...valuation.cash.map((cash) => ({
      id: `${cash.sourceAccountId}:cash:${cash.currency}`,
      name: "Portfolio Cash",
      symbol: "CASH",
      source: sourceAccountDashboardLabel(cash.sourceAccountId, input.accountLabels),
      category: "Portfolio cash" as const,
      currency: cash.currency as DashboardHolding["currency"],
      originalValue: `${cash.originalValue} ${cash.currency}`,
      eurValue: Number(cash.eurValue),
      changeEur: 0,
      changePercent: 0,
      freshness: "fresh" as const,
      asOf: (input.snapshotTimes[cash.sourceAccountId] ?? input.asOf)
        .slice(0, 16)
        .replace("T", " "),
    })),
  ];

  return {
    holdings,
    totalValueEur: Number(valuation.totalValueEur),
    missingInputs: valuation.missingInputs,
    fxAsOf: input.fxAsOf,
    marketData: {
      lastRefreshedAt: input.latestMarketRefresh?.completedAt ?? marketPrices
        .filter((observation) => observation.recordedAt <= input.asOf)
        .map((observation) => observation.recordedAt)
        .sort()
        .at(-1),
      ...(input.latestMarketRefresh
        ? {
            latestResult: {
              updated: input.latestMarketRefresh.updated,
              unchanged: input.latestMarketRefresh.unchanged,
              failed: input.latestMarketRefresh.failed,
              failures: input.latestMarketRefresh.failures,
            },
          }
        : {}),
    },
  };
}

export interface DashboardPeriodHistory {
  available: boolean;
  change: number;
  percent: number;
  points: number[];
}

export function createPortfolioHistoryReadModel(input: {
  snapshots: readonly OpeningSnapshotInput[];
  marketPrices?: readonly MarketPriceObservation[];
  asOf: string;
  eurPerUnit: Readonly<Record<string, string>>;
  fxAsOf: string;
}): Record<"today" | "week" | "month", DashboardPeriodHistory> {
  const snapshots = [...input.snapshots].sort((left, right) =>
    left.asOf.localeCompare(right.asOf),
  );
  const marketPrices = input.marketPrices ?? [];
  const publishedPriceDates = new Set(
    marketPrices.map((observation) => observation.asOf.slice(0, 10)),
  );
  const publishedPriceTimeline = [...publishedPriceDates]
    .map((date) => priceTimelineTime(date, input.asOf))
    .sort();
  const timeline = [...new Set([
    ...snapshots.map((snapshot) => snapshot.asOf),
    ...marketPrices.map((observation) =>
      priceTimelineTime(observation.asOf, input.asOf)
    ),
  ])].sort();
  const points = timeline.flatMap((asOf) => {
    const knownSnapshots = snapshots.filter((snapshot) => snapshot.asOf <= asOf);
    if (knownSnapshots.length === 0) return [];
    const snapshotTimes = Object.fromEntries(
      knownSnapshots.map((known) => [known.sourceAccountId, known.asOf]),
    );
    const state = buildPortfolioState({
      openingSnapshots: knownSnapshots,
      events: [],
    });
    const readModel = createDashboardReadModel({
      state,
      asOf,
      snapshotTimes,
      marketPrices,
      eurPerUnit: input.eurPerUnit,
      fxAsOf: input.fxAsOf,
    });
    return [{ asOf, total: readModel.totalValueEur }];
  });

  const now = new Date(input.asOf);
  const todayCutoff = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const cutoffs = {
    today: todayCutoff,
    week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    month: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  };
  const maximumBaselineAge = {
    week: 3 * 24 * 60 * 60 * 1000,
    month: 7 * 24 * 60 * 60 * 1000,
  };

  return Object.fromEntries(
    Object.entries(cutoffs).map(([period, cutoff]) => {
      const current = points.at(-1);
      const previousPublishedPriceTime = publishedPriceTimeline.at(-2);
      let baseline = period === "today"
        ? previousPublishedPriceTime
          ? points.find((point) => point.asOf === previousPublishedPriceTime)
          : marketPrices.length > 0
            ? points.at(-2)
            : undefined
        : [...points]
            .reverse()
            .find((point) => new Date(point.asOf) <= cutoff);
      if (baseline && period !== "today") {
        const maximumAge = maximumBaselineAge[period as "week" | "month"];
        if (cutoff.getTime() - new Date(baseline.asOf).getTime() > maximumAge) {
          baseline = undefined;
        }
      }
      if (!baseline && period !== "today") {
        const next = points.find((point) => new Date(point.asOf) >= cutoff);
        if (
          next &&
          new Date(next.asOf).getTime() - cutoff.getTime() <=
            maximumBaselineAge[period as "week" | "month"]
        ) {
          baseline = next;
        }
      }
      const available = Boolean(
        current &&
        baseline &&
        current.asOf !== baseline.asOf &&
        baseline.total !== 0,
      );
      const change = available ? current!.total - baseline!.total : 0;
      const percent = available ? (change / baseline!.total) * 100 : 0;
      const chartPoints = available
        ? points
            .filter((point) => point.asOf >= baseline!.asOf)
            .map((point) => point.total)
        : current
          ? [current.total]
          : [];
      return [period, { available, change, percent, points: chartPoints }];
    }),
  ) as Record<"today" | "week" | "month", DashboardPeriodHistory>;
}
