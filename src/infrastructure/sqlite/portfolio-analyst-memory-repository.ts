import type { DatabaseSync } from "node:sqlite";

import type { PortfolioAnalystMemoryStore, PortfolioAnalystMemory } from "@/application/portfolio-analyst-memory";

interface MemoryRow {
  id: string;
  content: string;
  source: PortfolioAnalystMemory["source"];
  created_at: string;
  updated_at: string;
}

function fromRow(row: MemoryRow): PortfolioAnalystMemory {
  return {
    id: row.id, content: row.content, source: row.source,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createPortfolioAnalystMemoryRepository(database: DatabaseSync): PortfolioAnalystMemoryStore {
  const list = database.prepare("SELECT * FROM portfolio_analyst_memories ORDER BY updated_at DESC, id DESC");
  const read = database.prepare("SELECT * FROM portfolio_analyst_memories WHERE id = ?");
  const save = database.prepare(`
    INSERT INTO portfolio_analyst_memories (id, content, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content, source = excluded.source, updated_at = excluded.updated_at
  `);
  const remove = database.prepare("DELETE FROM portfolio_analyst_memories WHERE id = ?");
  return {
    listPortfolioAnalystMemories() { return (list.all() as unknown as MemoryRow[]).map(fromRow); },
    readPortfolioAnalystMemory(id) {
      const row = read.get(id) as MemoryRow | undefined;
      return row ? fromRow(row) : undefined;
    },
    savePortfolioAnalystMemory(memory) {
      save.run(memory.id, memory.content, memory.source, memory.createdAt, memory.updatedAt);
    },
    deletePortfolioAnalystMemory(id) { remove.run(id); },
  };
}
