import { DatabaseSync } from "node:sqlite";

import {
  materializeConfirmedImportSnapshot,
  prepareImportDraftForReview,
  normalizeSnapshotHistory,
  type ConfirmedImportRecord,
  type ImportDraftInput,
  type StoredImportDraft,
} from "@/domain/imports";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type {
  FxRateObservation,
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import type {
  OpeningSnapshotInput,
  PortfolioEventInput,
} from "@/domain/portfolio/types";
import { createMarketIntelligenceBriefRepository } from "@/infrastructure/sqlite/market-intelligence-brief-repository";
import { createPortfolioAnalystConversationRepository } from "@/infrastructure/sqlite/portfolio-analyst-conversation-repository";
import { createPortfolioNarrativeRepository } from "@/infrastructure/sqlite/portfolio-narrative-repository";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";
import { initializePortfolioSchema } from "@/infrastructure/sqlite/portfolio-schema";
import { createSourceAccountLabelRepository } from "@/infrastructure/sqlite/source-account-label-repository";

export * from "@/infrastructure/sqlite/portfolio-repository-contract";
export {
  LegacyPortfolioDatabaseError,
  portfolioSchemaVersion,
} from "@/infrastructure/sqlite/portfolio-schema";

interface ImportDraftRow {
  id: string;
  source_account_id: string;
  source_kind: ImportDraftInput["sourceKind"];
  created_at: string;
  confidence: string;
  warnings_json: string;
  portfolio_json: string;
  status: StoredImportDraft["status"];
  confirmed_at: string | null;
}

interface FactRow {
  payload_json: string;
}

interface SnapshotFactRow extends FactRow {
  payload_scope: "complete" | "legacy-partial";
}

function decodeDraft(row: ImportDraftRow): StoredImportDraft {
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    sourceKind: row.source_kind,
    createdAt: row.created_at,
    confidence: row.confidence,
    warnings: JSON.parse(row.warnings_json) as string[],
    portfolio: JSON.parse(row.portfolio_json) as ImportDraftInput["portfolio"],
    status: row.status,
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}),
  };
}

