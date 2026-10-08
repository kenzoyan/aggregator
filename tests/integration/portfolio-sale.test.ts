import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
    const directory = mkdtempSync(join(tmpdir(), "aggrigator-sale-"));
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
        soldCostBasis: "320", saleResult: "118",
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
    const directory = mkdtempSync(join(tmpdir(), "aggrigator-sale-"));
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
    const directory = mkdtempSync(join(tmpdir(), "aggrigator-sale-"));
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
});
