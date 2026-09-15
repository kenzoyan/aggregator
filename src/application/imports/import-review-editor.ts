import { applyImportReconciliationEdit } from "@/application/imports/import-edit-reconciliation";
import type {
  EditableDraftHolding,
  ImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
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
    const reconciliation = applyImportReconciliationEdit(draft.reconciliation, edit);
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
    const reconciliation = applyImportReconciliationEdit(draft.reconciliation, {
      type: "remove-holding",
      holding: removed,
    });
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
    const reconciliation = applyImportReconciliationEdit(draft.reconciliation, {
      type: "update-cash",
      portfolioCash,
    });
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
  const reconciliation = applyImportReconciliationEdit(draft.reconciliation, {
    type: "update-holding",
    holding: updated,
  });
  return {
    ...draft,
    ...(reconciliation ? { reconciliation } : {}),
    portfolio: { ...draft.portfolio, holdings },
  };
}