export function createPortfolioDatabase(filename: string): PortfolioDatabase {
  const database = new DatabaseSync(filename);
  try {
    initializePortfolioSchema(database);
  } catch (error) {
    database.close();
    throw error;
  }
  const portfolioAnalystConversations =
    createPortfolioAnalystConversationRepository(database);
  const marketIntelligenceBriefs =
    createMarketIntelligenceBriefRepository(database);
  const portfolioNarratives = createPortfolioNarrativeRepository(database);
  const sourceAccountLabels = createSourceAccountLabelRepository(database);

  const insertDraft = database.prepare(`
    INSERT INTO import_drafts (
      id, source_account_id, source_kind, created_at, confidence,
      warnings_json, portfolio_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
  `);
  const selectDraft = database.prepare(
    "SELECT * FROM import_drafts WHERE id = ?",
  );
  const updateReviewedDraft = database.prepare(`
    UPDATE import_drafts
    SET confidence = ?, warnings_json = ?, portfolio_json = ?
    WHERE id = ? AND status = 'draft'
  `);
  const markDraftConfirmed = database.prepare(`
    UPDATE import_drafts
    SET status = 'confirmed', confirmed_at = ?
    WHERE id = ? AND status = 'draft'
  `);
  const insertConfirmedImport = database.prepare(`
    INSERT INTO confirmed_imports (
      id, draft_id, source_account_id, source_kind, confirmed_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertSnapshot = database.prepare(`
    INSERT INTO opening_snapshots (
      id, source_account_id, as_of, payload_json, confirmed_import_id,
      payload_scope
    ) VALUES (?, ?, ?, ?, ?, 'complete')
  `);
  const selectSnapshots = database.prepare(`
    SELECT opening_snapshots.payload_json, opening_snapshots.payload_scope
    FROM opening_snapshots
    JOIN confirmed_imports
      ON confirmed_imports.id = opening_snapshots.confirmed_import_id
    ORDER BY opening_snapshots.as_of, confirmed_imports.confirmed_at,
      opening_snapshots.rowid
  `);
  const selectConfirmedImports = database.prepare(`
    SELECT id, draft_id, source_account_id, source_kind, confirmed_at
    FROM confirmed_imports
    ORDER BY confirmed_at, rowid
  `);
  const selectConfirmedSnapshots = database.prepare(`
    SELECT opening_snapshots.payload_json, confirmed_imports.confirmed_at
    FROM opening_snapshots
    JOIN confirmed_imports
      ON confirmed_imports.id = opening_snapshots.confirmed_import_id
    ORDER BY confirmed_imports.confirmed_at, opening_snapshots.rowid
  `);
  const selectEvents = database.prepare(`
    SELECT payload_json FROM portfolio_events ORDER BY as_of, id
  `);
  const upsertMarketPrice = database.prepare(`
    INSERT INTO market_price_observations (
      source_account_id, instrument_id, instrument_code, price,
      currency, as_of, recorded_at, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_account_id, instrument_id, as_of, source) DO UPDATE SET
      instrument_code = excluded.instrument_code,
      price = excluded.price,
      currency = excluded.currency,
      recorded_at = excluded.recorded_at
  `);
  const selectMarketPrices = database.prepare(`
    SELECT source_account_id, instrument_id, instrument_code, price,
      currency, as_of, recorded_at, source
    FROM market_price_observations
    ORDER BY recorded_at, as_of, rowid
  `);
  const upsertFxObservation = database.prepare(`
    INSERT INTO fx_observations (
      currency, eur_per_unit, as_of, recorded_at, source
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(currency, as_of, source) DO UPDATE SET
      eur_per_unit = excluded.eur_per_unit,
      recorded_at = excluded.recorded_at
  `);
  const selectFxObservations = database.prepare(`
    SELECT currency, eur_per_unit, as_of, recorded_at, source
    FROM fx_observations
    ORDER BY as_of, recorded_at, currency
  `);
  const insertMarketRefresh = database.prepare(`
    INSERT INTO market_refresh_runs (
      mode, provider, completed_at, updated_count, unchanged_count,
      failed_count, failures_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const selectMarketRefreshHistory = database.prepare(`
    SELECT mode, provider, completed_at, updated_count, unchanged_count,
      failed_count, failures_json
    FROM market_refresh_runs
    ORDER BY completed_at DESC, id DESC
    LIMIT 10
  `);
  function getImportDraft(id: string): StoredImportDraft | undefined {
    const row = selectDraft.get(id) as ImportDraftRow | undefined;
    return row ? decodeDraft(row) : undefined;
  }

  function readOpeningSnapshots(): OpeningSnapshotInput[] {
    return normalizeSnapshotHistory(
      (selectSnapshots.all() as unknown as SnapshotFactRow[]).map((row) => ({
        snapshot: JSON.parse(row.payload_json) as OpeningSnapshotInput,
        payloadScope: row.payload_scope,
      })),
    );
  }

  function readEvents(): PortfolioEventInput[] {
    return (selectEvents.all() as unknown as FactRow[]).map(
      (row) => JSON.parse(row.payload_json) as PortfolioEventInput,
    );
  }

  function readMarketPrices(): MarketPriceObservation[] {
    const rows = selectMarketPrices.all() as unknown as Array<{
      source_account_id: string;
      instrument_id: string;
      instrument_code: string;
      price: string;
      currency: string;
      as_of: string;
      recorded_at: string;
      source: string;
    }>;
    return rows.map((row) => ({
      sourceAccountId: row.source_account_id,
      instrumentId: row.instrument_id,
      instrumentCode: row.instrument_code,
      price: row.price,
      currency: row.currency,
      asOf: row.as_of,
      recordedAt: row.recorded_at,
      source: row.source,
    }));
  }

  function readFxObservations(): FxRateObservation[] {
    const rows = selectFxObservations.all() as unknown as Array<{
      currency: string;
      eur_per_unit: string;
      as_of: string;
      recorded_at: string;
      source: string;
    }>;
    return rows.map((row) => ({
      currency: row.currency,
      eurPerUnit: row.eur_per_unit,
      asOf: row.as_of,
      recordedAt: row.recorded_at,
      source: row.source,
    }));
  }

  return {
    saveImportDraft(draft) {
      const completedDraft = prepareImportDraftForReview(
        draft,
        buildPortfolioState({
          openingSnapshots: readOpeningSnapshots(),
          events: readEvents(),
        }),
      );
      insertDraft.run(
        completedDraft.id,
        completedDraft.sourceAccountId,
        completedDraft.sourceKind,
        completedDraft.createdAt,
        completedDraft.confidence,
        JSON.stringify(completedDraft.warnings),
        JSON.stringify(completedDraft.portfolio),
      );
    },

    getImportDraft,

    confirmImport(command) {
      const existing = getImportDraft(command.draftId);
      if (!existing) {
        throw new Error(`Import Draft ${command.draftId} does not exist`);
      }
      if (existing.status === "confirmed") return existing;
      if (existing.status !== "draft") {
        throw new Error(`Import Draft ${command.draftId} cannot be confirmed`);
      }

      const reviewedDraft: ImportDraftInput = {
        ...existing,
        confidence: command.review.confidence,
        warnings: command.review.warnings,
        portfolio: command.review.portfolio,
      };
      const openingSnapshots = readOpeningSnapshots();
      const events = readEvents();
      const snapshotKind = existing.portfolio.reconciliation?.snapshotKind ??
        (openingSnapshots.some(
            (candidate) =>
              candidate.sourceAccountId === reviewedDraft.sourceAccountId,
          )
          ? "holding-state"
          : "opening");
      const snapshot = reviewedDraft.sourceKind === "demo"
        ? undefined
        : materializeConfirmedImportSnapshot({
            draft: reviewedDraft,
            currentState: buildPortfolioState({ openingSnapshots, events }),
            snapshotKind,
          });

      database.exec("BEGIN IMMEDIATE");
      try {
        const update = updateReviewedDraft.run(
          command.review.confidence,
          JSON.stringify(command.review.warnings),
          JSON.stringify(command.review.portfolio),
          command.draftId,
        );
        if (update.changes !== 1) {
          throw new Error(`Import Draft ${command.draftId} changed during confirmation`);
        }
        insertConfirmedImport.run(
          command.confirmedImportId,
          command.draftId,
          existing.sourceAccountId,
          existing.sourceKind,
          command.confirmedAt,
        );
        if (snapshot) {
          insertSnapshot.run(
            snapshot.id,
            snapshot.sourceAccountId,
            snapshot.asOf,
            JSON.stringify(snapshot),
            command.confirmedImportId,
          );
        }
        markDraftConfirmed.run(command.confirmedAt, command.draftId);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      return getImportDraft(command.draftId)!;
    },

    readPortfolioFacts() {
      const openingSnapshots = readOpeningSnapshots();
      const events = readEvents();
      const confirmedImportRows = selectConfirmedImports.all() as unknown as Array<{
        id: string;
        draft_id: string;
        source_account_id: string;
        source_kind: ConfirmedImportRecord["sourceKind"];
        confirmed_at: string;
      }>;
      const confirmedImports = confirmedImportRows.map((row) => ({
        id: row.id,
        draftId: row.draft_id,
        sourceAccountId: row.source_account_id,
        sourceKind: row.source_kind,
        confirmedAt: row.confirmed_at,
      }));
      const confirmedSnapshotRows = selectConfirmedSnapshots.all() as unknown as Array<{
        payload_json: string;
        confirmed_at: string;
      }>;
      const confirmedSnapshots = confirmedSnapshotRows.map((row) => ({
        snapshot: openingSnapshots.find(
          (snapshot) => snapshot.id ===
            (JSON.parse(row.payload_json) as OpeningSnapshotInput).id,
        ) ?? JSON.parse(row.payload_json) as OpeningSnapshotInput,
        confirmedAt: row.confirmed_at,
      }));
      return {
        openingSnapshots,
        events,
        confirmedImports,
        confirmedSnapshots,
        state: buildPortfolioState({ openingSnapshots, events }),
      };
    },

    readMarketData() {
      const refreshRows = selectMarketRefreshHistory.all() as unknown as Array<{
        mode: MarketRefreshRecord["mode"];
        provider: string;
        completed_at: string;
        updated_count: number;
        unchanged_count: number;
        failed_count: number;
        failures_json: string;
      }>;
      const marketRefreshHistory = refreshRows.map((row) => ({
        mode: row.mode,
        provider: row.provider,
        completedAt: row.completed_at,
        updated: row.updated_count,
        unchanged: row.unchanged_count,
        failed: row.failed_count,
        failures: (JSON.parse(row.failures_json) as Array<Partial<
          MarketRefreshRecord["failures"][number]
        >>).map((failure) => ({
          instrumentCode: failure.instrumentCode ?? "Earlier run",
          category: failure.category ?? "legacy-redacted",
          message: failure.message ??
            "Failure details from this earlier run were removed for privacy",
        })),
      }));
      const latestMarketRefresh = marketRefreshHistory[0];
      return {
        observations: readMarketPrices(),
        fxObservations: readFxObservations(),
        marketRefreshHistory,
        ...(latestMarketRefresh ? { latestMarketRefresh } : {}),
      };
    },

    recordMarketData(input) {
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const observation of input.observations) {
          upsertMarketPrice.run(
            observation.sourceAccountId,
            observation.instrumentId,
            observation.instrumentCode,
            observation.price,
            observation.currency,
            observation.asOf,
            observation.recordedAt,
            observation.source,
          );
        }
        for (const observation of input.fxObservations ?? []) {
          upsertFxObservation.run(
            observation.currency,
            observation.eurPerUnit,
            observation.asOf,
            observation.recordedAt,
            observation.source,
          );
        }
        if (input.refresh) {
          insertMarketRefresh.run(
            input.refresh.mode,
            input.refresh.provider,
            input.refresh.completedAt,
            input.refresh.updated,
            input.refresh.unchanged,
            input.refresh.failed,
            JSON.stringify(input.refresh.failures),
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    ...sourceAccountLabels,
    ...portfolioNarratives,
    ...marketIntelligenceBriefs,
    ...portfolioAnalystConversations,

    close() {
      database.close();
    },
  };
}
