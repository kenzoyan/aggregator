import { applyImportReconciliationEdit } from "@/application/imports/import-edit-reconciliation";
import {
  type EditableHoldingField,
  updateEditableHoldingField,
} from "@/application/imports/import-review-holding-editor";
import type {
  EditableDraftHolding,
  ImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";

export type { EditableHoldingField } from "@/application/imports/import-review-holding-editor";

import type { ImportReductionReview } from "@/domain/imports";

export type ImportDraftEdit =
  | { type: "review-reduction"; review: ImportReductionReview }
  | { type: "update-as-of"; value: string }
  | { type: "add-holding"; holding: EditableDraftHolding }
  | { type: "remove-holding"; index: number }
  | {
      type: "update-holding";
      index: number;
      field: EditableHoldingField;
      value: string;
    }
  | { type: "update-cash"; field: "amount" | "currency"; value: string };

export function applyImportDraftEdit(
  draft: ImportDraftReadModel,
  edit: ImportDraftEdit,
): ImportDraftReadModel {
  if (draft.status !== "draft") return draft;

  if (edit.type === "review-reduction") {
    return { ...draft, portfolio: { ...draft.portfolio, reductionReviews: [
      ...(draft.portfolio.reductionReviews ?? []).filter((review) => review.instrumentId !== edit.review.instrumentId), edit.review,
    ] } };
  }

  if (edit.type === "update-as-of") {
    return {
      ...draft,
      portfolio: {
        ...draft.portfolio,
        asOf: edit.value ? `${edit.value}T00:00:00.000Z` : "",
      },
    };
  }

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
  const updated = updateEditableHoldingField(
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
