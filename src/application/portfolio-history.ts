import Decimal from "decimal.js";

import { eurPerUnitAt } from "@/application/fx-history";
import { selectRangeBaseline } from "@/application/period-baseline";
import { marketDataTimelineTime } from "@/application/portfolio-calendar";
import { createCurrentPortfolioValuationReadModel } from "@/application/portfolio-current-valuation";
import {
  cashHoldingId,
  investmentHoldingId,
} from "@/application/portfolio-holding-id";
import type {
  PortfolioDailyChangeReadModel,
  PortfolioValueHistoryReadModel,
} from "@/application/portfolio-read-model";
import type {
  FxRateObservation,
  MarketPriceObservation,
} from "@/domain/market-data";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type {
  OpeningSnapshotInput,
  PortfolioEventInput,
} from "@/domain/portfolio/types";

export interface PortfolioPeriodHistory {
  available: boolean;
  coverage?: "partial";
  change: number;
  percent: number;
  points: number[];
  baselineAsOf?: string;
  currentAsOf?: string;
  dailyChanges: PortfolioDailyChangeReadModel[];
  valueHistory: PortfolioValueHistoryReadModel;
}

interface PortfolioHistoryInput {
  snapshots: readonly OpeningSnapshotInput[];
  events?: readonly PortfolioEventInput[];
  marketPrices?: readonly MarketPriceObservation[];
  fxObservations?: readonly FxRateObservation[];
  asOf: string;
  eurPerUnit: Readonly<Record<string, string>>;
  fxAsOf: string;
}

interface PortfolioHistoryPoint {
  asOf: string;
  normalizedTotal: number;
  actualTotal: number;
  holdingTotals: Record<string, number>;
  investmentQuantities: Record<string, string>;
  investmentNames: Record<string, string>;
  complete: boolean;
}

function normalizeHistoricalHoldingValue(input: {
  historicalQuantity?: string;
  currentQuantity?: Decimal;
  historicalValueEur: number;
}) {
  if (!input.historicalQuantity || !input.currentQuantity) {
    return input.historicalValueEur;
  }
  const historicalQuantity = new Decimal(input.historicalQuantity);
  return historicalQuantity.isZero()
    ? 0
    : new Decimal(input.historicalValueEur)
        .div(historicalQuantity)
        .mul(input.currentQuantity)
        .toNumber();
}

interface PortfolioHistoryPointSource {
  input: PortfolioHistoryInput;
  snapshots: readonly OpeningSnapshotInput[];
  events: readonly PortfolioEventInput[];
  marketPrices: readonly MarketPriceObservation[];
  currentQuantities: ReadonlyMap<string, Decimal>;
  currentCashAmounts: ReadonlyMap<string, Decimal>;
}

function createPortfolioHistoryPoint(
  source: PortfolioHistoryPointSource,
  asOf: string,
): PortfolioHistoryPoint | undefined {
  const knownSnapshots = source.snapshots.filter((snapshot) =>
    snapshot.asOf <= asOf
  );
  if (knownSnapshots.length === 0) return undefined;
  const snapshotTimes = Object.fromEntries(
    knownSnapshots.map((known) => [known.sourceAccountId, known.asOf]),
  );
  const state = buildPortfolioState({
    openingSnapshots: knownSnapshots,
    events: source.events.filter((event) => event.asOf <= asOf),
  });
  const readModel = createCurrentPortfolioValuationReadModel({
    state,
    snapshots: knownSnapshots,
    asOf,
    snapshotTimes,
    marketPrices: source.marketPrices,
    eurPerUnit: source.input.fxObservations?.length
      ? eurPerUnitAt(source.input.fxObservations, asOf)
      : source.input.eurPerUnit,
    fxAsOf: source.input.fxAsOf,
  });
  const holdingTotals = Object.fromEntries(
    readModel.holdings.map((holding) => {
      if (holding.category === "Portfolio cash") {
        const historicalCash = state.cashBalances.find((cash) =>
          cashHoldingId(cash) === holding.id
        );
        return [holding.id, normalizeHistoricalHoldingValue({
          historicalQuantity: historicalCash?.amount,
          currentQuantity: source.currentCashAmounts.get(holding.id),
          historicalValueEur: holding.eurValue,
        })];
      }
      const historicalPosition = state.positions.find((position) =>
        investmentHoldingId(position) === holding.id
      );
      return [holding.id, normalizeHistoricalHoldingValue({
        historicalQuantity: historicalPosition?.quantity,
        currentQuantity: source.currentQuantities.get(holding.id),
        historicalValueEur: holding.eurValue,
      })];
    }),
  ) as Record<string, number>;
  const investmentQuantities = Object.fromEntries(
    state.positions.map((position) => [
      investmentHoldingId(position),
      position.quantity,
    ]),
  ) as Record<string, string>;
  const investmentNames = Object.fromEntries(
    readModel.holdings.flatMap((holding) =>
      holding.category === "Portfolio cash"
        ? []
        : [[holding.id, holding.name]]
    ),
  ) as Record<string, string>;
  return {
    asOf,
    normalizedTotal: Object.values(holdingTotals)
      .reduce((sum, value) => sum + value, 0),
    actualTotal: readModel.totalValueEur,
    holdingTotals,
    investmentQuantities,
    investmentNames,
    complete: readModel.missingInputs.length === 0,
  };
}

