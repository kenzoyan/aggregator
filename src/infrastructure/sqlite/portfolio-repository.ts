import { DatabaseSync } from "node:sqlite";

import type { PortfolioNarrativeReport } from "@/application/portfolio-narrative";
import {
  materializeConfirmedImportSnapshot,
  prepareImportDraftForReview,
  normalizeSnapshotHistory,
  type ConfirmedImportRecord,
  type ImportDraftInput,
  type ImportDraftReview,
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
  PortfolioState,
} from "@/domain/portfolio/types";
import { findSourceAccount } from "@/domain/source-accounts";
import { initializePortfolioSchema } from "@/infrastructure/sqlite/portfolio-schema";

export {
  LegacyPortfolioDatabaseError,
  portfolioSchemaVersion,
} from "@/infrastructure/sqlite/portfolio-schema";

export interface ConfirmedSnapshotRecord {
  snapshot: OpeningSnapshotInput;
  confirmedAt: string;
}

export interface PortfolioFacts {
  openingSnapshots: OpeningSnapshotInput[];
  events: PortfolioEventInput[];
  confirmedImports: ConfirmedImportRecord[];
  confirmedSnapshots: ConfirmedSnapshotRecord[];
  state: PortfolioState;
}

export interface MarketDataHistory {
  observations: MarketPriceObservation[];
  fxObservations: FxRateObservation[];
  latestMarketRefresh?: MarketRefreshRecord;
}

export interface ConfirmImportCommand {
  draftId: string;
  confirmedImportId: string;
  confirmedAt: string;
  review: ImportDraftReview;
}

export interface PortfolioDatabase {
  saveImportDraft(draft: ImportDraftInput): void;
  getImportDraft(id: string): StoredImportDraft | undefined;
  confirmImport(command: ConfirmImportCommand): StoredImportDraft;
  readPortfolioFacts(): PortfolioFacts;
  readMarketData(): MarketDataHistory;
  readSourceAccountLabels(): Record<string, string>;
  recordMarketData(input: {
    observations: readonly MarketPriceObservation[];
    fxObservations?: readonly FxRateObservation[];
    refresh?: MarketRefreshRecord;
  }): void;
  renameSourceAccount(id: string, label: string): void;
  savePortfolioNarrative(report: PortfolioNarrativeReport): void;
  readLatestPortfolioNarrative(): PortfolioNarrativeReport | undefined;
  close(): void;
}

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
      provider, completed_at, updated_count, unchanged_count,
      failed_count, failures_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectLatestMarketRefresh = database.prepare(`
    SELECT provider, completed_at, updated_count, unchanged_count,
      failed_count, failures_json
    FROM market_refresh_runs
    ORDER BY completed_at DESC, id DESC
    LIMIT 1
  `);
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
  const insertPortfolioNarrative = database.prepare(`
    INSERT INTO portfolio_narratives (
      id, provider, model, language, generated_at, portfolio_as_of,
      facts_fingerprint, content_json, provenance_json, disclaimer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectLatestPortfolioNarrative = database.prepare(`
    SELECT id, provider, model, language, generated_at, portfolio_as_of,
      facts_fingerprint, content_json, provenance_json, disclaimer
    FROM portfolio_narratives
    ORDER BY generated_at DESC, rowid DESC
    LIMIT 1
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
      const latestRefreshRow = selectLatestMarketRefresh.get() as {
        provider: string;
        completed_at: string;
        updated_count: number;
        unchanged_count: number;
        failed_count: number;
        failures_json: string;
      } | undefined;
      const latestMarketRefresh = latestRefreshRow
        ? {
            provider: latestRefreshRow.provider,
            completedAt: latestRefreshRow.completed_at,
            updated: latestRefreshRow.updated_count,
            unchanged: latestRefreshRow.unchanged_count,
            failed: latestRefreshRow.failed_count,
            failures: JSON.parse(latestRefreshRow.failures_json) as MarketRefreshRecord["failures"],
          }
        : undefined;
      return {
        observations: readMarketPrices(),
        fxObservations: readFxObservations(),
        ...(latestMarketRefresh ? { latestMarketRefresh } : {}),
      };
    },

    readSourceAccountLabels() {
      const labelRows = selectAccountLabels.all() as unknown as Array<{
        source_account_id: string;
        custom_label: string;
      }>;
      return Object.fromEntries(
        labelRows.map((row) => [row.source_account_id, row.custom_label]),
      );
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

    savePortfolioNarrative(report) {
      insertPortfolioNarrative.run(
        report.id,
        report.provider,
        report.model,
        report.language,
        report.generatedAt,
        report.portfolioAsOf,
        report.factsFingerprint,
        JSON.stringify({
          headline: report.headline,
          overview: report.overview,
          observations: report.observations,
          dataQuality: report.dataQuality,
        }),
        JSON.stringify(report.provenance),
        report.disclaimer,
      );
    },

    readLatestPortfolioNarrative() {
      const row = selectLatestPortfolioNarrative.get() as {
        id: string;
        provider: PortfolioNarrativeReport["provider"];
        model: string;
        language: PortfolioNarrativeReport["language"];
        generated_at: string;
        portfolio_as_of: string;
        facts_fingerprint: string;
        content_json: string;
        provenance_json: string;
        disclaimer: string;
      } | undefined;
      if (!row) return undefined;
      const content = JSON.parse(row.content_json) as Pick<
        PortfolioNarrativeReport,
        "headline" | "overview" | "observations" | "dataQuality"
      >;
      return {
        id: row.id,
        provider: row.provider,
        model: row.model,
        language: row.language,
        generatedAt: row.generated_at,
        portfolioAsOf: row.portfolio_as_of,
        factsFingerprint: row.facts_fingerprint,
        provenance: JSON.parse(row.provenance_json) as PortfolioNarrativeReport["provenance"],
        disclaimer: row.disclaimer,
        ...content,
      };
    },

    close() {
      database.close();
    },
  };
}
