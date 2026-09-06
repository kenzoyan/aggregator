import Decimal from "decimal.js";

import type {
  EditableDraftHolding,
  ImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import type {
  HoldingFieldChange,
  HoldingReconciliation,
  HoldingStateComparison,
  ImportReconciliation,
} from "@/domain/imports";
import { assetTypeSchema } from "@/domain/portfolio/schemas";

export type EditableHoldingField =
  | "displayName"
  | "instrumentCode"
  | "assetType"
  | "quantity"
  | "currency"
  | "costBasis"
  | "reportedPriorReturn"
  | "averageCost"
  | "observedPrice"
  | "priceAsOf"
  | "reportedMarketValue";

export type ImportDraftEdit =
  | { type: "add-holding"; holding: EditableDraftHolding }
  | { type: "remove-holding"; index: number }
  | {
      type: "update-holding";
      index: number;
      field: EditableHoldingField;
      value: string;
    }
  | { type: "update-cash"; field: "amount" | "currency"; value: string };

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

function updateHoldingField(
  holding: EditableDraftHolding,
  field: EditableHoldingField,
  value: string,
  preserveIdentity: boolean,
): EditableDraftHolding {
  if (field === "displayName") {
    return {
      ...holding,
      displayName: value,
      instrumentId: preserveIdentity
        ? holding.instrumentId
        : holding.instrumentCode || value,
    };
  }
  if (field === "instrumentCode") {
    return {
      ...holding,
      instrumentCode: value || undefined,
      instrumentId: preserveIdentity
        ? holding.instrumentId
        : value || holding.displayName || holding.instrumentId,
    };
  }
  if (field === "assetType") {
    const assetType = assetTypeSchema.safeParse(value);
    return {
      ...holding,
      assetType: assetType.success ? assetType.data : undefined,
    };
  }
  if (field === "priceAsOf") {
    return {
      ...holding,
      priceAsOf: value ? `${value}T00:00:00.000Z` : undefined,
    };
  }
  if (
    field === "observedPrice" ||
    field === "averageCost" ||
    field === "reportedMarketValue"
  ) {
    return { ...holding, [field]: value || undefined };
  }
  return { ...holding, [field]: value };
}

export function applyImportDraftEdit(
  draft: ImportDraftReadModel,
  edit: ImportDraftEdit,
): ImportDraftReadModel {
  if (draft.status !== "draft") return draft;

  if (edit.type === "add-holding") {
    const reconciliation = draft.reconciliation
      ? recount({
          ...draft.reconciliation,
          holdings: [
            ...draft.reconciliation.holdings,
            {
              key: edit.holding.lineId,
              proposedLineId: edit.holding.lineId,
              kind: "new",
              after: comparison(edit.holding),
              changes: [],
            },
          ],
        })
      : undefined;
    return {
      ...draft,
      ...(reconciliation ? { reconciliation } : {}),
      portfolio: {
        ...draft.portfolio,
        holdings: [...draft.portfolio.holdings, edit.holding],
      },
    };
  }

  if (edit.type === "remove-holding") {
    const removed = draft.portfolio.holdings[edit.index];
    if (!removed) return draft;
    const reconciliation = draft.reconciliation
      ? recount({
          ...draft.reconciliation,
          holdings: draft.reconciliation.holdings.flatMap((item) => {
            if (item.proposedLineId !== removed.lineId) return [item];
            if (!item.before) return [];
            return [{
              ...item,
              proposedLineId: undefined,
              kind: "possibly-removed" as const,
              after: undefined,
              changes: [],
            }];
          }),
        })
      : undefined;
    return {
      ...draft,
      ...(reconciliation ? { reconciliation } : {}),
      portfolio: {
        ...draft.portfolio,
        holdings: draft.portfolio.holdings.filter((_, index) => index !== edit.index),
      },
    };
  }

  if (edit.type === "update-cash") {
    if (!draft.portfolio.portfolioCash) return draft;
    const portfolioCash = {
      ...draft.portfolio.portfolioCash,
      [edit.field]: edit.field === "currency" ? edit.value.toUpperCase() : edit.value,
    };
    const reconciliation = draft.reconciliation
      ? recount({
          ...draft.reconciliation,
          cash: draft.reconciliation.cash?.before
            ? {
                before: draft.reconciliation.cash.before,
                after: portfolioCash,
                kind:
                  sameDecimal(draft.reconciliation.cash.before.amount, portfolioCash.amount) &&
                    draft.reconciliation.cash.before.currency.toUpperCase() ===
                      portfolioCash.currency.toUpperCase()
                    ? "unchanged"
                    : "holding-changed",
              }
            : { kind: "new", after: portfolioCash },
        })
      : undefined;
    return {
      ...draft,
      ...(reconciliation ? { reconciliation } : {}),
      portfolio: { ...draft.portfolio, portfolioCash },
    };
  }

  const existing = draft.portfolio.holdings[edit.index];
  if (!existing) return draft;
  const existingReconciliation = draft.reconciliation?.holdings.find(
    (item) => item.proposedLineId === existing.lineId,
  );
  const updated = updateHoldingField(
    existing,
    edit.field,
    edit.value,
    Boolean(existingReconciliation?.before),
  );
  const holdings = draft.portfolio.holdings.map((holding, index) =>
    index === edit.index ? updated : holding
  );
  const reconciliation = draft.reconciliation
    ? recount({
        ...draft.reconciliation,
        holdings: draft.reconciliation.holdings.map((item) =>
          item.proposedLineId === updated.lineId
            ? reconcileHolding(item, updated)
            : item
        ),
      })
    : undefined;
  return {
    ...draft,
    ...(reconciliation ? { reconciliation } : {}),
    portfolio: { ...draft.portfolio, holdings },
  };
}
