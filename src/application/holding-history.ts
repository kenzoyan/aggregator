import Decimal from "decimal.js";

import { eurPerUnitAt } from "@/application/fx-history";
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
  OpeningPositionInput,
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
  valueEur: Decimal;
  unitPrice: Decimal;
  fxRate: Decimal;
  quantity: Decimal;
}

function timelineTime(asOf: string, currentAsOf: string): string {
  const endOfDay = `${asOf.slice(0, 10)}T23:59:59.999Z`;
  return endOfDay > currentAsOf ? currentAsOf : endOfDay;
}

function snapshotUnitPrice(position: OpeningPositionInput): Decimal | undefined {
  if (position.observedPrice) return new Decimal(position.observedPrice);
  const quantity = new Decimal(position.quantity);
  if (quantity.isZero()) return undefined;
  if (position.reportedMarketValue) {
    return new Decimal(position.reportedMarketValue).div(quantity);
  }
  return new Decimal(position.costBasis)
    .plus(position.reportedPriorReturn ?? "0")
    .div(quantity);
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
    const price = snapshotUnitPrice(snapshotPosition);
    if (!price) continue;
    pricePoints.set(
      timelineTime(snapshotPosition.priceAsOf ?? snapshot.asOf, input.asOf),
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
      timelineTime(observation.asOf, input.asOf),
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
      const asOf = timelineTime(observation.asOf, input.asOf);
      if (asOf >= firstPriceTime) timeline.add(asOf);
    }
  }

  const quantity = new Decimal(input.position.quantity);
  return [...timeline]
    .sort()
    .flatMap((asOf) => {
      const price = sortedPrices
        .filter(([priceAsOf]) => priceAsOf <= asOf)
        .at(-1)?.[1];
      const eurPerUnit = eurPerUnitAt(input.fxObservations, asOf)[
        input.position.currency
      ];
      const fxRate = eurPerUnit ? new Decimal(eurPerUnit) : undefined;
      return price && fxRate
        ? [{
            asOf,
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
        ? [timelineTime(snapshot.asOf, input.asOf)]
        : []
    ),
    ...input.events.flatMap((event) =>
      event.sourceAccountId === input.cash.sourceAccountId &&
        event.proceeds.currency === input.cash.currency
        ? [timelineTime(event.asOf, input.asOf)]
        : []
    ),
  ].sort();
  const firstCashTime = cashDates.at(0);
  if (!firstCashTime) return [];

  const timeline = new Set(cashDates);
  if (input.cash.currency !== "EUR") {
    for (const observation of input.fxObservations) {
      if (observation.currency !== input.cash.currency) continue;
      const asOf = timelineTime(observation.asOf, input.asOf);
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
): HoldingValuePoint | undefined {
  if (period === "today") {
    const current = points.at(-1);
    const baseline = points.at(-2);
    if (!current || !baseline) return undefined;
    return new Date(current.asOf).getTime() - new Date(baseline.asOf).getTime() <=
        4 * 86_400_000
      ? baseline
      : undefined;
  }
  const days = period === "week" ? 7 : 30;
  const toleranceDays = period === "week" ? 3 : 7;
  const cutoff = new Date(new Date(asOf).getTime() - days * 86_400_000);
  const tolerance = toleranceDays * 86_400_000;
  const prior = [...points]
    .reverse()
    .find((point) => new Date(point.asOf) <= cutoff);
  if (prior && cutoff.getTime() - new Date(prior.asOf).getTime() <= tolerance) {
    return prior;
  }
  const next = points.find((point) => new Date(point.asOf) >= cutoff);
  return next && new Date(next.asOf).getTime() - cutoff.getTime() <= tolerance
    ? next
    : undefined;
}

function periodPerformance(
  period: Period,
  points: readonly HoldingValuePoint[],
  asOf: string,
): PeriodPerformanceReadModel {
  const current = points.at(-1);
  const baseline = baselineForPeriod(period, points, asOf);
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
  return {
    available: true,
    change: change.toNumber(),
    percent: change.div(baseline.valueEur).mul(100).toNumber(),
    points: points
      .filter((point) => point.asOf >= baseline.asOf)
      .map((point) => point.valueEur.toNumber()),
    priceChange: priceChange.toNumber(),
    fxChange: fxChange.toNumber(),
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
        id: `${position.sourceAccountId}:${position.instrumentId}`,
        points: holdingPoints({ ...input, position }),
      })),
      ...input.state.cashBalances.map((cash) => ({
        id: `${cash.sourceAccountId}:cash:${cash.currency}`,
        points: cashPoints({ ...input, cash, events }),
      })),
    ].map(({ id, points }) => {
      return [
        id,
        {
          today: periodPerformance("today", points, input.asOf),
          week: periodPerformance("week", points, input.asOf),
          month: periodPerformance("month", points, input.asOf),
        },
      ];
    }),
  );
}
