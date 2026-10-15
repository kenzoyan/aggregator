import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCashActivityReadModel } from "@/application/portfolio-cash-activity";
import { createSaleHandlers } from "@/app/api/portfolio/sales/handler";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { initializePortfolioSchema } from "@/infrastructure/sqlite/portfolio-schema";

const sale = {
  sourceAccountId: "account-1", instrumentId: "fund-1",
  date: "2020-01-02", quantity: "4", proceeds: "440", fees: "2",
};
const request = (method: string, body: unknown) => new Request("http://localhost/api/portfolio/sales", {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

function seedDatabase(filename: string) {
  const database = new DatabaseSync(filename);
  initializePortfolioSchema(database);
  database.prepare(`INSERT INTO import_drafts
    (id, source_account_id, source_kind, created_at, confidence, warnings_json, portfolio_json, status, confirmed_at)
    VALUES ('draft-1', 'account-1', 'manual', '2020-01-01T10:00:00.000Z', 'high', '[]', '{}', 'confirmed', '2020-01-01T10:00:00.000Z')`).run();
  database.prepare(`INSERT INTO confirmed_imports
    (id, draft_id, source_account_id, source_kind, confirmed_at)
    VALUES ('import-1', 'draft-1', 'account-1', 'manual', '2020-01-01T10:00:00.000Z')`).run();
  const snapshot = {
    id: "snapshot-1", sourceAccountId: "account-1", asOf: "2020-01-01T10:00:00.000Z",
    portfolioCash: { amount: "50", currency: "EUR" },
    positions: [{ instrumentId: "fund-1", quantity: "10", currency: "EUR", costBasis: "800" }],
  };
  database.prepare(`INSERT INTO opening_snapshots
    (id, source_account_id, as_of, payload_json, confirmed_import_id)
    VALUES (?, ?, ?, ?, 'import-1')`).run(
      snapshot.id, snapshot.sourceAccountId, snapshot.asOf, JSON.stringify(snapshot),
    );
  database.close();
}

describe("reviewed sale event", () => {
  it("previews without saving, then confirms once and survives database reopening", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-sale-"));
    const filename = join(directory, "portfolio.sqlite");
    try {
      seedDatabase(filename);
      const database = createPortfolioDatabase(filename);
      const handlers = createSaleHandlers(database, () => "sale-1");
      const previewResponse = await handlers.POST(request("POST", sale));
      expect(previewResponse.status).toBe(200);
      const preview = await previewResponse.json() as { preview: Record<string, string>; reviewToken: string };
      expect(preview.preview).toMatchObject({
        quantityBefore: "10", quantityAfter: "6",
        costBasisBefore: "800", costBasisAfter: "480",
        soldCostBasis: "320", saleResult: "118", netProceeds: "438",
        cashBefore: "50", cashAfter: "488",
      });
      expect(database.readPortfolioFacts().events).toEqual([]);

      const unconfirmed = await handlers.PUT(request("PUT", { sale, reviewToken: preview.reviewToken }));
      expect(unconfirmed.status).toBe(400);
      expect(database.readPortfolioFacts().events).toEqual([]);

      const confirmed = await handlers.PUT(request("PUT", {
        sale, reviewToken: preview.reviewToken, confirm: true,
      }));
      expect(confirmed.status).toBe(201);
      expect(database.readPortfolioFacts().state).toMatchObject({
        positions: [{ quantity: "6", costBasis: "480" }],
        cashBalances: [{ amount: "488" }],
      });
      const repeated = await handlers.PUT(request("PUT", {
        sale, reviewToken: preview.reviewToken, confirm: true,
      }));
      expect(repeated.status).toBe(409);
      expect(database.readPortfolioFacts().events).toHaveLength(1);
      database.close();

      const reopened = createPortfolioDatabase(filename);
      expect(reopened.readPortfolioFacts().events).toMatchObject([{ id: "sale-1", type: "sale" }]);
      expect(reopened.readPortfolioFacts().state.positions[0]?.quantity).toBe("6");
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an oversized sale and a stale review", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-sale-"));
    const filename = join(directory, "portfolio.sqlite");
    try {
      seedDatabase(filename);
      const database = createPortfolioDatabase(filename);
      const handlers = createSaleHandlers(database, () => "sale-1");
      expect((await handlers.POST(request("POST", { ...sale, quantity: "11" }))).status).toBe(409);
      const first = await handlers.POST(request("POST", sale));
      const reviewToken = (await first.json() as { reviewToken: string }).reviewToken;
      const changed = await handlers.POST(request("POST", { ...sale, quantity: "2" }));
      const changedToken = (await changed.json() as { reviewToken: string }).reviewToken;
      expect(changedToken).not.toBe(reviewToken);
      const badToken = await handlers.PUT(request("PUT", { sale, reviewToken: changedToken, confirm: true }));
      expect(badToken.status).toBe(409);
      expect(database.readPortfolioFacts().events).toEqual([]);
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allocates cost basis by units sold, not by sale proceeds", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-sale-"));
    const filename = join(directory, "portfolio.sqlite");
    try {
      seedDatabase(filename);
      const database = createPortfolioDatabase(filename);
      const preview = await createSaleHandlers(database).POST(request("POST", {
        ...sale, quantity: "9.99", proceeds: "800", fees: "0",
      }));
      expect(preview.status).toBe(200);
      const body = await preview.json() as { preview: Record<string, string> };
      expect(body.preview.quantityAfter).toBe("0.01");
      expect(body.preview.costBasisAfter).toBe("0.8");
      expect(body.preview.soldCostBasis).toBe("799.2");
      expect(body.preview.saleResult).toBe("0.8");
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("excludes external sale proceeds, preserves their destination and supports audited undo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-external-sale-"));
    try {
      const filename = join(directory, "portfolio.sqlite");
      seedDatabase(filename);
      const database = createPortfolioDatabase(filename);
      const handlers = createSaleHandlers(database, () => "external-sale");
      const input = { ...sale, destination: { kind: "external-account", name: "My bank" } };
      const preview = await (await handlers.POST(request("POST", input))).json();
      expect(preview.preview).toMatchObject({ cashBefore: "50", cashAfter: "50", externalOutflow: "438" });
      expect((await handlers.PUT(request("PUT", { sale: input, reviewToken: preview.reviewToken, confirm: true }))).status).toBe(201);
      expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("50");
      const persisted = createPortfolioDatabase(filename);
      const persistedActivity = createCashActivityReadModel(persisted.readPortfolioFacts(), "account-1");
      expect(persistedActivity.records[0]?.destination).toEqual(input.destination);
      expect(persisted.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("50");
      persisted.close();
      const activity = createCashActivityReadModel(database.readPortfolioFacts(), "account-1");
      expect(activity.destinations).toContain("My bank");
      expect(activity.records[0]?.undoBlockedReason).toBeNull();
      expect((await handlers.DELETE(request("DELETE", { id: "external-sale", reviewToken: activity.reviewToken, confirm: true }))).status).toBe(200);
      expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("10");
      expect(database.readPortfolioFacts().events[0]?.voidedAt).toBeTruthy();
      expect(database.readPortfolioFacts().events[0]?.destination).toEqual(input.destination);
      database.close();
      const reopened = createPortfolioDatabase(filename);
      expect(reopened.readPortfolioFacts().state.positions[0]?.quantity).toBe("10");
      reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("reviews withdrawals, rejects overdrafts and restores cash when undone", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-withdrawal-"));
    try {
      const filename = join(directory, "portfolio.sqlite");
      seedDatabase(filename);
      const database = createPortfolioDatabase(filename);
      const handlers = createSaleHandlers(database, () => "withdrawal-1");
      const withdrawal = { sourceAccountId: "account-1", date: "2020-01-02", currency: "EUR", amount: "20", destination: { kind: "external-account", name: "My bank" } };
      expect((await handlers.POST(request("POST", { type: "cash-withdrawal", ...withdrawal, amount: "51" }))).status).toBe(409);
      const preview = await (await handlers.POST(request("POST", { type: "cash-withdrawal", ...withdrawal }))).json();
      expect(preview.preview.cashAfter).toBe("30");
      expect((await handlers.PUT(request("PUT", { type: "cash-withdrawal", withdrawal, reviewToken: preview.reviewToken, confirm: true }))).status).toBe(201);
      expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("30");
      expect(database.readPortfolioFacts().state.positions[0]?.quantity).toBe("10");
      const activity = createCashActivityReadModel(database.readPortfolioFacts(), "account-1");
      expect((await handlers.DELETE(request("DELETE", { id: "withdrawal-1", reviewToken: activity.reviewToken, confirm: true }))).status).toBe(200);
      expect(database.readPortfolioFacts().state.cashBalances[0]?.amount).toBe("50");
      database.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("requires an external account name and blocks stale or dependent undo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-undo-"));
    try {
      const filename = join(directory, "portfolio.sqlite");
      seedDatabase(filename);
      const database = createPortfolioDatabase(filename);
      let count = 0;
      const handlers = createSaleHandlers(database, () => `sale-${++count}`);
      expect((await handlers.POST(request("POST", { ...sale, destination: { kind: "external-account", name: " " } }))).status).toBe(400);
      const first = await (await handlers.POST(request("POST", sale))).json();
      await handlers.PUT(request("PUT", { sale, reviewToken: first.reviewToken, confirm: true }));
      const stale = createCashActivityReadModel(database.readPortfolioFacts(), "account-1");
      const second = await (await handlers.POST(request("POST", sale))).json();
      await handlers.PUT(request("PUT", { sale, reviewToken: second.reviewToken, confirm: true }));
      expect((await handlers.DELETE(request("DELETE", { id: "sale-1", reviewToken: stale.reviewToken, confirm: true }))).status).toBe(409);
      const current = createCashActivityReadModel(database.readPortfolioFacts(), "account-1");
      expect(current.records.find((record) => record.id === "sale-1")?.undoBlockedReason).toContain("later activity");
      expect((await handlers.DELETE(request("DELETE", { id: "sale-1", reviewToken: current.reviewToken, confirm: true }))).status).toBe(409);
      database.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

});
