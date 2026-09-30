import Decimal from "decimal.js";

import { eurPerUnitAt } from "@/application/fx-history";
import {
  cashHoldingId,
  investmentHoldingId,
} from "@/application/portfolio-holding-id";
import { selectRangeBaseline } from "@/application/period-baseline";
import { marketDataTimelineTime } from "@/application/portfolio-calendar";
import { openingPositionUnitPrice } from "@/application/position-price";
import type {
  Period,
  PeriodPerformanceReadModel,
} from "@/application/portfolio-read-model";
import type {
  FxRateObservation,
  MarketPriceObservation,
} from "@/domain/market-data";
import type {
  CashBalance,
  OpeningSnapshotInput,
  PortfolioEventInput,
  PortfolioState,
  Position,
} from "@/domain/portfolio/types";

export type HoldingHistoryReadModel = Record<
  string,
  Record<Period, PeriodPerformanceReadModel>
>;

interface HoldingValuePoint {
  asOf: string;
  priceAsOf: string;
  valueEur: Decimal;
  unitPrice: Decimal;
  fxRate: Decimal;
  quantity: Decimal;
}

function holdingPoints(input: {
  position: Position;
  snapshots: readonly OpeningSnapshotInput[];
  marketPrices: readonly MarketPriceObservation[];
  fxObservations: readonly FxRateObservation[];
  asOf: string;
}): HoldingValuePoint[] {
  const pricePoints = new Map<string, Decimal>();
  for (const snapshot of input.snapshots) {
    if (snapshot.sourceAccountId !== input.position.sourceAccountId) continue;
    const snapshotPosition = snapshot.positions.find((candidate) =>
      candidate.instrumentId === input.position.instrumentId
    );
    if (!snapshotPosition) continue;
    const price = openingPositionUnitPrice(snapshotPosition);
    if (!price) continue;
    pricePoints.set(
      marketDataTimelineTime(
        snapshotPosition.priceAsOf ?? snapshot.asOf,
        input.asOf,
      ),
      price,
    );
  }
  for (const observation of input.marketPrices) {
    if (
      observation.sourceAccountId !== input.position.sourceAccountId ||
      observation.instrumentId !== input.position.instrumentId ||
      observation.currency !== input.position.currency
    ) continue;
    pricePoints.set(
      marketDataTimelineTime(observation.asOf, input.asOf),
      new Decimal(observation.price),
    );
  }

  const sortedPrices = [...pricePoints.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const firstPriceTime = sortedPrices.at(0)?.[0];
  const timeline = new Set(sortedPrices.map(([asOf]) => asOf));
  if (input.position.currency !== "EUR" && firstPriceTime) {
    for (const observation of input.fxObservations) {
      if (observation.currency !== input.position.currency) continue;
      const asOf = marketDataTimelineTime(observation.asOf, input.asOf);
      if (asOf >= firstPriceTime) timeline.add(asOf);
    }
  }

  const quantity = new Decimal(input.position.quantity);
  return [...timeline]
    .sort()
    .flatMap((asOf) => {
      const pricePoint = sortedPrices
        .filter(([priceAsOf]) => priceAsOf <= asOf)
        .at(-1);
      const price = pricePoint?.[1];
      const eurPerUnit = eurPerUnitAt(input.fxObservations, asOf)[
        input.position.currency
      ];
      const fxRate = eurPerUnit ? new Decimal(eurPerUnit) : undefined;
      return price && fxRate
          ? [{
            asOf,
            priceAsOf: pricePoint[0],
            valueEur: quantity.mul(price).mul(fxRate),
            unitPrice: price,
            fxRate,
            quantity,
          }]
        : [];
    });
}

function cashPoints(input: {
  cash: CashBalance;
  snapshots: readonly OpeningSnapshotInput[];
  events: readonly PortfolioEventInput[];
  fxObservations: readonly FxRateObservation[];
  asOf: string;
}): HoldingValuePoint[] {
  const cashDates = [
    ...input.snapshots.flatMap((snapshot) =>
      snapshot.sourceAccountId === input.cash.sourceAccountId &&
        snapshot.portfolioCash?.currency === input.cash.currency
        ? [marketDataTimelineTime(snapshot.asOf, input.asOf)]
        : []
    ),
    ...input.events.flatMap((event) =>
      event.sourceAccountId === input.cash.sourceAccountId &&
        event.proceeds.currency === input.cash.currency
        ? [marketDataTimelineTime(event.asOf, input.asOf)]
        : []
    ),
  ].sort();
  const firstCashTime = cashDates.at(0);
  if (!firstCashTime) return [];

  const timeline = new Set(cashDates);
  if (input.cash.currency !== "EUR") {
    for (const observation of input.fxObservations) {
      if (observation.currency !== input.cash.currency) continue;
      const asOf = marketDataTimelineTime(observation.asOf, input.asOf);
      if (asOf >= firstCashTime) timeline.add(asOf);
    }
  }

  const quantity = new Decimal(input.cash.amount);
  return [...timeline].sort().flatMap((asOf) => {
    const eurPerUnit = eurPerUnitAt(input.fxObservations, asOf)[input.cash.currency];
    if (!eurPerUnit) return [];
    const fxRate = new Decimal(eurPerUnit);
    return [{
      asOf,
      priceAsOf: asOf,
      valueEur: quantity.mul(fxRate),
      unitPrice: new Decimal(1),
      fxRate,
      quantity,
    }];
  });
}

function baselineForPeriod(
  period: Period,
  points: readonly HoldingValuePoint[],
  asOf: string,
  monitoringStartedAt?: string,
): { point: HoldingValuePoint; coverage?: "partial" } | undefined {
  if (period === "today") {
    const current = points.at(-1);
    const previousValuationPoint = points.at(-2);
    const previousPricePoint = current
      ? points
          .filter((point) =>
            point.asOf < current.asOf &&
            point.priceAsOf !== current.priceAsOf
          )
          .at(-1)
      : undefined;
    const baseline = previousPricePoint && previousValuationPoint
      ? {
          ...previousPricePoint,
          asOf: previousValuationPoint.asOf,
          fxRate: previousValuationPoint.fxRate,
          valueEur: previousPricePoint.quantity
            .mul(previousPricePoint.unitPrice)
            .mul(previousValuationPoint.fxRate),
        }
      : previousValuationPoint;
    if (!current || !baseline) return undefined;
    return new Date(current.asOf).getTime() - new Date(baseline.asOf).getTime() <=
        4 * 86_400_000
      ? { point: baseline }
      : undefined;
  }
  return selectRangeBaseline({
    period,
    points,
    asOf,
    monitoringStartedAt,
  });
}

function periodPerformance(
  period: Period,
  points: readonly HoldingValuePoint[],
  asOf: string,
  monitoringStartedAt?: string,
): PeriodPerformanceReadModel {
  const current = points.at(-1);
  const baselineResult = baselineForPeriod(
    period,
    points,
    asOf,
    monitoringStartedAt,
  );
  const baseline = baselineResult?.point;
  const available = Boolean(
    current && baseline && current.asOf !== baseline.asOf && !baseline.valueEur.isZero(),
  );
  if (!current || !baseline || !available) {
    return {
      available: false,
      change: 0,
      percent: 0,
      points: current ? [current.valueEur.toNumber()] : [],
      priceChange: 0,
      fxChange: 0,
    };
  }
  const change = current.valueEur.minus(baseline.valueEur);
  const priceChange = current.quantity
    .mul(current.unitPrice.minus(baseline.unitPrice))
    .mul(baseline.fxRate);
  const fxChange = current.quantity
    .mul(current.unitPrice)
    .mul(current.fxRate.minus(baseline.fxRate));
  const chartPoints = [
    baseline,
    ...points.filter((point) =>
      point.asOf > baseline.asOf && point.asOf <= current.asOf
    ),
  ];
  return {
    available: true,
    ...(baselineResult.coverage ? { coverage: baselineResult.coverage } : {}),
    change: change.toNumber(),
    percent: change.div(baseline.valueEur).mul(100).toNumber(),
    points: chartPoints.map((point) => point.valueEur.toNumber()),
    holdingPoints: chartPoints.map((point) => ({
      asOf: point.asOf.slice(0, 10),
      priceAsOf: point.priceAsOf.slice(0, 10),
      unitPrice: point.unitPrice.toString(),
      valueEur: point.valueEur.toNumber(),
    })),
    priceChange: priceChange.toNumber(),
    fxChange: fxChange.toNumber(),
    baselineAsOf: baseline.priceAsOf,
    currentAsOf: current.priceAsOf,
  };
}

export function createHoldingHistoryReadModel(input: {
  state: PortfolioState;
  snapshots: readonly OpeningSnapshotInput[];
  events?: readonly PortfolioEventInput[];
  marketPrices: readonly MarketPriceObservation[];
  fxObservations: readonly FxRateObservation[];
  asOf: string;
}): HoldingHistoryReadModel {
  const events = input.events ?? [];
  return Object.fromEntries(
    [
      ...input.state.positions.map((position) => ({
        id: investmentHoldingId(position),
        points: holdingPoints({ ...input, position }),
        monitoringStartedAt: input.snapshots
          .filter((snapshot) =>
            snapshot.sourceAccountId === position.sourceAccountId &&
            snapshot.positions.some((candidate) =>
              candidate.instrumentId === position.instrumentId
            )
          )
          .map((snapshot) => snapshot.asOf)
          .sort()
          .at(0),
      })),
      ...input.state.cashBalances.map((cash) => ({
        id: cashHoldingId(cash),
        points: cashPoints({ ...input, cash, events }),
        monitoringStartedAt: input.snapshots
          .filter((snapshot) =>
            snapshot.sourceAccountId === cash.sourceAccountId &&
            snapshot.portfolioCash?.currency === cash.currency
          )
          .map((snapshot) => snapshot.asOf)
          .sort()
          .at(0),
      })),
    ].map(({ id, points, monitoringStartedAt }) => {
      return [
        id,
        {
          today: periodPerformance(
            "today",
            points,
            input.asOf,
            monitoringStartedAt,
          ),
          week: periodPerformance(
            "week",
            points,
            input.asOf,
            monitoringStartedAt,
          ),
          month: periodPerformance(
            "month",
            points,
            input.asOf,
            monitoringStartedAt,
          ),
        },
      ];
    }),
  );
}
