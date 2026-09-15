import type { DatabaseSync } from "node:sqlite";

import { findSourceAccount } from "@/domain/source-accounts";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";

type SourceAccountLabelRepository = Pick<
  PortfolioDatabase,
  "readSourceAccountLabels" | "renameSourceAccount"
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

    renameSourceAccount(id, label) {
      if (!findSourceAccount(id)) {
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
