import Decimal from "decimal.js";

import type { EditableDraftHolding } from "@/application/imports/import-draft-read-model";
import type {
  HoldingFieldChange,
  HoldingReconciliation,
  HoldingStateComparison,
  ImportReconciliation,
} from "@/domain/imports";

type ImportReconciliationEdit =
  | { type: "add-holding"; holding: EditableDraftHolding }
  | { type: "remove-holding"; holding: EditableDraftHolding }
  | { type: "update-holding"; holding: EditableDraftHolding }
  | {
      type: "update-cash";
      portfolioCash: { amount: string; currency: string };
    };

function sameDecimal(left: string, right: string): boolean {
  try {
    return new Decimal(left).equals(new Decimal(right));
  } catch {
    return left.trim() === right.trim();
  }
}

function comparison(holding: EditableDraftHolding): HoldingStateComparison {
  return {
    instrumentId: holding.instrumentId,
    ...(holding.displayName ? { displayName: holding.displayName } : {}),
    ...(holding.instrumentCode ? { instrumentCode: holding.instrumentCode } : {}),
    quantity: holding.quantity,
    costBasis: holding.costBasis,
    currency: holding.currency,
  };
}

function fieldChanges(
  before: HoldingStateComparison,
  after: HoldingStateComparison,
): HoldingFieldChange[] {
  const changes: HoldingFieldChange[] = [];
  if (!sameDecimal(before.quantity, after.quantity)) {
    changes.push({ field: "quantity", before: before.quantity, after: after.quantity });
  }
  if (!sameDecimal(before.costBasis, after.costBasis)) {
    changes.push({ field: "costBasis", before: before.costBasis, after: after.costBasis });
  }
  if (before.currency.toUpperCase() !== after.currency.toUpperCase()) {
    changes.push({ field: "currency", before: before.currency, after: after.currency });
  }
  return changes;
}

function reconcileHolding(
  existing: HoldingReconciliation,
  holding: EditableDraftHolding,
): HoldingReconciliation {
  const after = comparison(holding);
  if (!existing.before) {
    return { ...existing, proposedLineId: holding.lineId, kind: "new", after, changes: [] };
  }
  const changes = fieldChanges(existing.before, after);
  return {
    ...existing,
    proposedLineId: holding.lineId,
    after,
    changes,
    kind: changes.length > 0
      ? "holding-changed"
      : existing.kind === "market-data-updated"
        ? "market-data-updated"
        : "unchanged",
  };
}

function recount(reconciliation: ImportReconciliation): ImportReconciliation {
  const changed = new Set(["holding-changed", "new", "possibly-removed"]);
  return {
    ...reconciliation,
    changeCount: reconciliation.holdings.filter((item) => changed.has(item.kind)).length +
      (reconciliation.cash && reconciliation.cash.kind !== "unchanged" ? 1 : 0),
    unchangedCount: reconciliation.holdings.filter((item) => item.kind === "unchanged").length,
    marketDataUpdatedCount: reconciliation.holdings.filter(
      (item) => item.kind === "market-data-updated",
    ).length,
  };
}

export function applyImportReconciliationEdit(
  reconciliation: ImportReconciliation | undefined,
  edit: ImportReconciliationEdit,
): ImportReconciliation | undefined {
  if (!reconciliation) return undefined;

  if (edit.type === "add-holding") {
    return recount({
      ...reconciliation,
      holdings: [
        ...reconciliation.holdings,
        {
          key: edit.holding.lineId,
          proposedLineId: edit.holding.lineId,
          kind: "new",
          after: comparison(edit.holding),
          changes: [],
        },
      ],
    });
  }

  if (edit.type === "remove-holding") {
    return recount({
      ...reconciliation,
      holdings: reconciliation.holdings.flatMap((item) => {
        if (item.proposedLineId !== edit.holding.lineId) return [item];
        if (!item.before) return [];
        return [{
          ...item,
          proposedLineId: undefined,
          kind: "possibly-removed" as const,
          after: undefined,
          changes: [],
        }];
      }),
    });
  }

  if (edit.type === "update-cash") {
    return recount({
      ...reconciliation,
      cash: reconciliation.cash?.before
        ? {
            before: reconciliation.cash.before,
            after: edit.portfolioCash,
            kind:
              sameDecimal(reconciliation.cash.before.amount, edit.portfolioCash.amount) &&
                reconciliation.cash.before.currency.toUpperCase() ===
                  edit.portfolioCash.currency.toUpperCase()
                ? "unchanged"
                : "holding-changed",
          }
        : { kind: "new", after: edit.portfolioCash },
    });
  }

  return recount({
    ...reconciliation,
    holdings: reconciliation.holdings.map((item) =>
      item.proposedLineId === edit.holding.lineId
        ? reconcileHolding(item, edit.holding)
        : item
    ),
  });
}
