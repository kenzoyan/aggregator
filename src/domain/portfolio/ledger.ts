import Decimal from "decimal.js";

import type {
  CashBalance,
  OpeningSnapshotInput,
  PortfolioEventInput,
  PortfolioState,
  Position,
} from "./types";

interface BuildPortfolioStateInput {
  openingSnapshots: readonly OpeningSnapshotInput[];
  events: readonly PortfolioEventInput[];
}

export function selectLatestSnapshotsByAccount(
  openingSnapshots: readonly OpeningSnapshotInput[],
): Map<string, OpeningSnapshotInput> {
  const latestSnapshotsByAccount = new Map<string, OpeningSnapshotInput>();
  for (const snapshot of openingSnapshots) {
    const current = latestSnapshotsByAccount.get(snapshot.sourceAccountId);
    if (!current || snapshot.asOf >= current.asOf) {
      latestSnapshotsByAccount.set(snapshot.sourceAccountId, snapshot);
    }
  }
  return latestSnapshotsByAccount;
}

function normalizeDecimal(value: string): string {
  return new Decimal(value).toString();
}

export function buildPortfolioState({
  openingSnapshots,
  events,
}: BuildPortfolioStateInput): PortfolioState {
  const positions: Position[] = [];
  const cashBalances: CashBalance[] = [];
  const appliedEventIds: string[] = [];
  const appliedEventIdSet = new Set<string>();
  const latestSnapshotsByAccount = selectLatestSnapshotsByAccount(openingSnapshots);

  for (const snapshot of latestSnapshotsByAccount.values()) {
    for (const position of snapshot.positions) {
      positions.push({
        sourceAccountId: snapshot.sourceAccountId,
        instrumentId: position.instrumentId,
        ...(position.displayName ? { displayName: position.displayName } : {}),
        ...(position.instrumentCode ? { instrumentCode: position.instrumentCode } : {}),
        ...(position.assetType ? { assetType: position.assetType } : {}),
        quantity: normalizeDecimal(position.quantity),
        currency: position.currency,
        costBasis: normalizeDecimal(position.costBasis),
        reportedPriorReturn: normalizeDecimal(
          position.reportedPriorReturn ?? "0",
        ),
        ...(position.averageCost ? { averageCost: normalizeDecimal(position.averageCost) } : {}),
        ...(position.observedPrice ? { observedPrice: normalizeDecimal(position.observedPrice) } : {}),
        ...(position.priceAsOf ? { priceAsOf: position.priceAsOf } : {}),
        ...(position.priceSource ? { priceSource: position.priceSource } : {}),
        ...(position.reportedMarketValue
          ? { reportedMarketValue: normalizeDecimal(position.reportedMarketValue) }
          : {}),
      });
    }

    if (snapshot.portfolioCash) {
      cashBalances.push({
        sourceAccountId: snapshot.sourceAccountId,
        currency: snapshot.portfolioCash.currency,
        amount: normalizeDecimal(snapshot.portfolioCash.amount),
      });
    }
  }

  for (const event of events) {
    const baseline = latestSnapshotsByAccount.get(event.sourceAccountId);
    if (baseline && event.asOf <= baseline.asOf) {
      continue;
    }
    if (appliedEventIdSet.has(event.id)) {
      continue;
    }

    const position = positions.find(
      (candidate) =>
        candidate.sourceAccountId === event.sourceAccountId &&
        candidate.instrumentId === event.instrumentId,
    );

    if (!position) {
      throw new Error(
        `Cannot sell missing position ${event.sourceAccountId}/${event.instrumentId}`,
      );
    }

    const currentQuantity = new Decimal(position.quantity);
    const soldQuantity = new Decimal(event.quantity);
    const remainingQuantity = currentQuantity.minus(soldQuantity);

    if (soldQuantity.lte(0) || remainingQuantity.lt(0)) {
      throw new Error(`Invalid sale quantity for event ${event.id}`);
    }

    if (
      event.proceeds.currency !== position.currency ||
      (event.fees && event.fees.currency !== position.currency)
    ) {
      throw new Error(`Sale currency mismatch for event ${event.id}`);
    }

    position.costBasis = new Decimal(position.costBasis)
      .mul(remainingQuantity)
      .div(currentQuantity)
      .toString();
    position.quantity = remainingQuantity.toString();

    let cash = cashBalances.find(
      (candidate) =>
        candidate.sourceAccountId === event.sourceAccountId &&
        candidate.currency === event.proceeds.currency,
    );

    if (!cash) {
      cash = {
        sourceAccountId: event.sourceAccountId,
        currency: event.proceeds.currency,
        amount: "0",
      };
      cashBalances.push(cash);
    }

    cash.amount = new Decimal(cash.amount)
      .plus(event.proceeds.amount)
      .minus(event.fees?.amount ?? "0")
      .toString();
    appliedEventIdSet.add(event.id);
    appliedEventIds.push(event.id);
  }

  return {
    positions,
    cashBalances,
    appliedEventIds,
  };
}
