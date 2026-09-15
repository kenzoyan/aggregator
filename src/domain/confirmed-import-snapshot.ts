import type {
  ImportDraftInput,
  ImportReconciliation,
} from "@/domain/import-draft";
import { importLifecyclePolicyFor } from "@/domain/import-lifecycle-policy";
import { materializeOpeningSnapshot } from "@/domain/import-snapshot";
import {
  identitiesOverlap,
  normalizedIdentityKeys,
} from "@/domain/portfolio/identity";
import type {
  OpeningPositionInput,
  OpeningSnapshotInput,
  PortfolioState,
} from "@/domain/portfolio/types";

export type SnapshotPayloadScope = "complete" | "legacy-partial";

export interface SnapshotHistoryRecord {
  snapshot: OpeningSnapshotInput;
  payloadScope: SnapshotPayloadScope;
}

function positionIdentityKeys(position: OpeningPositionInput): string[] {
  return normalizedIdentityKeys([position.instrumentId, position.instrumentCode]);
}

function samePosition(
  left: OpeningPositionInput,
  right: OpeningPositionInput,
): boolean {
  return identitiesOverlap(positionIdentityKeys(left), positionIdentityKeys(right));
}

function openingPositionFromState(
  position: PortfolioState["positions"][number],
): OpeningPositionInput {
  return {
    instrumentId: position.instrumentId,
    ...(position.displayName ? { displayName: position.displayName } : {}),
    ...(position.instrumentCode ? { instrumentCode: position.instrumentCode } : {}),
    ...(position.assetType ? { assetType: position.assetType } : {}),
    quantity: position.quantity,
    currency: position.currency,
    costBasis: position.costBasis,
    reportedPriorReturn: position.reportedPriorReturn,
    ...(position.averageCost ? { averageCost: position.averageCost } : {}),
    ...(position.observedPrice ? { observedPrice: position.observedPrice } : {}),
    ...(position.priceAsOf ? { priceAsOf: position.priceAsOf } : {}),
    ...(position.priceSource ? { priceSource: position.priceSource } : {}),
    ...(position.reportedMarketValue
      ? { reportedMarketValue: position.reportedMarketValue }
      : {}),
  };
}

export function materializeConfirmedImportSnapshot(input: {
  draft: ImportDraftInput;
  currentState: PortfolioState;
  snapshotKind: ImportReconciliation["snapshotKind"];
}): OpeningSnapshotInput {
  const snapshot = materializeOpeningSnapshot(
    input.draft.sourceAccountId,
    input.draft.portfolio,
    input.snapshotKind,
  );
  if (!importLifecyclePolicyFor(input.draft.sourceKind).preserveOmittedOnConfirmation) {
    return snapshot;
  }

  const currentPositions = input.currentState.positions
    .filter((position) =>
      position.sourceAccountId === input.draft.sourceAccountId
    )
    .map(openingPositionFromState);
  const omittedPositions = currentPositions.filter((position) =>
    !snapshot.positions.some((updated) => samePosition(position, updated))
  );
  const currentCash = input.currentState.cashBalances.find((cash) =>
    cash.sourceAccountId === input.draft.sourceAccountId
  );

  return {
    ...snapshot,
    ...(!snapshot.portfolioCash && currentCash
      ? {
          portfolioCash: {
            amount: currentCash.amount,
            currency: currentCash.currency,
          },
        }
      : {}),
    positions: [...snapshot.positions, ...omittedPositions],
  };
}

export function normalizeSnapshotHistory(
  records: readonly SnapshotHistoryRecord[],
): OpeningSnapshotInput[] {
  const latestByAccount = new Map<string, OpeningSnapshotInput>();
  const accountsWithSnapshot = new Set<string>();
  return records.map((record) => {
    const previous = latestByAccount.get(record.snapshot.sourceAccountId);
    const isLegacyPartialUpdate = previous && record.payloadScope === "legacy-partial";
    const restoredSnapshot = isLegacyPartialUpdate
      ? {
          ...record.snapshot,
          ...(!record.snapshot.portfolioCash && previous.portfolioCash
            ? { portfolioCash: previous.portfolioCash }
            : {}),
          positions: [
            ...record.snapshot.positions,
            ...previous.positions.filter((previousPosition) =>
              !record.snapshot.positions.some((currentPosition) =>
                samePosition(previousPosition, currentPosition)
              )
            ),
          ],
        }
      : record.snapshot;
    const snapshot = {
      ...restoredSnapshot,
      kind: restoredSnapshot.kind ??
        (accountsWithSnapshot.has(restoredSnapshot.sourceAccountId)
          ? "holding-state" as const
          : "opening" as const),
    };
    accountsWithSnapshot.add(snapshot.sourceAccountId);
    latestByAccount.set(snapshot.sourceAccountId, snapshot);
    return snapshot;
  });
}
