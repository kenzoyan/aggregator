import Decimal from "decimal.js";

import { eurPerUnitAt } from "@/application/fx-history";
import { formatOriginalMoney } from "@/application/money-format";
import { selectRangeBaseline } from "@/application/period-baseline";
import { marketDataTimelineTime } from "@/application/portfolio-calendar";
import { openingPositionUnitPrice } from "@/application/position-price";
import type {
  HoldingPriceHistoryReadModel,
  HoldingReadModel,
} from "@/application/portfolio-read-model";
import type {
  FxRateObservation,
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import { sourceAccountDashboardLabel } from "@/domain/source-accounts";
import {
  assetTypeLabels,
  type OpeningSnapshotInput,
  type PortfolioEventInput,
  type PortfolioState,
  type Position,
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
      candidate.asOf.slice(0, 10) <= priceAsOfLimit.slice(0, 10)
    )
    .sort((left, right) =>
      left.asOf.localeCompare(right.asOf) ||
      left.recordedAt.localeCompare(right.recordedAt)
    )
    .at(-1);
}

function marketPriceFreshness(priceAsOf: string, asOf: string) {
  const age = new Date(asOf).getTime() - new Date(priceAsOf).getTime();
  const fundNavFreshnessWindowMs = 4 * 24 * 60 * 60 * 1000;
  return age <= fundNavFreshnessWindowMs ? "fresh" as const : "stale" as const;
}

function holdingPriceHistory(
  position: Position,
  snapshots: readonly OpeningSnapshotInput[],
  observations: readonly MarketPriceObservation[],
  asOf: string,
): HoldingPriceHistoryReadModel[] {
  const byDate = new Map<string, HoldingPriceHistoryReadModel>();
  const currentPositionPrice = openingPositionUnitPrice(position);
  if (currentPositionPrice && position.priceAsOf) {
    byDate.set(position.priceAsOf.slice(0, 10), {
      price: currentPositionPrice.toString(),
      currency: position.currency,
      asOf: position.priceAsOf.slice(0, 10),
      source: position.priceSource ?? "confirmed-snapshot",
    });
  }
  for (const snapshot of [...snapshots].sort((left, right) =>
    left.asOf.localeCompare(right.asOf)
  )) {
    if (snapshot.sourceAccountId !== position.sourceAccountId) continue;
    const snapshotPosition = snapshot.positions.find((candidate) =>
      candidate.instrumentId === position.instrumentId
    );
    if (!snapshotPosition || snapshotPosition.currency !== position.currency) continue;
    const price = openingPositionUnitPrice(snapshotPosition);
    const priceAsOf = (snapshotPosition.priceAsOf ?? snapshot.asOf).slice(0, 10);
    if (!price || priceAsOf > asOf.slice(0, 10)) continue;
    byDate.set(priceAsOf, {
      price: price.toString(),
      currency: snapshotPosition.currency,
      asOf: priceAsOf,
      source: snapshotPosition.priceSource ?? "confirmed-snapshot",
    });
  }
  for (const observation of observations
    .filter((candidate) =>
      candidate.sourceAccountId === position.sourceAccountId &&
      candidate.instrumentId === position.instrumentId &&
      candidate.currency === position.currency &&
      candidate.asOf.slice(0, 10) <= asOf.slice(0, 10)
    )
    .sort((left, right) =>
      left.asOf.localeCompare(right.asOf) ||
      left.recordedAt.localeCompare(right.recordedAt)
    )) {
    byDate.set(observation.asOf.slice(0, 10), {
      price: observation.price,
      currency: observation.currency,
      asOf: observation.asOf.slice(0, 10),
      source: observation.source,
    });
  }
  return [...byDate.values()].sort((left, right) =>
    right.asOf.localeCompare(left.asOf)
  );
}

interface ResolvedPositionPrice {
  unitPrice: string;
  asOf: string;
  source: string;
  freshness: HoldingReadModel["freshness"];
  marketPrice?: MarketPriceObservation;
}

