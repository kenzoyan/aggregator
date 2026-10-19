import type { DatabaseSync } from "node:sqlite";

import {
  createSourceAccountDefinition,
  SourceAccountDeletionError,
  type SourceAccountDefinition,
} from "@/domain/source-accounts";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";
import type { MarketRefreshFailure } from "@/domain/market-data";

type SourceAccountLabelRepository = Pick<
  PortfolioDatabase,
  | "readSourceAccountLabels"
  | "readSourceAccounts"
  | "createSourceAccount"
  | "deleteSourceAccount"
  | "deleteSourceAccountWithData"
  | "renameSourceAccount"
>;

export function createSourceAccountLabelRepository(
  database: DatabaseSync,
): SourceAccountLabelRepository {
  const selectAccountLabels = database.prepare(`
    SELECT source_account_id, custom_label
    FROM source_account_labels
    ORDER BY source_account_id
  `);
  const upsertAccountLabel = database.prepare(`
    INSERT INTO source_account_labels (source_account_id, custom_label)
    VALUES (?, ?)
    ON CONFLICT(source_account_id) DO UPDATE SET
      custom_label = excluded.custom_label
  `);
  const selectAccounts = database.prepare(`
    SELECT
      accounts.id,
      accounts.account_type,
      accounts.normalized_account_type,
      accounts.provider,
      COALESCE(labels.custom_label, accounts.label) AS label,
      CASE
        WHEN labels.custom_label IS NOT NULL THEN labels.custom_label
        ELSE accounts.dashboard_label
      END AS dashboard_label,
      accounts.update_method
    FROM source_accounts AS accounts
    LEFT JOIN source_account_labels AS labels
      ON labels.source_account_id = accounts.id
    ORDER BY accounts.id
  `);
  const insertAccount = database.prepare(`
    INSERT INTO source_accounts (
      id, account_type, normalized_account_type, provider, label,
      dashboard_label, update_method
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const accountExists = database.prepare(`
    SELECT 1 FROM source_accounts WHERE id = ?
  `);
  const accountHasPortfolioData = database.prepare(`
    SELECT 1
    FROM opening_snapshots
    WHERE source_account_id = ?
    UNION ALL
    SELECT 1
    FROM market_price_observations
    WHERE source_account_id = ?
    UNION ALL
    SELECT 1
    FROM import_drafts
    WHERE source_account_id = ? AND status = 'confirmed'
    UNION ALL
    SELECT 1 FROM portfolio_events WHERE source_account_id = ?
    UNION ALL
    SELECT 1 FROM confirmed_imports WHERE source_account_id = ?
    LIMIT 1
  `);
  // Delete children before their confirmed import and draft foreign keys.
  const deleteAccountRecords = [
    "portfolio_events", "opening_snapshots", "confirmed_imports", "import_drafts",
    "market_price_observations", "price_source_bindings", "source_account_labels", "source_sync_state",
  ].map((table) => database.prepare(`DELETE FROM ${table} WHERE source_account_id = ?`));
  const deleteAccount = database.prepare(`
    DELETE FROM source_accounts WHERE id = ?
  `);
  const selectRefreshRuns = database.prepare("SELECT id, failed_count, failures_json FROM market_refresh_runs");
  const updateRefreshFailures = database.prepare("UPDATE market_refresh_runs SET failed_count = ?, failures_json = ? WHERE id = ?");

  function readAccounts(): SourceAccountDefinition[] {
    return (selectAccounts.all() as unknown as Array<{
      id: string;
      account_type: string;
      normalized_account_type: string;
      provider: SourceAccountDefinition["provider"];
      label: string;
      dashboard_label: string;
      update_method: SourceAccountDefinition["updateMethod"];
    }>).map((row) => ({
      id: row.id,
      accountType: row.account_type,
      normalizedAccountType: row.normalized_account_type,
      provider: row.provider,
      label: row.label,
      dashboardLabel: row.dashboard_label,
      updateMethod: row.update_method,
    }));
  }

  function deleteSourceAccount(id: string, confirmationLabel?: string) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const account = readAccounts().find((candidate) => candidate.id === id);
      if (!account) throw new SourceAccountDeletionError("not-found");
      if (confirmationLabel !== undefined) {
        if (confirmationLabel !== account.label) {
          throw new SourceAccountDeletionError("confirmation-mismatch");
        }
      } else if (accountHasPortfolioData.get(id, id, id, id, id)) {
        throw new SourceAccountDeletionError("has-data");
      }
      for (const statement of deleteAccountRecords) statement.run(id);
      for (const run of selectRefreshRuns.all() as Array<{ id: number; failed_count: number; failures_json: string }>) {
        const failures = JSON.parse(run.failures_json) as MarketRefreshFailure[];
        const remaining = failures.filter((failure) => failure.sourceAccountId !== id);
        if (remaining.length !== failures.length) {
          updateRefreshFailures.run(Math.max(0, run.failed_count - failures.length + remaining.length), JSON.stringify(remaining), run.id);
        }
      }
      // These shared caches describe the old portfolio and must be regenerated.
      database.exec("DELETE FROM portfolio_narratives; DELETE FROM market_intelligence_briefs;");
      deleteAccount.run(id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    readSourceAccountLabels() {
      const labelRows = selectAccountLabels.all() as unknown as Array<{
        source_account_id: string;
        custom_label: string;
      }>;
      return Object.fromEntries(
        labelRows.map((row) => [row.source_account_id, row.custom_label]),
      );
    },

    readSourceAccounts() {
      return readAccounts();
    },

    createSourceAccount(input) {
      const account = createSourceAccountDefinition(input);
      try {
        insertAccount.run(
          account.id,
          account.accountType,
          account.normalizedAccountType,
          account.provider,
          account.label,
          account.dashboardLabel,
          account.updateMethod,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("source_accounts.normalized_account_type") ||
            error.message.includes("source_accounts.id"))
        ) {
          throw new Error("Source Account type already exists");
        }
        throw error;
      }
      return account;
    },

    deleteSourceAccount(id) {
      deleteSourceAccount(id);
    },

    deleteSourceAccountWithData(id, confirmationLabel) {
      deleteSourceAccount(id, confirmationLabel);
    },

    renameSourceAccount(id, label) {
      if (!accountExists.get(id)) {
        throw new Error(`Unknown Source Account ${id}`);
      }
      const normalized = label.trim();
      if (!normalized) {
        throw new Error("Source Account label cannot be empty");
      }
      upsertAccountLabel.run(id, normalized);
    },
  };
}
