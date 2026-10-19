import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import { createAccountsHandlers } from "@/app/api/accounts/handler";
import { draftPortfolioFromOpeningSnapshot } from "@/domain/imports";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { prepareSaleReview } from "@/application/portfolio-sale";

const accountTables = [
  "opening_snapshots", "portfolio_events", "confirmed_imports", "import_drafts",
  "market_price_observations", "price_source_bindings", "source_sync_state", "source_account_labels",
] as const;

function seedAccount(database: ReturnType<typeof createPortfolioDatabase>, id: string) {
  database.createSourceAccount({ id, accountType: id, label: id });
  database.renameSourceAccount(id, `${id} renamed`);
  const draft = {
    id: `${id}-draft`, sourceAccountId: id, sourceKind: "manual" as const,
    createdAt: "2020-01-01T09:00:00.000Z", confidence: "high" as const, warnings: [],
    portfolio: draftPortfolioFromOpeningSnapshot({
      id: `${id}-snapshot`, sourceAccountId: id, asOf: "2020-01-01T09:00:00.000Z",
      portfolioCash: { amount: "50", currency: "EUR" },
      positions: [{ instrumentId: "shared-fund", quantity: "10", currency: "EUR", costBasis: "100", observedPrice: "10", priceAsOf: "2020-01-01" }],
    }, "manual"),
  };
  database.saveImportDraft(draft);
  database.confirmImport({ draftId: draft.id, confirmedImportId: `${id}-confirmed`,
    confirmedAt: "2020-01-01T09:01:00.000Z", review: draft });
  database.saveImportDraft({ ...draft, id: `${id}-unconfirmed` });
  const sale = { sourceAccountId: id, instrumentId: "shared-fund", date: "2020-01-02", quantity: "1", proceeds: "11", fees: "0", destination: { kind: "investment-account" as const } };
  const review = prepareSaleReview(database.readPortfolioFacts(), sale);
  database.confirmSale(sale, review.reviewToken, `${id}-sale`);
  database.recordMarketData({ observations: [{ sourceAccountId: id, instrumentId: "shared-fund", instrumentCode: "000001", price: "11", currency: "EUR", asOf: "2020-01-02", recordedAt: "2020-01-02T10:00:00.000Z", source: "manual" }],
    fxObservations: [{ currency: "USD", eurPerUnit: "0.9", asOf: "2020-01-02", recordedAt: "2020-01-02T10:00:00.000Z", source: "manual" }] });
  database.savePriceSourceBinding({ sourceAccountId: id, instrumentId: "shared-fund", instrumentName: "Synthetic Fund", instrumentCode: "000001", currency: "EUR", shareClass: "A", provider: "eastmoney", identityUrl: "https://fund.eastmoney.com/000001.html", confirmedAt: "2020-01-02T10:00:00.000Z" });
}

