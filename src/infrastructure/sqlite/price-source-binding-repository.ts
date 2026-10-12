import type { DatabaseSync } from "node:sqlite";

import type { PriceSourceBinding } from "@/application/price-source-discovery";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";

type PriceSourceBindingRepository = Pick<PortfolioDatabase, "readPriceSourceBindings" | "savePriceSourceBinding">;

export function createPriceSourceBindingRepository(database: DatabaseSync): PriceSourceBindingRepository {
  const select = database.prepare(`
    SELECT source_account_id, instrument_id, instrument_name, instrument_code,
      currency, share_class, provider, identity_url, confirmed_at,
      last_checked_at, last_outcome, latest_price_as_of, last_failure_category
    FROM price_source_bindings
  `);
  const upsert = database.prepare(`
    INSERT INTO price_source_bindings (
      source_account_id, instrument_id, instrument_name, instrument_code,
      currency, share_class, provider, identity_url, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_account_id, instrument_id) DO UPDATE SET
      instrument_name = excluded.instrument_name,
      instrument_code = excluded.instrument_code,
      currency = excluded.currency,
      share_class = excluded.share_class,
      provider = excluded.provider,
      identity_url = excluded.identity_url,
      confirmed_at = excluded.confirmed_at,
      last_checked_at = NULL,
      last_outcome = NULL,
      latest_price_as_of = NULL,
      last_failure_category = NULL
  `);

  return {
    readPriceSourceBindings() {
      const rows = select.all() as unknown as Array<{
        source_account_id: string;
        instrument_id: string;
        instrument_name: string;
        instrument_code: string;
        currency: string;
        share_class: string;
        provider: PriceSourceBinding["provider"];
        identity_url: string;
        confirmed_at: string;
        last_checked_at: string | null;
        last_outcome: NonNullable<PriceSourceBinding["lastRefresh"]>["outcome"] | null;
        latest_price_as_of: string | null;
        last_failure_category: NonNullable<PriceSourceBinding["lastRefresh"]>["failureCategory"] | null;
      }>;
      return rows.map((row) => ({
        sourceAccountId: row.source_account_id,
        instrumentId: row.instrument_id,
        instrumentName: row.instrument_name,
        instrumentCode: row.instrument_code,
        currency: row.currency,
        shareClass: row.share_class,
        provider: row.provider,
        identityUrl: row.identity_url,
        confirmedAt: row.confirmed_at,
        ...(row.last_checked_at && row.last_outcome ? { lastRefresh: {
          checkedAt: row.last_checked_at,
          outcome: row.last_outcome,
          ...(row.latest_price_as_of ? { latestPriceAsOf: row.latest_price_as_of } : {}),
          ...(row.last_failure_category ? { failureCategory: row.last_failure_category } : {}),
        } } : {}),
      }));
    },
    savePriceSourceBinding(binding) {
      upsert.run(
        binding.sourceAccountId,
        binding.instrumentId,
        binding.instrumentName,
        binding.instrumentCode,
        binding.currency,
        binding.shareClass,
        binding.provider,
        binding.identityUrl,
        binding.confirmedAt,
      );
    },
  };
}