function resolvePositionPrice(input: {
  position: Position;
  marketPrices: readonly MarketPriceObservation[];
  asOf: string;
  snapshotTimes: Readonly<Record<string, string>>;
}): ResolvedPositionPrice | undefined {
  const quantity = new Decimal(input.position.quantity);
  if (quantity.isZero()) return undefined;
  const marketPrice = latestMarketPrice(
    input.position,
    input.marketPrices,
    input.asOf,
  );
  const unitPrice = marketPrice?.price ??
    openingPositionUnitPrice(input.position)?.toString();
  if (!unitPrice) return undefined;
  const asOf = marketPrice?.asOf ?? input.position.priceAsOf ??
    input.snapshotTimes[input.position.sourceAccountId] ?? input.asOf;
  return {
    unitPrice,
    asOf,
    source: marketPrice?.source ?? input.position.priceSource ??
      "confirmed-snapshot",
    freshness: marketPrice
      ? marketPrice.source === "manual"
        ? "manual"
        : marketPriceFreshness(marketPrice.asOf, input.asOf)
      : input.position.sourceAccountId.includes("trading212")
        ? "fresh"
        : "manual",
    ...(marketPrice ? { marketPrice } : {}),
  };
}

export function createDashboardReadModel(input: {
  state: PortfolioState;
  snapshots?: readonly OpeningSnapshotInput[];
  asOf: string;
  snapshotTimes: Readonly<Record<string, string>>;
  marketPrices?: readonly MarketPriceObservation[];
  latestMarketRefresh?: MarketRefreshRecord;
  eurPerUnit: Readonly<Record<string, string>>;
  fxAsOf: string;
  accountLabels?: Readonly<Record<string, string>>;
}) {
  const marketPrices = input.marketPrices ?? [];
  const snapshots = input.snapshots ?? [];
  const resolvedPriceByHolding = new Map(
    input.state.positions.flatMap((position) => {
      const resolved = resolvePositionPrice({
        position,
        marketPrices,
        asOf: input.asOf,
        snapshotTimes: input.snapshotTimes,
      });
      return resolved
        ? [[`${position.sourceAccountId}:${position.instrumentId}`, resolved] as const]
        : [];
    }),
  );
  const prices = input.state.positions.flatMap((position) => {
    const resolved = resolvedPriceByHolding.get(
      `${position.sourceAccountId}:${position.instrumentId}`,
    );
    return resolved
      ? [{
      sourceAccountId: position.sourceAccountId,
      instrumentId: position.instrumentId,
      price: resolved.unitPrice,
      ...(!resolved.marketPrice && position.reportedMarketValue
        ? { reportedMarketValue: position.reportedMarketValue }
        : {}),
      currency: position.currency,
      asOf: resolved.asOf,
      source: resolved.source,
      freshness: resolved.freshness,
    }]
      : [];
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

  const holdings: HoldingReadModel[] = [
    ...valuation.positions.map((position) => {
      const sourcePosition = input.state.positions.find((candidate) =>
        candidate.sourceAccountId === position.sourceAccountId &&
        candidate.instrumentId === position.instrumentId
      );
      const category: HoldingReadModel["category"] = sourcePosition?.assetType
        ? assetTypeLabels[sourcePosition.assetType]
        : "Unclassified";
      const resolvedPrice = resolvedPriceByHolding.get(
        `${position.sourceAccountId}:${position.instrumentId}`,
      );
      const currentValue = new Decimal(position.originalValue);
      const costBasis = sourcePosition
        ? new Decimal(sourcePosition.costBasis)
        : undefined;
      const eurPerUnit = input.eurPerUnit[position.currency] ??
        (position.currency === "EUR" ? "1" : undefined);
      const totalReturn = costBasis && eurPerUnit
        ? (() => {
            const originalAmount = currentValue.minus(costBasis);
            return {
              originalAmount: originalAmount.toNumber(),
              eurAmount: originalAmount.mul(eurPerUnit).toNumber(),
              ...(!costBasis.isZero()
                ? { percent: originalAmount.div(costBasis).mul(100).toNumber() }
                : {}),
            };
          })()
        : undefined;

      return {
        id: `${position.sourceAccountId}:${position.instrumentId}`,
        holdingKey: {
          sourceAccountId: position.sourceAccountId,
          instrumentId: position.instrumentId,
        },
        name: sourcePosition?.displayName ?? position.instrumentId,
        symbol: sourcePosition?.instrumentCode ?? position.instrumentId,
        source: sourceAccountDashboardLabel(position.sourceAccountId, input.accountLabels),
        category,
        currency: position.currency as HoldingReadModel["currency"],
        originalValue: formatOriginalMoney(
          Number(position.originalValue),
          position.currency,
        ),
        eurValue: Number(position.eurValue),
        ...(totalReturn
          ? { totalReturn }
          : {}),
        changeEur: 0,
        changePercent: 0,
        freshness: position.freshness,
        asOf: position.priceAsOf.slice(0, 16).replace("T", " "),
        ...(sourcePosition && resolvedPrice
          ? {
              detail: {
                quantity: sourcePosition.quantity,
                costBasis: sourcePosition.costBasis,
                reportedPriorReturn: sourcePosition.reportedPriorReturn,
                ...(sourcePosition.averageCost
                  ? { averageCost: sourcePosition.averageCost }
                  : {}),
                currentPrice: resolvedPrice.unitPrice,
                currentPriceAsOf: resolvedPrice.asOf.slice(0, 10),
                priceHistory: holdingPriceHistory(
                  sourcePosition,
                  snapshots,
                  marketPrices,
                  input.asOf,
                ),
              },
            }
          : {}),
      };
    }),
    ...valuation.cash
      .filter((cash) => !new Decimal(cash.originalValue).isZero())
      .map((cash) => ({
        id: `${cash.sourceAccountId}:cash:${cash.currency}`,
        name: "Portfolio Cash",
        symbol: "CASH",
        source: sourceAccountDashboardLabel(cash.sourceAccountId, input.accountLabels),
        category: "Portfolio cash" as const,
        currency: cash.currency as HoldingReadModel["currency"],
        originalValue: formatOriginalMoney(
          Number(cash.originalValue),
          cash.currency,
        ),
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
  coverage?: "partial";
  change: number;
  percent: number;
  points: number[];
  baselineAsOf?: string;
  currentAsOf?: string;
}

export function createPortfolioHistoryReadModel(input: {
  snapshots: readonly OpeningSnapshotInput[];
  events?: readonly PortfolioEventInput[];
  marketPrices?: readonly MarketPriceObservation[];
  fxObservations?: readonly FxRateObservation[];
  asOf: string;
  eurPerUnit: Readonly<Record<string, string>>;
  fxAsOf: string;
}): Record<"today" | "week" | "month", DashboardPeriodHistory> {
  const snapshots = [...input.snapshots].sort((left, right) =>
    left.asOf.localeCompare(right.asOf),
  );
  const events = input.events ?? [];
  const marketPrices = input.marketPrices ?? [];
  const publishedPriceDates = new Set(
    marketPrices.map((observation) => observation.asOf.slice(0, 10)),
  );
  const publishedObservationDates = new Set([
    ...publishedPriceDates,
    ...(input.fxObservations ?? []).map((observation) =>
      observation.asOf.slice(0, 10)
    ),
  ]);
  const publishedObservationTimeline = [...publishedObservationDates]
    .map((date) => marketDataTimelineTime(date, input.asOf))
    .sort();
  const timeline = [...new Set([
    ...snapshots.map((snapshot) => snapshot.asOf),
    ...marketPrices.map((observation) =>
      marketDataTimelineTime(observation.asOf, input.asOf)
    ),
    ...(input.fxObservations ?? []).map((observation) =>
      marketDataTimelineTime(observation.asOf, input.asOf)
    ),
    ...events.map((event) => event.asOf),
  ])].sort();
  const currentState = buildPortfolioState({
    openingSnapshots: snapshots,
    events: events.filter((event) => event.asOf <= input.asOf),
  });
  const currentQuantities = new Map(
    currentState.positions.map((position) => [
      `${position.sourceAccountId}:${position.instrumentId}`,
      new Decimal(position.quantity),
    ]),
  );
  const points = timeline.flatMap((asOf) => {
    const knownSnapshots = snapshots.filter((snapshot) => snapshot.asOf <= asOf);
    if (knownSnapshots.length === 0) return [];
    const snapshotTimes = Object.fromEntries(
      knownSnapshots.map((known) => [known.sourceAccountId, known.asOf]),
    );
    const state = buildPortfolioState({
      openingSnapshots: knownSnapshots,
      events: events.filter((event) => event.asOf <= asOf),
    });
    const readModel = createDashboardReadModel({
      state,
      snapshots: knownSnapshots,
      asOf,
      snapshotTimes,
      marketPrices,
      eurPerUnit: input.fxObservations?.length
        ? eurPerUnitAt(input.fxObservations, asOf)
        : input.eurPerUnit,
      fxAsOf: input.fxAsOf,
    });
    const holdingTotals = Object.fromEntries(
      readModel.holdings.map((holding) => {
        const historicalPosition = state.positions.find((position) =>
          `${position.sourceAccountId}:${position.instrumentId}` === holding.id
        );
        const currentQuantity = currentQuantities.get(holding.id);
        if (!historicalPosition || !currentQuantity) {
          return [holding.id, holding.eurValue];
        }
        const historicalQuantity = new Decimal(historicalPosition.quantity);
        const normalizedValue = historicalQuantity.isZero()
          ? new Decimal(0)
          : new Decimal(holding.eurValue)
              .div(historicalQuantity)
              .mul(currentQuantity);
        return [holding.id, normalizedValue.toNumber()];
      }),
    );
    const total = Object.values(holdingTotals)
      .reduce((sum, value) => sum + value, 0);
    return [{
      asOf,
      total,
      holdingTotals,
      complete: readModel.missingInputs.length === 0,
    }];
  });

  return Object.fromEntries(
    (["today", "week", "month"] as const).map((period) => {
      const current = points.at(-1);
      const previousPublishedObservationTime = publishedObservationTimeline.at(-2);
      let baseline = period === "today"
        ? previousPublishedObservationTime
          ? points.find((point) => point.asOf === previousPublishedObservationTime)
          : publishedObservationTimeline.length > 0
            ? points.at(0)
            : points.at(-2)
        : undefined;
      let coverage: "partial" | undefined;
      if (
        baseline &&
        period === "today" &&
        current &&
        new Date(current.asOf).getTime() - new Date(baseline.asOf).getTime() >
          4 * 24 * 60 * 60 * 1000
      ) {
        baseline = undefined;
      }
      if (period !== "today") {
        const result = selectRangeBaseline({
          period,
          points,
          asOf: input.asOf,
          monitoringStartedAt: snapshots[0]?.asOf,
        });
        baseline = result?.point;
        coverage = result?.coverage;
      }
      const available = Boolean(
        current &&
        baseline &&
        current.asOf !== baseline.asOf &&
        current.total !== 0 &&
        current.complete &&
        baseline.complete,
      );
      const currentHoldingIds = current
        ? Object.keys(current.holdingTotals)
        : [];
      const periodPoints = baseline
        ? points.filter((point) => point.asOf >= baseline.asOf)
        : [];
      const completePeriod = periodPoints.every((point) => point.complete);
      const holdingBaselines = Object.fromEntries(
        currentHoldingIds.flatMap((holdingId) => {
          const holdingBaseline = periodPoints.find((point) =>
            point.holdingTotals[holdingId] !== undefined
          )?.holdingTotals[holdingId];
          return holdingBaseline === undefined
            ? []
            : [[holdingId, holdingBaseline]];
        }),
      );
      const capitalBase = Object.values(holdingBaselines)
        .reduce((total, value) => total + value, 0);
      const change = available && completePeriod
        ? currentHoldingIds.reduce((total, holdingId) => {
            const holdingBaseline = holdingBaselines[holdingId];
            if (holdingBaseline === undefined) return total;
            return total + current!.holdingTotals[holdingId] - holdingBaseline;
          }, 0)
        : 0;
      const finalAvailable = available && completePeriod;
      const percent = finalAvailable && capitalBase !== 0
        ? (change / capitalBase) * 100
        : 0;
      const chartPoints = finalAvailable
        ? [...periodPoints.reduce((dailyPoints, point) => {
            const value = baseline!.total +
              currentHoldingIds.reduce((total, holdingId) => {
              const holdingBaseline = holdingBaselines[holdingId];
              const holdingValue = point.holdingTotals[holdingId];
              if (holdingBaseline === undefined || holdingValue === undefined) {
                return total;
              }
              return total + holdingValue - holdingBaseline;
              }, 0);
            dailyPoints.set(point.asOf.slice(0, 10), value);
            return dailyPoints;
          }, new Map<string, number>()).values()]
        : current
          ? [current.total]
          : [];
      return [period, {
        available: finalAvailable,
        ...(finalAvailable && coverage ? { coverage } : {}),
        change: finalAvailable ? change : 0,
        percent,
        points: chartPoints,
        ...(finalAvailable && baseline && current
          ? {
              baselineAsOf: baseline.asOf,
              currentAsOf: current.asOf,
            }
          : {}),
      }];
    }),
  ) as Record<"today" | "week" | "month", DashboardPeriodHistory>;
}