function createPortfolioHistoryContext(input: PortfolioHistoryInput) {
  const snapshots = [...input.snapshots].sort((left, right) =>
    left.asOf.localeCompare(right.asOf)
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
      investmentHoldingId(position),
      new Decimal(position.quantity),
    ]),
  );
  const currentCashAmounts = new Map(
    currentState.cashBalances.map((cash) => [
      cashHoldingId(cash),
      new Decimal(cash.amount),
    ]),
  );
  const pointSource: PortfolioHistoryPointSource = {
    input,
    snapshots,
    events,
    marketPrices,
    currentQuantities,
    currentCashAmounts,
  };
  const points = timeline.flatMap((asOf) => {
    const point = createPortfolioHistoryPoint(pointSource, asOf);
    return point ? [point] : [];
  });

  return { snapshots, publishedObservationTimeline, points };
}

type PortfolioHistoryContext = ReturnType<typeof createPortfolioHistoryContext>;
type PortfolioHistoryPeriod = "today" | "week" | "month";

function selectPeriodHistoryBaseline(input: {
  period: PortfolioHistoryPeriod;
  points: readonly PortfolioHistoryPoint[];
  publishedObservationTimeline: readonly string[];
  monitoringStartedAt?: string;
  asOf: string;
}) {
  const current = input.points.at(-1);
  const previousPublishedObservationTime =
    input.publishedObservationTimeline.at(-2);
  let baseline = input.period === "today"
    ? previousPublishedObservationTime
      ? input.points.find((point) =>
          point.asOf === previousPublishedObservationTime
        )
      : input.publishedObservationTimeline.length > 0
        ? input.points.at(0)
        : input.points.at(-2)
    : undefined;
  let coverage: "partial" | undefined;
  if (
    baseline &&
    input.period === "today" &&
    current &&
    new Date(current.asOf).getTime() - new Date(baseline.asOf).getTime() >
      4 * 24 * 60 * 60 * 1000
  ) {
    baseline = undefined;
  }
  if (input.period !== "today") {
    const result = selectRangeBaseline({
      period: input.period,
      points: input.points,
      asOf: input.asOf,
      monitoringStartedAt: input.monitoringStartedAt,
    });
    baseline = result?.point;
    coverage = result?.coverage;
  }
  return { baseline, coverage };
}

