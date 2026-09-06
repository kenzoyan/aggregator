import { describe, expect, it } from "vitest";

import {
  applyImportDraftEdit,
  type ImportDraftEdit,
} from "@/application/imports/import-review-editor";
import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";

function editableDraft(): ImportDraftReadModel {
  return {
    id: "draft-review",
    sourceAccountId: "danske-main",
    sourceKind: "screenshot",
    createdAt: "2026-09-06T10:00:00.000Z",
    status: "draft",
    confidence: "high",
    warnings: [],
    reconciliation: {
      mode: "partial",
      snapshotKind: "holding-state",
      changeCount: 0,
      unchangedCount: 1,
      marketDataUpdatedCount: 0,
      cash: {
        kind: "unchanged",
        before: { amount: "75.25", currency: "EUR" },
        after: { amount: "75.25", currency: "EUR" },
      },
      holdings: [{
        key: "danske-main:fund-a",
        proposedLineId: "line-a",
        kind: "unchanged",
        before: {
          instrumentId: "fund-a",
          displayName: "Synthetic Fund",
          quantity: "2",
          costBasis: "100",
          currency: "EUR",
        },
        after: {
          instrumentId: "fund-a",
          displayName: "Synthetic Fund",
          quantity: "2",
          costBasis: "100",
          currency: "EUR",
        },
        changes: [],
      }],
    },
    portfolio: {
      snapshotId: "snapshot-review",
      asOf: "2026-09-06T09:00:00.000Z",
      portfolioCash: { amount: "75.25", currency: "EUR" },
      holdings: [{
        lineId: "line-a",
        instrumentId: "fund-a",
        displayName: "Synthetic Fund",
        quantity: "2",
        currency: "EUR",
        costBasis: "100",
        reportedPriorReturn: "5",
      }],
    },
  };
}

function edit(input: ImportDraftEdit) {
  return applyImportDraftEdit(editableDraft(), input);
}

describe("Import review editing", () => {
  it("reconciles Holding State edits with Decimal equality", () => {
    const equivalent = edit({
      type: "update-holding",
      index: 0,
      field: "quantity",
      value: "2.0",
    });
    expect(equivalent.reconciliation).toMatchObject({
      changeCount: 0,
      unchangedCount: 1,
      holdings: [{ kind: "unchanged", changes: [] }],
    });

    const changed = edit({
      type: "update-holding",
      index: 0,
      field: "quantity",
      value: "3",
    });
    expect(changed.reconciliation).toMatchObject({
      changeCount: 1,
      unchangedCount: 0,
      holdings: [{
        kind: "holding-changed",
        changes: [{ field: "quantity", before: "2", after: "3" }],
      }],
    });
  });

  it("does not classify display or Market Data edits as Holding State changes", () => {
    const renamed = edit({
      type: "update-holding",
      index: 0,
      field: "displayName",
      value: "Corrected synthetic name",
    });
    const priced = applyImportDraftEdit(renamed, {
      type: "update-holding",
      index: 0,
      field: "observedPrice",
      value: "55",
    });

    expect(priced.reconciliation).toMatchObject({
      changeCount: 0,
      holdings: [{ kind: "unchanged", changes: [] }],
    });
    expect(priced.portfolio.holdings[0]?.instrumentId).toBe("fund-a");
  });

  it("uses Decimal equality for Portfolio Cash and preserves removal intent", () => {
    const equivalentCash = edit({
      type: "update-cash",
      field: "amount",
      value: "75.250",
    });
    expect(equivalentCash.reconciliation?.cash?.kind).toBe("unchanged");

    const removed = applyImportDraftEdit(equivalentCash, {
      type: "remove-holding",
      index: 0,
    });
    expect(removed.portfolio.holdings).toEqual([]);
    expect(removed.reconciliation).toMatchObject({
      changeCount: 1,
      unchangedCount: 0,
      holdings: [{ kind: "possibly-removed", proposedLineId: undefined }],
    });
  });
});
