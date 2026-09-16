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
  it("ignores edits for confirmed drafts and missing holding indexes", () => {
    const confirmed = { ...editableDraft(), status: "confirmed" as const };

    expect(applyImportDraftEdit(confirmed, {
      type: "update-cash",
      field: "amount",
      value: "100",
    })).toBe(confirmed);
    expect(edit({ type: "remove-holding", index: 99 })).toEqual(editableDraft());
    expect(edit({
      type: "update-holding",
      index: 99,
      field: "quantity",
      value: "3",
    })).toEqual(editableDraft());
  });

  it("adds and removes new holdings without leaving stale reconciliation entries", () => {
    const holding = {
      lineId: "line-b",
      instrumentId: "fund-b",
      displayName: "Second Synthetic Fund",
      quantity: "4",
      currency: "EUR",
      costBasis: "200",
      reportedPriorReturn: "10",
    };
    const added = edit({ type: "add-holding", holding });

    expect(added.portfolio.holdings).toHaveLength(2);
    expect(added.reconciliation).toMatchObject({
      changeCount: 1,
      unchangedCount: 1,
      holdings: [
        { proposedLineId: "line-a", kind: "unchanged" },
        { proposedLineId: "line-b", kind: "new", after: { instrumentId: "fund-b" } },
      ],
    });

    const removed = applyImportDraftEdit(added, { type: "remove-holding", index: 1 });
    expect(removed.portfolio.holdings).toHaveLength(1);
    expect(removed.reconciliation).toMatchObject({
      changeCount: 0,
      unchangedCount: 1,
      holdings: [{ proposedLineId: "line-a", kind: "unchanged" }],
    });
  });

  it("preserves matched holding identity while allowing new holding identity edits", () => {
    const renamedMatched = edit({
      type: "update-holding",
      index: 0,
      field: "instrumentCode",
      value: "UPDATED",
    });
    expect(renamedMatched.portfolio.holdings[0]).toMatchObject({
      instrumentId: "fund-a",
      instrumentCode: "UPDATED",
    });

    const newHoldingDraft = applyImportDraftEdit(editableDraft(), {
      type: "add-holding",
      holding: {
        lineId: "line-b",
        instrumentId: "temporary-id",
        displayName: "Second Synthetic Fund",
        quantity: "1",
        currency: "EUR",
        costBasis: "50",
        reportedPriorReturn: "0",
      },
    });
    const recoded = applyImportDraftEdit(newHoldingDraft, {
      type: "update-holding",
      index: 1,
      field: "instrumentCode",
      value: "FUND-B",
    });
    expect(recoded.portfolio.holdings[1]).toMatchObject({
      instrumentId: "FUND-B",
      instrumentCode: "FUND-B",
    });
  });

  it("normalizes editable optional and schema-backed holding fields", () => {
    const withPrice = edit({
      type: "update-holding",
      index: 0,
      field: "observedPrice",
      value: "12.5",
    });
    const withDate = applyImportDraftEdit(withPrice, {
      type: "update-holding",
      index: 0,
      field: "priceAsOf",
      value: "2026-09-15",
    });
    const invalidAssetType = applyImportDraftEdit(withDate, {
      type: "update-holding",
      index: 0,
      field: "assetType",
      value: "not-an-asset-type",
    });
    const cleared = applyImportDraftEdit(invalidAssetType, {
      type: "update-holding",
      index: 0,
      field: "observedPrice",
      value: "",
    });

    expect(withDate.portfolio.holdings[0]).toMatchObject({
      observedPrice: "12.5",
      priceAsOf: "2026-09-15T00:00:00.000Z",
    });
    expect(invalidAssetType.portfolio.holdings[0]?.assetType).toBeUndefined();
    expect(cleared.portfolio.holdings[0]?.observedPrice).toBeUndefined();
  });

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