function createInvestmentPerformance(input: {
  current?: PortfolioHistoryPoint;
  baseline?: PortfolioHistoryPoint;
  periodPoints: readonly PortfolioHistoryPoint[];
  completePeriod: boolean;
}) {
  const currentHoldingIds = input.current
    ? Object.keys(input.current.holdingTotals)
    : [];
  const available = Boolean(
    input.current &&
    input.baseline &&
    input.current.asOf !== input.baseline.asOf &&
    input.current.normalizedTotal !== 0 &&
    input.current.complete &&
    input.baseline.complete,
  );
  const holdingBaselines = Object.fromEntries(
    currentHoldingIds.flatMap((holdingId) => {
      const holdingBaseline = input.periodPoints.find((point) =>
        point.holdingTotals[holdingId] !== undefined
      )?.holdingTotals[holdingId];
      return holdingBaseline === undefined
        ? []
        : [[holdingId, holdingBaseline]];
    }),
  ) as Record<string, number>;
  const capitalBase = Object.values(holdingBaselines)
    .reduce((total, value) => total + value, 0);
  const change = available && input.completePeriod
    ? currentHoldingIds.reduce((total, holdingId) => {
        const holdingBaseline = holdingBaselines[holdingId];
        if (holdingBaseline === undefined) return total;
        return total + input.current!.holdingTotals[holdingId] - holdingBaseline;
      }, 0)
    : 0;
  const finalAvailable = available && input.completePeriod;
  const percent = finalAvailable && capitalBase !== 0
    ? change / capitalBase * 100
    : 0;
  const timeline = finalAvailable
    ? [...input.periodPoints.reduce((dailyPoints, point) => {
        const value = input.baseline!.normalizedTotal +
          currentHoldingIds.reduce((total, holdingId) => {
            const holdingBaseline = holdingBaselines[holdingId];
            const holdingValue = point.holdingTotals[holdingId];
            if (holdingBaseline === undefined || holdingValue === undefined) {
              return total;
            }
            return total + holdingValue - holdingBaseline;
          }, 0);
        dailyPoints.set(point.asOf.slice(0, 10), {
          asOf: point.asOf.slice(0, 10),
          value,
        });
        return dailyPoints;
      }, new Map<string, { asOf: string; value: number }>()).values()]
    : input.current
      ? [{
          asOf: input.current.asOf.slice(0, 10),
          value: input.current.normalizedTotal,
        }]
      : [];
  const dailyChanges = finalAvailable
    ? timeline.slice(1).map((point, index) => ({
        asOf: point.asOf,
        change: point.value - timeline[index]!.value,
      }))
    : [];
  return { finalAvailable, change, percent, timeline, dailyChanges };
}

function createPortfolioValueHistory(input: {
  dailyValuePoints: readonly PortfolioHistoryPoint[];
  performanceTimeline: readonly { asOf: string; value: number }[];
  completePeriod: boolean;
  investmentPerformanceAvailable: boolean;
  hasFullyExitedInvestment: boolean;
}): PortfolioValueHistoryReadModel {
  const valueBaseline = input.dailyValuePoints.at(0);
  const valueCurrent = input.dailyValuePoints.at(-1);
  const available = Boolean(
    valueBaseline &&
    valueCurrent &&
    valueBaseline.asOf !== valueCurrent.asOf &&
    input.completePeriod,
  );
  const change = available
    ? valueCurrent!.actualTotal - valueBaseline!.actualTotal
    : 0;
  const percent = available && valueBaseline!.actualTotal !== 0
    ? change / valueBaseline!.actualTotal * 100
    : 0;
  const performanceByDate = new Map(
    input.performanceTimeline.map((point) => [point.asOf, point.value]),
  );
  const timeline = input.dailyValuePoints.map((point, index) => {
    const asOf = point.asOf.slice(0, 10);
    const previous = input.dailyValuePoints[index - 1];
    const previousAsOf = previous?.asOf.slice(0, 10);
    const currentPerformance = performanceByDate.get(asOf);
    const previousPerformance = previousAsOf
      ? performanceByDate.get(previousAsOf)
      : undefined;
    const investmentChangeEur = previousAsOf &&
        currentPerformance !== undefined &&
        previousPerformance !== undefined
      ? currentPerformance - previousPerformance
      : 0;
    const actualChange = previous
      ? point.actualTotal - previous.actualTotal
      : 0;
    const holdingIds = new Set([
      ...Object.keys(previous?.investmentQuantities ?? {}),
      ...Object.keys(point.investmentQuantities),
    ]);
    const holdingActivities = previous
      ? [...holdingIds].flatMap((holdingId) => {
          const before = new Decimal(
            previous.investmentQuantities[holdingId] ?? 0,
          );
          const after = new Decimal(point.investmentQuantities[holdingId] ?? 0);
          const delta = after.minus(before);
          if (delta.isZero()) return [];
          const kind = before.isZero()
            ? "added" as const
            : after.isZero()
              ? "exited" as const
              : delta.isPositive()
                ? "increased" as const
                : "reduced" as const;
          return [{
            holdingId,
            name: point.investmentNames[holdingId] ??
              previous.investmentNames[holdingId] ?? holdingId,
            kind,
            quantityDelta: delta.toString(),
          }];
        })
      : [];
    return {
      asOf,
      valueEur: point.actualTotal,
      investmentChangeEur,
      portfolioActivityEur: input.investmentPerformanceAvailable &&
          !input.hasFullyExitedInvestment
        ? actualChange - investmentChangeEur
        : 0,
      holdingActivities,
    };
  });
  const activityAvailable = available &&
    input.investmentPerformanceAvailable &&
    !input.hasFullyExitedInvestment;
  const portfolioActivity = activityAvailable
    ? timeline.reduce(
        (total, point) => total + point.portfolioActivityEur,
        0,
      )
    : 0;
  const investmentChange = activityAvailable
    ? change - portfolioActivity
    : 0;
  return {
    available,
    change,
    percent,
    investmentChange,
    portfolioActivity,
    activityAvailable,
    timeline,
    ...(available
      ? {
          baselineAsOf: valueBaseline!.asOf,
          currentAsOf: valueCurrent!.asOf,
        }
      : {}),
  };
}

