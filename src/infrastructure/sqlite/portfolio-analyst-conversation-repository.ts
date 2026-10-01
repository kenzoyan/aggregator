import type { DatabaseSync } from "node:sqlite";

import type {
  PortfolioAnalystConversation,
  PortfolioAnalystConversationStore,
} from "@/application/portfolio-analyst-conversation";

interface PortfolioAnalystConversationRow {
  id: string;
  provider: PortfolioAnalystConversation["provider"];
  language: PortfolioAnalystConversation["language"];
  include_holding_names: number;
  created_at: string;
  updated_at: string;
  turns_json: string;
}

function decodePortfolioAnalystConversation(
  row: PortfolioAnalystConversationRow | undefined,
): PortfolioAnalystConversation | undefined {
  if (!row) return undefined;
  const stored = JSON.parse(row.turns_json) as
    | PortfolioAnalystConversation["turns"]
    | (Pick<PortfolioAnalystConversation, "turns"> & {
        importActivity?: PortfolioAnalystConversation["importActivities"][number];
        importActivities?: PortfolioAnalystConversation["importActivities"];
      });
  const turns = Array.isArray(stored) ? stored : stored.turns;
  const importActivities = Array.isArray(stored) ? []
    : stored.importActivities ?? (stored.importActivity ? [stored.importActivity] : []);
  return {
    version: "portfolio-analyst-conversation.v1",
    id: row.id,
    provider: row.provider,
    language: row.language,
    includeHoldingNames: row.include_holding_names === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turns,
    importActivities,
  };
}

export function createPortfolioAnalystConversationRepository(
  database: DatabaseSync,
): PortfolioAnalystConversationStore {
  const upsertConversation = database.prepare(`
    INSERT INTO portfolio_analyst_conversations (
      id, provider, language, include_holding_names, created_at, updated_at,
      turns_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      language = excluded.language,
      include_holding_names = excluded.include_holding_names,
      updated_at = excluded.updated_at,
      turns_json = excluded.turns_json
  `);
  const selectConversation = database.prepare(`
    SELECT id, provider, language, include_holding_names, created_at,
      updated_at, turns_json
    FROM portfolio_analyst_conversations
    WHERE id = ?
  `);
  const selectLatestConversation = database.prepare(`
    SELECT id, provider, language, include_holding_names, created_at,
      updated_at, turns_json
    FROM portfolio_analyst_conversations
    ORDER BY updated_at DESC, rowid DESC
    LIMIT 1
  `);
  const deleteConversation = database.prepare(
    "DELETE FROM portfolio_analyst_conversations WHERE id = ?",
  );

  return {
    readLatestPortfolioAnalystConversation() {
      return decodePortfolioAnalystConversation(
        selectLatestConversation.get() as
          | PortfolioAnalystConversationRow
          | undefined,
      );
    },

    readPortfolioAnalystConversation(id) {
      return decodePortfolioAnalystConversation(
        selectConversation.get(id) as
          | PortfolioAnalystConversationRow
          | undefined,
      );
    },

    savePortfolioAnalystConversation(conversation) {
      upsertConversation.run(
        conversation.id,
        conversation.provider,
        conversation.language,
        conversation.includeHoldingNames ? 1 : 0,
        conversation.createdAt,
        conversation.updatedAt,
        JSON.stringify({
          turns: conversation.turns,
          importActivities: conversation.importActivities,
        }),
      );
    },

    deletePortfolioAnalystConversation(id) {
      deleteConversation.run(id);
    },
  };
}
