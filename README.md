# Invest Assets Monitor

A private, local-first investment portfolio monitor for combining holdings from multiple platforms into one EUR-based view.

## Initial product scope

- Desktop-first web app, with mobile layout polish planned after the core workflow
- Funds, stocks, bonds, and investment-account cash
- Trading 212 read-only synchronization
- Screenshot-assisted imports with review and confirmation
- Reusable CSV holdings imports with stable fund codes, names, quantities and NAV dates
- Manual-entry fallback with editable holding rows
- Current value plus daily and recent-period performance
- Clear source timestamps and stale/manual data states
- Four independently named Source Accounts: Alipay, WeChat, Danske and Trading 212

The first milestone is developed and tested locally. Tested source-code milestones are committed to this repository afterward.

## Run locally

Requirements: Node.js 23+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). A new local database starts empty. Synthetic data appears only after you explicitly choose **Explore demo**, and it is never written into your portfolio. Use **Update assets → No API key? Try the demo** to test the full review and confirmation gate.

### Rebuild the local test database

Schema v2 separates editable Import Drafts, Confirmed Imports and portfolio facts. The pre-v2 local database contained test data only and is intentionally not migrated. If startup reports a disposable pre-v2 schema, stop the app and move the old file out of the active path:

```bash
mkdir -p data/pre-v2
mv data/invest-assets-monitor.sqlite* data/pre-v2/
```

If `.env.local` sets `PORTFOLIO_DB_FILENAME`, replace `invest-assets-monitor.sqlite` in the command with that configured basename. Start the app again to create a clean v2 database, then import `data/imports/alipay-funds.csv` and sync Trading 212 again. The moved database remains local and ignored by Git, so the reset is recoverable.

Real integrations are enabled only through `.env.local`:

- `OPENAI_API_KEY` and `OPENAI_VISION_MODEL` enable cloud screenshot extraction. Images are processed in memory and are not saved by the app.
- `TRADING212_API_KEY` and `TRADING212_API_SECRET` configure the Trading 212 Source Account. Create a key with only account-data and portfolio read permissions; do not grant order permissions. Keep `TRADING212_ENVIRONMENT=demo` until that environment is verified, then create a separate Live key before switching to `live`. The server calls only `GET /equity/account/summary` and `GET /equity/positions`; credentials never reach the browser or portfolio database.

Use **Accounts** to rename the four local Source Accounts and see the last confirmed snapshot, imported holding count, update method and stale/not-connected state. Account names are stored only in the ignored local SQLite database.

Use **Update assets → Saved holdings CSV** to reopen a locally stored holdings file as a review draft. CSV rows do not affect the portfolio until confirmation. Personal CSV files under `data/imports/` remain ignored by Git.

CSV, screenshot and manual updates are partial by default: previously confirmed holdings from the same Source Account are carried into the review so that updating one holding cannot silently remove the others. Remove a carried holding in the review only when it is genuinely no longer held. Trading 212 API synchronization remains a complete account snapshot.

Use **Refresh prices** on the portfolio overview to check published NAVs for supported six-digit CNY fund codes held in Alipay or WeChat. Each check fills missing NAV dates since monitoring began, so checking a few times per month can still preserve a near-daily curve. The first provider is the public Eastmoney/Tiantian Fund NAV service. It requires no credential and receives only the public fund code—not account credentials, quantities, costs or portfolio totals. It is a third-party source behind a replaceable provider interface; failures keep the last successful local price.

Use **Update NAV / price** on an existing holding to record a dated manual observation when an automatic provider is unavailable. This changes Market Data only; it never changes Quantity or Cost Basis. Once a valid baseline exists, the holding row shows the baseline/current dates and separates the EUR price effect from the FX effect.

Price observations are stored separately from Holding State. A refresh never changes quantity, Cost Basis or Reported Prior Return. Today, 7-day and 30-day monitored performance becomes available only as new NAV observations accumulate after the Opening Snapshot; the app does not invent pre-monitoring portfolio history.

FX observations are also stored as dated market data. Portfolio and holding history use only prices and ECB rates known at each valuation date. Each holding shows its selected-period EUR change and a compact trend once a valid baseline exists; otherwise it explicitly stays in **Awaiting baseline**. Additional units, newly imported holdings and sale proceeds are treated as capital changes rather than investment return.

## Near-term roadmap

- Refresh supported prices automatically once per Helsinki day when the dashboard opens, while keeping Holding State unchanged. Extend and verify read-only price-provider coverage for Trading 212 ETFs before considering an operating-system background scheduler.

Local portfolio records are stored in `data/invest-assets-monitor.sqlite`. The entire `data` database remains ignored by Git.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Privacy

This repository contains application code and the minimum documentation needed to build and run it. Personal financial data, raw screenshots, API keys, local databases, product-thinking notes, and development logs remain outside Git.
