import Decimal from "decimal.js";

import {
  identitiesOverlap,
  normalizedIdentityKeys,
} from "./identity";
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

function firstReportedPriorReturn(
  snapshots: readonly OpeningSnapshotInput[],
  sourceAccountId: string,
  instrumentId: string,
  instrumentCode?: string,
): string {
  const currentKeys = normalizedIdentityKeys([instrumentId, instrumentCode]);
  const orderedSnapshots = snapshots
    .filter((snapshot) => snapshot.sourceAccountId === sourceAccountId)
    .toSorted((left, right) => left.asOf.localeCompare(right.asOf));
  for (const snapshot of orderedSnapshots) {
    const firstPosition = snapshot.positions.find((position) =>
      identitiesOverlap(
        currentKeys,
        normalizedIdentityKeys([
          position.instrumentId,
          position.instrumentCode,
        ]),
      )
    );
    if (firstPosition) return firstPosition.reportedPriorReturn ?? "0";
  }
  return "0";
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
          firstReportedPriorReturn(
            openingSnapshots,
            snapshot.sourceAccountId,
            position.instrumentId,
            position.instrumentCode,
          ),
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
    if (event.voidedAt) continue;
    const baseline = latestSnapshotsByAccount.get(event.sourceAccountId);
    if (baseline && event.asOf <= baseline.asOf) {
      continue;
    }
    if (appliedEventIdSet.has(event.id)) {
      continue;
    }

    if (event.type === "cash-withdrawal") {
      const cash = cashBalances.find((candidate) =>
        candidate.sourceAccountId === event.sourceAccountId && candidate.currency === event.amount.currency);
      const amount = new Decimal(event.amount.amount);
      if (!cash || amount.lte(0) || amount.gt(cash.amount)) {
        throw new Error(`Invalid cash withdrawal for event ${event.id}`);
      }
      cash.amount = new Decimal(cash.amount).minus(amount).toString();
      appliedEventIdSet.add(event.id);
      appliedEventIds.push(event.id);
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

    if (!position.observedPrice && (position.reportedMarketValue || position.reportedPriorReturn !== "0")) {
      position.observedPrice = new Decimal(position.reportedMarketValue ?? new Decimal(position.costBasis).plus(position.reportedPriorReturn))
        .div(currentQuantity).toString();
    }
    if (position.reportedMarketValue) {
      position.reportedMarketValue = new Decimal(position.reportedMarketValue).mul(remainingQuantity).div(currentQuantity).toString();
    }
    position.costBasis = new Decimal(position.costBasis)
      .mul(remainingQuantity)
      .div(currentQuantity)
      .toString();
    position.quantity = remainingQuantity.toString();

    if (event.destination?.kind !== "external-account") {
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
    }
    appliedEventIdSet.add(event.id);
    appliedEventIds.push(event.id);
  }

  return {
    positions,
    cashBalances,
    appliedEventIds,
  };
}
