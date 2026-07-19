import Decimal from "decimal.js";

import type { DashboardHolding } from "@/application/demo-dashboard";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import { sourceAccountDashboardLabel } from "@/domain/source-accounts";
import type { OpeningSnapshotInput, PortfolioState } from "@/domain/portfolio/types";
import { valuePortfolio, type FxObservation } from "@/domain/portfolio/valuation";

export function createDashboardReadModel(input: {
  state: PortfolioState;
  asOf: string;
  snapshotTimes: Readonly<Record<string, string>>;
  eurPerUnit: Readonly<Record<string, string>>;
  fxAsOf: string;
}) {
  const prices = input.state.positions.flatMap((position) => {
    const quantity = new Decimal(position.quantity);
    if (quantity.eq(0)) return [];
    return [{
      instrumentId: position.instrumentId,
      price: new Decimal(position.costBasis)
        .plus(position.reportedPriorReturn)
        .div(quantity)
        .toString(),
      currency: position.currency,
      asOf: input.snapshotTimes[position.sourceAccountId] ?? input.asOf,
      source: "confirmed-snapshot",
      freshness: position.sourceAccountId.includes("trading212")
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
    ...valuation.positions.map((position) => ({
      id: `${position.sourceAccountId}:${position.instrumentId}`,
      name: position.instrumentId,
      symbol: position.instrumentId,
      source: sourceAccountDashboardLabel(position.sourceAccountId),
      category: "Unclassified" as const,
      currency: position.currency as DashboardHolding["currency"],
      originalValue: `${position.originalValue} ${position.currency}`,
      eurValue: Number(position.eurValue),
      changeEur: 0,
      changePercent: 0,
      freshness: position.freshness,
      asOf: position.priceAsOf.slice(0, 16).replace("T", " "),
    })),
    ...valuation.cash.map((cash) => ({
      id: `${cash.sourceAccountId}:cash:${cash.currency}`,
      name: "Portfolio Cash",
      symbol: "CASH",
      source: sourceAccountDashboardLabel(cash.sourceAccountId),
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
  asOf: string;
  eurPerUnit: Readonly<Record<string, string>>;
  fxAsOf: string;
}): Record<"today" | "week" | "month", DashboardPeriodHistory> {
  const snapshots = [...input.snapshots].sort((left, right) =>
    left.asOf.localeCompare(right.asOf),
  );
  const points = snapshots.map((snapshot, index) => {
    const knownSnapshots = snapshots.slice(0, index + 1);
    const snapshotTimes = Object.fromEntries(
      knownSnapshots.map((known) => [known.sourceAccountId, known.asOf]),
    );
    const state = buildPortfolioState({
      openingSnapshots: knownSnapshots,
      events: [],
    });
    const readModel = createDashboardReadModel({
      state,
      asOf: snapshot.asOf,
      snapshotTimes,
      eurPerUnit: input.eurPerUnit,
      fxAsOf: input.fxAsOf,
    });
    return { asOf: snapshot.asOf, total: readModel.totalValueEur };
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
    today: 2 * 24 * 60 * 60 * 1000,
    week: 3 * 24 * 60 * 60 * 1000,
    month: 7 * 24 * 60 * 60 * 1000,
  };

  return Object.fromEntries(
    Object.entries(cutoffs).map(([period, cutoff]) => {
      const current = points.at(-1);
      let baseline = [...points]
        .reverse()
        .find((point) => new Date(point.asOf) <= cutoff);
      if (
        baseline &&
        cutoff.getTime() - new Date(baseline.asOf).getTime() >
          maximumBaselineAge[period as keyof typeof maximumBaselineAge]
      ) {
        baseline = undefined;
      }
      if (!baseline && period !== "today") {
        baseline = points.find((point) => new Date(point.asOf) >= cutoff);
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