function createPeriodHistory(
  input: PortfolioHistoryInput,
  context: PortfolioHistoryContext,
  period: PortfolioHistoryPeriod,
): PortfolioPeriodHistory {
  const {
    snapshots,
    publishedObservationTimeline,
    points,
  } = context;
  const current = points.at(-1);
  const { baseline, coverage } = selectPeriodHistoryBaseline({
    period,
    points,
    publishedObservationTimeline,
    monitoringStartedAt: snapshots[0]?.asOf,
    asOf: input.asOf,
  });
  const periodPoints = baseline
    ? points.filter((point) => point.asOf >= baseline.asOf)
    : [];
  const completePeriod = periodPoints.every((point) => point.complete);
  const periodDailyValuePoints = [...periodPoints.reduce((dailyPoints, point) => {
    dailyPoints.set(point.asOf.slice(0, 10), point);
    return dailyPoints;
  }, new Map<string, (typeof points)[number]>()).values()];
  const dailyValuePoints = periodDailyValuePoints.length > 0
    ? periodDailyValuePoints
    : current
      ? [current]
      : [];
  const currentInvestmentIdSet = new Set(
    Object.keys(current?.investmentQuantities ?? {}),
  );
  const hasFullyExitedInvestment = periodPoints.some((point) =>
    Object.keys(point.investmentQuantities).some((holdingId) =>
      !currentInvestmentIdSet.has(holdingId)
    )
  );
  const investmentPerformance = createInvestmentPerformance({
    current,
    baseline,
    periodPoints,
    completePeriod,
  });
  const {
    finalAvailable,
    change,
    percent,
    timeline: performanceTimeline,
    dailyChanges,
  } = investmentPerformance;
  const chartPoints = performanceTimeline.map((point) => point.value);
  const valueHistory = createPortfolioValueHistory({
    dailyValuePoints,
    performanceTimeline,
    completePeriod,
    investmentPerformanceAvailable: finalAvailable,
    hasFullyExitedInvestment,
  });
  return {
    available: finalAvailable,
    ...(finalAvailable && coverage ? { coverage } : {}),
    change: finalAvailable ? change : 0,
    percent,
    points: chartPoints,
    dailyChanges,
    valueHistory,
    ...(finalAvailable && baseline && current
      ? {
          baselineAsOf: baseline.asOf,
          currentAsOf: current.asOf,
        }
      : {}),
  };
}

export function createPortfolioHistoryReadModel(
  input: PortfolioHistoryInput,
): Record<PortfolioHistoryPeriod, PortfolioPeriodHistory> {
  const context = createPortfolioHistoryContext(input);
  return Object.fromEntries(
    (["today", "week", "month"] as const).map((period) => [
      period,
      createPeriodHistory(input, context, period),
    ]),
  ) as Record<PortfolioHistoryPeriod, PortfolioPeriodHistory>;
}
