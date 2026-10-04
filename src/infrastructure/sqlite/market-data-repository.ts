import type { DatabaseSync } from "node:sqlite";

import type {
  FxRateObservation,
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";

type MarketDataRepository = Pick<
  PortfolioDatabase,
  "readMarketData" | "recordMarketData"
>;

export function createMarketDataRepository(
  database: DatabaseSync,
): MarketDataRepository {
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
  const updatePriceSourceStatus = database.prepare(`
    UPDATE price_source_bindings SET
      last_checked_at = ?,
      last_outcome = ?,
      latest_price_as_of = COALESCE(?, latest_price_as_of),
      last_failure_category = ?
    WHERE source_account_id = ? AND instrument_id = ?
      AND instrument_code = ? AND provider = ?
  `);

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
          ...(failure.sourceAccountId ? { sourceAccountId: failure.sourceAccountId } : {}),
          ...(failure.instrumentId ? { instrumentId: failure.instrumentId } : {}),
          ...(typeof failure.retryCount === "number" ? { retryCount: failure.retryCount } : {}),
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
        for (const status of input.priceSourceStatuses ?? []) {
          updatePriceSourceStatus.run(
            status.checkedAt,
            status.outcome,
            status.latestPriceAsOf ?? null,
            status.failureCategory ?? null,
            status.sourceAccountId,
            status.instrumentId,
            status.instrumentCode,
            status.provider,
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