async function withDeletionFixture(run: (fixture: {
  database: ReturnType<typeof createPortfolioDatabase>;
  sql: DatabaseSync;
  handlers: ReturnType<typeof createAccountsHandlers>;
  filename: string;
}) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "aggregator-account-deletion-"));
  const filename = join(directory, "synthetic.sqlite");
  const database = createPortfolioDatabase(filename);
  const sql = new DatabaseSync(filename);
  try {
    for (const account of database.readSourceAccounts()) database.deleteSourceAccount(account.id);
    seedAccount(database, "synthetic-test");
    seedAccount(database, "synthetic-other");
    for (const id of ["synthetic-test", "synthetic-other"]) {
      sql.prepare("INSERT INTO source_sync_state (source_account_id, connector) VALUES (?, 'synthetic')").run(id);
      sql.prepare("UPDATE portfolio_events SET confirmed_import_id = ? WHERE source_account_id = ?").run(`${id}-confirmed`, id);
      const draft = database.getImportDraft(`${id}-unconfirmed`)!;
      database.saveImportDraft({ ...draft, id: `${id}-discarded` });
      sql.prepare("UPDATE import_drafts SET status = 'discarded' WHERE id = ?").run(`${id}-discarded`);
    }
    sql.exec(`
      INSERT INTO portfolio_narratives (id, provider, model, language, generated_at, portfolio_as_of, facts_fingerprint, content_json, provenance_json, disclaimer)
      VALUES ('synthetic-report', 'synthetic', 'synthetic', 'en', '2020-01-03', '2020-01-03', 'old-facts', '{}', '{}', 'Synthetic');
      INSERT INTO market_intelligence_briefs (id, generated_at, content_json)
      VALUES ('synthetic-brief', '2020-01-03', '{}');
      INSERT INTO portfolio_analyst_conversations (id, provider, language, include_holding_names, created_at, updated_at, turns_json)
      VALUES ('synthetic-chat', 'synthetic', 'en', 0, '2020-01-03', '2020-01-03', '[]');
    `);
    database.recordMarketData({ observations: [], refresh: {
      mode: "manual", provider: "synthetic", completedAt: "2020-01-03T10:00:00.000Z", updated: 0, unchanged: 0, failed: 2,
      failures: ["synthetic-test", "synthetic-other"].map((sourceAccountId) => ({ sourceAccountId, instrumentCode: "000001", category: "no-data", message: "Synthetic failure" })),
    } });
    const handlers = createAccountsHandlers({ database, now: () => "2020-01-03T12:00:00.000Z", isTrading212Configured: () => false, trading212Environment: () => "demo", logError: vi.fn() });
    await run({ database, sql, handlers, filename });
  } finally {
    sql.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function deleteRequest(body: unknown) {
  return new Request("http://localhost/api/accounts", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("account deletion with stored portfolio data", () => {
  it("deletes all account records after explicit name confirmation and preserves other accounts on reopening", async () => {
    await withDeletionFixture(async ({ database, sql, handlers, filename }) => {
      const otherFacts = database.readPortfolioFacts();
      const response = await handlers.DELETE(deleteRequest({
        id: "synthetic-test", deletePortfolioData: true, confirmationLabel: "synthetic-test renamed",
      }));
      expect(response.status).toBe(200);
      const page = await response.json();
      expect(page.accounts.map((a: { id: string }) => a.id)).toEqual(["synthetic-other"]);
      expect(page.holdings.every((h: { sourceAccountId: string }) => h.sourceAccountId === "synthetic-other")).toBe(true);
      for (const table of accountTables) {
        expect(sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE source_account_id = ?`).get("synthetic-test")?.n, table).toBe(0);
        expect(sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE source_account_id = ?`).get("synthetic-other")?.n, table).toBeGreaterThan(0);
      }
      const remaining = database.readPortfolioFacts();
      expect(remaining.state.positions).toEqual(otherFacts.state.positions.filter((p) => p.sourceAccountId === "synthetic-other"));
      expect(remaining.state.cashBalances).toEqual(otherFacts.state.cashBalances.filter((p) => p.sourceAccountId === "synthetic-other"));
      expect(remaining.events.map((e) => e.id)).toEqual(["synthetic-other-sale"]);
      expect(database.readMarketData().fxObservations).toHaveLength(1);
      expect(database.readMarketData().latestMarketRefresh).toMatchObject({ failed: 1, failures: [{ sourceAccountId: "synthetic-other" }] });
      expect(database.readLatestPortfolioNarrative()).toBeUndefined();
      expect(database.readLatestMarketIntelligenceBrief()).toBeUndefined();
      expect(sql.prepare("SELECT count(*) AS n FROM portfolio_analyst_conversations").get()?.n).toBe(1);
      expect(sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      const reopened = createPortfolioDatabase(filename);
      try {
        expect(reopened.readSourceAccounts().map((a) => a.id)).toEqual(["synthetic-other"]);
        expect(reopened.getImportDraft("synthetic-test-draft")).toBeUndefined();
        expect(reopened.readPortfolioFacts()).toEqual(remaining);
      } finally { reopened.close(); }
      expect((await handlers.DELETE(deleteRequest({ id: "synthetic-test", deletePortfolioData: true, confirmationLabel: "synthetic-test renamed" }))).status).toBe(404);
      database.createSourceAccount({ id: "synthetic-test", accountType: "synthetic-test" });
      expect(database.readPortfolioFacts()).toEqual(remaining);
      expect(database.readPriceSourceBindings().map((b) => b.sourceAccountId)).toEqual(["synthetic-other"]);
    });
  });

  it("rejects missing consent and incorrect or stale names without changing stored data", async () => {
    await withDeletionFixture(async ({ database, handlers }) => {
      const before = database.readPortfolioFacts();
      for (const body of [
        { id: "synthetic-test", deletePortfolioData: true },
        { id: "synthetic-test", confirmationLabel: "synthetic-test renamed" },
        { id: "synthetic-test", deletePortfolioData: false, confirmationLabel: "synthetic-test renamed" },
      ]) expect((await handlers.DELETE(deleteRequest(body))).status).toBe(400);
      const mismatch = await handlers.DELETE(deleteRequest({ id: "synthetic-test", deletePortfolioData: true, confirmationLabel: "synthetic-test" }));
      expect(mismatch.status).toBe(409);
      await expect(mismatch.json()).resolves.toEqual({ error: "Account name changed or does not match. Reload the accounts and confirm the current name." });
      expect(database.readPortfolioFacts()).toEqual(before);
      expect(database.readSourceAccounts()).toHaveLength(2);
    });
  });

  it("rolls back every deletion if any step fails", async () => {
    await withDeletionFixture(async ({ database, sql, handlers }) => {
      const beforeFacts = database.readPortfolioFacts();
      const beforeMarket = database.readMarketData();
      const beforeTables = accountTables.map((table) => sql.prepare(`SELECT * FROM ${table}`).all());
      const beforeCaches = ["portfolio_narratives", "market_intelligence_briefs"].map((table) => sql.prepare(`SELECT * FROM ${table}`).all());
      sql.exec("CREATE TRIGGER synthetic_delete_failure BEFORE DELETE ON source_accounts BEGIN SELECT RAISE(ABORT, 'synthetic deletion failure'); END");
      const response = await handlers.DELETE(deleteRequest({ id: "synthetic-test", deletePortfolioData: true, confirmationLabel: "synthetic-test renamed" }));
      expect(response.status).toBe(500);
      expect(database.readPortfolioFacts()).toEqual(beforeFacts);
      expect(database.readMarketData()).toEqual(beforeMarket);
      expect(accountTables.map((table) => sql.prepare(`SELECT * FROM ${table}`).all())).toEqual(beforeTables);
      expect(["portfolio_narratives", "market_intelligence_briefs"].map((table) => sql.prepare(`SELECT * FROM ${table}`).all())).toEqual(beforeCaches);
      expect(database.readSourceAccounts()).toHaveLength(2);
    });
  });

  it("preserves the account and its data when deletion is blocked", async () => {
    const database = createPortfolioDatabase(":memory:");
    try {
      database.createSourceAccount({ id: "synthetic-test", accountType: "Test", label: "Test 1" });
      database.createSourceAccount({ id: "synthetic-other", accountType: "Other" });
      database.renameSourceAccount("synthetic-test", "Test 1 renamed");
      const draft = {
        id: "synthetic-draft",
        sourceAccountId: "synthetic-test",
        sourceKind: "manual" as const,
        createdAt: "2026-10-19T09:00:00.000Z",
        confidence: "high" as const,
        warnings: [],
        portfolio: draftPortfolioFromOpeningSnapshot({
          id: "synthetic-snapshot",
          sourceAccountId: "synthetic-test",
          asOf: "2026-10-19T09:00:00.000Z",
          positions: [{
            instrumentId: "synthetic-fund",
            displayName: "Synthetic Fund",
            assetType: "fund",
            quantity: "10",
            currency: "EUR",
            costBasis: "100",
            observedPrice: "10",
            priceAsOf: "2026-10-19",
          }],
        }, "manual"),
      };
      database.saveImportDraft(draft);
      database.confirmImport({
        draftId: draft.id,
        confirmedImportId: "synthetic-confirmation",
        confirmedAt: "2026-10-19T09:01:00.000Z",
        review: { confidence: draft.confidence, warnings: draft.warnings, portfolio: draft.portfolio },
      });
      database.saveImportDraft({ ...draft, id: "synthetic-unconfirmed-draft" });

      const handlers = createAccountsHandlers({
        database,
        now: () => "2026-10-19T09:02:00.000Z",
        isTrading212Configured: () => false,
        trading212Environment: () => "demo",
      });
      const beforePage = await (await handlers.GET()).json();
      const beforeFacts = database.readPortfolioFacts();
      const beforeLabels = database.readSourceAccountLabels();
      const beforeDraft = database.getImportDraft("synthetic-unconfirmed-draft");

      const response = await handlers.DELETE(new Request("http://localhost/api/accounts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "synthetic-test" }),
      }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Remove or transfer this account's portfolio data before deleting it.",
      });
      expect(await (await handlers.GET()).json()).toEqual(beforePage);
      expect(database.readPortfolioFacts()).toEqual(beforeFacts);
      expect(database.readSourceAccountLabels()).toEqual(beforeLabels);
      expect(database.getImportDraft("synthetic-unconfirmed-draft")).toEqual(beforeDraft);
      expect(database.getImportDraft(draft.id)?.status).toBe("confirmed");
    } finally {
      database.close();
    }
  });
});
