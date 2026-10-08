import { describe, expect, it } from "vitest";

import { createImportConfirmHandler } from "@/app/api/imports/[id]/confirm/handler";
import { createCashActivityReadModel } from "@/application/portfolio-cash-activity";
import { createImportDraftReadModel, createImportDraftConfirmationPayload } from "@/application/imports/import-draft-read-model";
import { prepareSaleReview } from "@/application/portfolio-sale";
import { draftPortfolioFromOpeningSnapshot, type ImportDraftInput, type ImportReductionReview } from "@/domain/imports";
import { createPortfolioDatabase, type PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

function setup(sourceKind: "screenshot" | "trading-212", cash?: string, omitted = false) {
  const database = createPortfolioDatabase(":memory:");
  const opening: ImportDraftInput = {
    id: "opening", sourceAccountId: "account", sourceKind: "manual", confidence: "manual", warnings: [], createdAt: "2020-01-01T00:00:00.000Z",
    portfolio: draftPortfolioFromOpeningSnapshot({ id: "snapshot-opening", sourceAccountId: "account", asOf: "2020-01-01T00:00:00.000Z",
      portfolioCash: { amount: "50", currency: "EUR" }, positions: [{ instrumentId: "fund", quantity: "60", costBasis: "4800", observedPrice: "100", priceAsOf: "2020-01-02T00:00:00.000Z", currency: "EUR" }],
    }, "manual"),
  };
  database.saveImportDraft(opening);
  database.confirmImport({ draftId: opening.id, confirmedImportId: "confirmed-opening", confirmedAt: "2020-01-01T01:00:00.000Z", review: opening });
  const imported: ImportDraftInput = {
    ...opening, id: "updated", sourceKind, createdAt: "2020-01-02T12:00:00.000Z",
    portfolio: draftPortfolioFromOpeningSnapshot({ id: "snapshot-updated", sourceAccountId: "account", asOf: "2020-01-02T12:00:00.000Z",
      ...(cash !== undefined ? { portfolioCash: { amount: cash, currency: "EUR" } } : {}),
      positions: omitted ? [] : [{ instrumentId: "fund", quantity: "52", costBasis: "4160", observedPrice: "100", priceAsOf: "2020-01-02T00:00:00.000Z", currency: "EUR" }],
    }, "manual"),
  };
  database.saveImportDraft(imported);
  return database;
}
const resolution = (kind: "external-account" | "investment-account" = "external-account"): Extract<ImportReductionReview, { kind: "sale" }> => ({
  instrumentId: "fund", quantity: "8", kind: "sale", proceeds: "800", fees: "0", destination: kind === "external-account" ? { kind, name: "My bank" } : { kind },
});
async function confirm(database: PortfolioDatabase, reviews?: ImportReductionReview[]) {
  const draft = createImportDraftReadModel(database.getImportDraft("updated")!);
  draft.portfolio.reductionReviews = reviews;
  const handler = createImportConfirmHandler({ database, newId: () => "confirmed-updated", now: () => "2020-01-02T13:00:00.000Z" });
  return handler(new Request("http://localhost/confirm", { method: "POST", body: JSON.stringify(createImportDraftConfirmationPayload(draft)) }), draft.id);
}

describe("imported holding reductions", () => {
  it("requires the owner to supply sale details before changing holdings", async () => {
    const database = setup("screenshot");
    const response = await confirm(database);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Review the 8 unit reduction");
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("60");
    expect(database.readPortfolioFacts().events).toEqual([]);
    database.close();
  });
  it.each(["external-account", "investment-account"] as const)("records %s proceeds once when screenshot cash is omitted", async (kind) => {
    const database = setup("screenshot");
    expect((await confirm(database, [resolution(kind)])).status).toBe(200);
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("52");
    expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe(kind === "external-account" ? "50" : "850");
    expect(database.readPortfolioFacts().events).toHaveLength(1);
    expect((await confirm(database, [resolution(kind)])).status).toBe(200);
    expect(database.readPortfolioFacts().events).toHaveLength(1);
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("52");
    database.close();
  });
  it("uses broker cash without adding sale proceeds twice, and does not duplicate a repeated sync", async () => {
    const database = setup("trading-212", "850");
    expect((await confirm(database, [resolution("investment-account")])).status).toBe(200);
    expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("850");
    const old = database.getImportDraft("updated")!;
    database.saveImportDraft({ ...old, id: "resync", portfolio: { ...old.portfolio, snapshotId: "resync-snapshot" } });
    database.confirmImport({ draftId: "resync", confirmedImportId: "resync-confirmed", confirmedAt: "2020-01-02T14:00:00.000Z", review: database.getImportDraft("resync")! });
    expect(database.readPortfolioFacts().events).toHaveLength(1);
    expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("850");
    database.close();
  });
  it("allows an explained quantity correction and preserves it in the reviewed draft", async () => {
    const database = setup("screenshot");
    expect((await confirm(database, [{ instrumentId: "fund", quantity: "8", kind: "adjustment", reason: "Correct an earlier quantity entry." }])).status).toBe(200);
    expect(database.readPortfolioFacts().events).toEqual([]);
    expect(database.getImportDraft("updated")?.portfolio.reductionReviews?.[0]?.kind).toBe("adjustment");
    database.close();
  });
  it("does not interpret an omitted screenshot holding as a sale", async () => {
    const database = setup("screenshot", "50", true);
    expect((await confirm(database)).status).toBe(200);
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("60");
    expect(database.readPortfolioFacts().events).toEqual([]);
    database.close();
  });
  it("requires review of a complete broker removal", async () => {
    const database = setup("trading-212", "6050", true);
    expect((await confirm(database)).status).toBe(409);
    const sale = { ...resolution("investment-account"), quantity: "60", proceeds: "6000" };
    expect((await confirm(database, [sale])).status).toBe(200);
    expect(database.readPortfolioFacts().state.positions).toEqual([]);
    expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("6050");
    database.close();
  });
  it("does not apply a manually recorded sale again on same-day import and blocks unsafe undo", async () => {
    const database = setup("screenshot");
    const input = { sourceAccountId: "account", instrumentId: "fund", date: "2020-01-02", quantity: "8", proceeds: "800", fees: "0", destination: { kind: "external-account" as const, name: "My bank" } };
    const review = prepareSaleReview(database.readPortfolioFacts(), input);
    database.confirmSale(input, review.reviewToken, "manual-sale");
    expect((await confirm(database)).status).toBe(200);
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("52");
    expect(database.readPortfolioFacts().events).toHaveLength(1);
    expect(createCashActivityReadModel(database.readPortfolioFacts(), "account").records[0]?.undoBlockedReason).toContain("imported after");
    database.close();
  });
  it.each(["external-account", "investment-account"] as const)("undoes an imported %s sale while preserving its audit record", async (kind) => {
    const database = setup("screenshot");
    expect((await confirm(database, [resolution(kind)])).status).toBe(200);
    const activity = createCashActivityReadModel(database.readPortfolioFacts(), "account");
    expect(activity.records[0]?.undoBlockedReason).toBeNull();
    database.undoCashActivity(activity.records[0]!.id, activity.reviewToken);
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("60");
    expect(database.readPortfolioFacts().state.positions[0]?.costBasis).toBe("4800");
    expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("50");
    expect(database.readPortfolioFacts().events[0]?.voidedAt).toBeTruthy();
    database.close();
  });
  it("restores a fully removed broker holding on undo and preserves unrelated broker cash", async () => {
    const database = setup("trading-212", "6150", true);
    expect((await confirm(database, [{ ...resolution("investment-account"), quantity: "60", proceeds: "6000" }])).status).toBe(200);
    const activity = createCashActivityReadModel(database.readPortfolioFacts(), "account");
    database.undoCashActivity(activity.records[0]!.id, activity.reviewToken);
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("60");
    expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("150");
    database.close();
  });
  it("blocks imported sale undo after a later import", async () => {
    const database = setup("trading-212", "850");
    expect((await confirm(database, [resolution("investment-account")])).status).toBe(200);
    const old = database.getImportDraft("updated")!;
    database.saveImportDraft({ ...old, id: "later", portfolio: { ...old.portfolio, snapshotId: "later-snapshot" } });
    database.confirmImport({ draftId: "later", confirmedImportId: "later-confirmed", confirmedAt: "2020-01-03T00:00:00.000Z", review: database.getImportDraft("later")! });
    const activity = createCashActivityReadModel(database.readPortfolioFacts(), "account");
    expect(activity.records[0]?.undoBlockedReason).toContain("later import");
    expect(() => database.undoCashActivity(activity.records[0]!.id, activity.reviewToken)).toThrow("later import");
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("52");
    database.close();
  });

  it("keeps updated unit prices when undo restores an imported quantity", async () => {
    const database = setup("screenshot");
    const existing = database.getImportDraft("updated")!;
    existing.portfolio.holdings[0]!.observedPrice = { status: "known", value: "110", source: "manual" };
    database.saveImportDraftReview(existing.id, existing);
    expect((await confirm(database, [resolution()])).status).toBe(200);
    const activity = createCashActivityReadModel(database.readPortfolioFacts(), "account");
    database.undoCashActivity(activity.records[0]!.id, activity.reviewToken);
    expect(database.readPortfolioFacts().state.positions[0]).toMatchObject({ quantity: "60", costBasis: "4800", observedPrice: "110" });
    database.close();
  });

  it("refreshes a stale reduction review when another sale changes the current quantity", async () => {
    const database = setup("screenshot");
    const input = { sourceAccountId: "account", instrumentId: "fund", date: "2020-01-02", quantity: "4", proceeds: "400", fees: "0", destination: { kind: "external-account" as const, name: "My bank" } };
    const review = prepareSaleReview(database.readPortfolioFacts(), input);
    database.confirmSale(input, review.reviewToken, "manual-sale");
    const stale = await confirm(database, [resolution()]);
    expect(stale.status).toBe(409);
    expect((await stale.json()).reconciliation.holdings[0].before.quantity).toBe("56");
    expect((await confirm(database, [{ ...resolution(), quantity: "4", proceeds: "400" }])).status).toBe(200);
    expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("52");
    expect(database.readPortfolioFacts().events).toHaveLength(2);
    database.close();
  });

});
