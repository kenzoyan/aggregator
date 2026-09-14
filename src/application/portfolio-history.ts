import Decimal from "decimal.js";

import { eurPerUnitAt } from "@/application/fx-history";
import { selectRangeBaseline } from "@/application/period-baseline";
import { marketDataTimelineTime } from "@/application/portfolio-calendar";
import { createDashboardReadModel } from "@/application/portfolio-dashboard";
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

export interface DashboardPeriodHistory {
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
      `${position.sourceAccountId}:${position.instrumentId}`,
      new Decimal(position.quantity),
    ]),
  );
  const currentCashAmounts = new Map(
    currentState.cashBalances.map((cash) => [
      `${cash.sourceAccountId}:cash:${cash.currency}`,
      new Decimal(cash.amount),
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
        if (holding.category === "Portfolio cash") {
          const historicalCash = state.cashBalances.find((cash) =>
            `${cash.sourceAccountId}:cash:${cash.currency}` === holding.id
          );
          const currentAmount = currentCashAmounts.get(holding.id);
          if (!historicalCash || !currentAmount) {
            return [holding.id, holding.eurValue];
          }
          const historicalAmount = new Decimal(historicalCash.amount);
          const normalizedValue = historicalAmount.isZero()
            ? new Decimal(0)
            : new Decimal(holding.eurValue)
                .div(historicalAmount)
                .mul(currentAmount);
          return [holding.id, normalizedValue.toNumber()];
        }
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
    const investmentQuantities = Object.fromEntries(
      state.positions.map((position) => [
        `${position.sourceAccountId}:${position.instrumentId}`,
        position.quantity,
      ]),
    );
    const investmentNames = Object.fromEntries(
      readModel.holdings.flatMap((holding) =>
        holding.category === "Portfolio cash"
          ? []
          : [[holding.id, holding.name]]
      ),
    );
    return [{
      asOf,
      total,
      actualTotal: readModel.totalValueEur,
      holdingTotals,
      investmentQuantities,
      investmentNames,
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
      const valueBaseline = dailyValuePoints.at(0);
      const valueCurrent = dailyValuePoints.at(-1);
      const valueHistoryAvailable = Boolean(
        valueBaseline &&
        valueCurrent &&
        valueBaseline.asOf !== valueCurrent.asOf &&
        completePeriod,
      );
      const valueChange = valueHistoryAvailable
        ? valueCurrent!.actualTotal - valueBaseline!.actualTotal
        : 0;
      const valuePercent = valueHistoryAvailable && valueBaseline!.actualTotal !== 0
        ? valueChange / valueBaseline!.actualTotal * 100
        : 0;
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
      const performanceTimeline = finalAvailable
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
            dailyPoints.set(point.asOf.slice(0, 10), {
              asOf: point.asOf.slice(0, 10),
              value,
            });
            return dailyPoints;
          }, new Map<string, { asOf: string; value: number }>()).values()]
        : current
          ? [{ asOf: current.asOf.slice(0, 10), value: current.total }]
          : [];
      const chartPoints = performanceTimeline.map((point) => point.value);
      const dailyChanges = finalAvailable
        ? performanceTimeline.slice(1).map((point, index) => ({
            asOf: point.asOf,
            change: point.value - performanceTimeline[index]!.value,
          }))
        : [];
      const performanceByDate = new Map(
        performanceTimeline.map((point) => [point.asOf, point.value]),
      );
      const valueTimeline = dailyValuePoints.map((point, index) => {
        const asOf = point.asOf.slice(0, 10);
        const previous = dailyValuePoints[index - 1];
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
              const after = new Decimal(
                point.investmentQuantities[holdingId] ?? 0,
              );
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
          portfolioActivityEur: finalAvailable && !hasFullyExitedInvestment
            ? actualChange - investmentChangeEur
            : 0,
          holdingActivities,
        };
      });
      const activityAvailable = valueHistoryAvailable &&
        finalAvailable &&
        !hasFullyExitedInvestment;
      const portfolioActivity = activityAvailable
        ? valueTimeline.reduce(
            (total, point) => total + point.portfolioActivityEur,
            0,
          )
        : 0;
      const investmentChange = activityAvailable
        ? valueChange - portfolioActivity
        : 0;
      return [period, {
        available: finalAvailable,
        ...(finalAvailable && coverage ? { coverage } : {}),
        change: finalAvailable ? change : 0,
        percent,
        points: chartPoints,
        dailyChanges,
        valueHistory: {
          available: valueHistoryAvailable,
          change: valueChange,
          percent: valuePercent,
          investmentChange,
          portfolioActivity,
          activityAvailable,
          timeline: valueTimeline,
          ...(valueHistoryAvailable
            ? {
                baselineAsOf: valueBaseline!.asOf,
                currentAsOf: valueCurrent!.asOf,
              }
            : {}),
        },
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
