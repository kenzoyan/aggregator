# Invest Assets Monitor

A private, local-first investment portfolio monitor for combining holdings from multiple platforms into one EUR-based view.

For a detailed explanation of the layers, data models, import flows, SQLite
tables and performance calculations, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Initial product scope

- Desktop-first web app, with mobile layout polish planned after the core workflow
- Funds, stocks, bonds, and investment-account cash
- Trading 212 read-only synchronization
- Screenshot-assisted imports with review and confirmation
- Reusable CSV holdings imports with stable fund codes, names, quantities and NAV dates
- Manual-entry fallback with editable holding rows
- Current value plus separate total-value and daily-performance history
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

Schema v3 separates editable Import Drafts, Confirmed Imports and portfolio facts, and adds locally saved narrative reports. Existing v2 databases upgrade to v3 in place without rebuilding portfolio data. The pre-v2 local database contained test data only and is intentionally not migrated. If startup reports a disposable pre-v2 schema, stop the app and move the old file out of the active path:

```bash
mkdir -p data/pre-v2
mv data/invest-assets-monitor.sqlite* data/pre-v2/
```

If `.env.local` sets `PORTFOLIO_DB_FILENAME`, replace `invest-assets-monitor.sqlite` in the command with that configured basename. Start the app again to create a clean v3 database, then import `data/imports/alipay-funds.csv` and sync Trading 212 again. The moved database remains local and ignored by Git, so the reset is recoverable.

Real integrations are enabled only through `.env.local`:

- `TRADING212_API_KEY` and `TRADING212_API_SECRET` configure the Trading 212 Source Account. Create a key with only account-data and portfolio read permissions; do not grant order permissions. Keep `TRADING212_ENVIRONMENT=demo` until that environment is verified, then create a separate Live key before switching to `live`. The server calls only `GET /equity/account/summary` and `GET /equity/positions`; credentials never reach the browser or portfolio database.

Screenshot-based accounts use OpenAI vision through the Responses API. Set `OPENAI_API_KEY` in `.env.local`; optionally choose a model with `OPENAI_IMAGE_IMPORT_MODEL` (default `gpt-5.6-terra`). The server sends the selected JPEG, PNG or WebP directly as an image input with original detail and requests a strict structured extraction. It does not persist the original image or provider response. Every result becomes an editable Import Draft and cannot change the portfolio until the user confirms it. Do not upload a screenshot if sending it to the configured OpenAI API account is unacceptable.

The normal test suite mocks the cloud boundary. To run the opt-in accuracy check against the committed synthetic Chinese multi-holding image, set `RUN_OPENAI_VISION_EVAL=1` and run `npm test -- tests/evaluation/openai-vision-import.eval.test.ts`. This consumes OpenAI API usage and never sends personal portfolio data.

Use **Accounts** to see current allocation by source, rename the four local Source Accounts and inspect the last confirmed snapshot, imported holding count, update method and stale/not-connected state. Account names are stored only in the ignored local SQLite database.

Use **Update assets → Saved holdings CSV** to reopen a locally stored holdings file as a review draft. CSV rows do not affect the portfolio until confirmation. Personal CSV files under `data/imports/` remain ignored by Git.

Screenshot review shows only the holdings detected in that image. On confirmation, other confirmed holdings in the same Source Account are preserved automatically, so a one-holding screenshot neither clutters the review nor removes the rest of the account. CSV and manual partial updates retain their existing full-review behavior: previously confirmed holdings are carried into review and can be explicitly removed. Trading 212 API synchronization remains a complete account snapshot.

Trading 212 synchronization reconciles the complete API response against the latest confirmed Holding State by Source Account plus ticker/ISIN identity. If quantity, Cost Basis and Portfolio Cash are unchanged, the app records new prices directly as Market Data and skips the confirmation screen. Real holding changes open a Before/After review: changed and new holdings are expanded, unchanged holdings are collapsed, and a holding absent from the complete API response is marked **Possibly removed** until explicitly confirmed. Repeated price checks never overwrite the Reported Prior Return captured when monitoring began.

When a Trading 212 state change does require review, existing price-only holdings can legitimately have a latest Current Value that no longer equals Cost Basis plus the frozen pre-monitoring Reported Prior Return. Confirmation therefore keeps quantity-times-price validation for every row, keeps the full accounting check for new holdings, and does not apply that initial-import accounting identity to already tracked Trading 212 holdings. The review count names holding changes and Portfolio Cash separately.

Use **Refresh prices** on the portfolio overview to check published NAVs for supported six-digit CNY fund codes held in Alipay or WeChat and current prices for already-confirmed Trading 212 positions. Each fund check fills missing NAV dates since monitoring began, so checking a few times per month can still preserve a near-daily curve. The first fund provider is the public Eastmoney/Tiantian Fund NAV service. It requires no credential and receives only the public fund code—not account credentials, quantities, costs or portfolio totals. Trading 212 refresh reuses the configured read-only connection but stores Market Data only; a quantity, Cost Basis or cash change still requires **Update assets → Sync Trading 212** and confirmation. Provider failures keep the last successful local price.

When a non-empty local portfolio first loads, the dashboard also requests an automatic price refresh. The server performs it only if no market refresh has completed during the current `Europe/Helsinki` calendar day, so reopening or reloading the dashboard does not repeatedly call providers. The manual **Refresh prices** button deliberately bypasses this daily gate for explicit retries. Automatic and manual refreshes share the same Market Data-only path and therefore never change Quantity, Cost Basis or Portfolio Cash.

Use **Update NAV / price** inside an existing holding's detail drawer to record a dated manual observation when an automatic provider is unavailable. This changes Market Data only; it never changes Quantity or Cost Basis. Once a valid baseline exists, the holding row shows the baseline/current dates and separates the EUR price effect from the FX effect.

Select an investment holding to open its detail drawer. The drawer keeps Holding State facts—Quantity and Cost Basis—separate from the current NAV, monitored-period Price/FX effects and saved price observations. Current value and the drawer show calculated total return from the latest value minus historical Cost Basis; the source-reported return remains visible as the value captured at the last holding update. Portfolio Cash is not presented as an investment holding detail.

Price observations are stored separately from Holding State. A refresh never changes quantity, Cost Basis or Reported Prior Return. **Today** means each holding's latest available daily price/NAV move plus the applicable FX move; this allows a QDII fund whose NAV publishes one or more days later to use its latest two available NAV dates instead of degrading to an FX-only calendar-day comparison. The portfolio Today number is the sum of those holding changes. The app cannot calculate a NAV that has not yet been published, so the UI retains the actual baseline/current NAV dates. Before a full 7-day or 30-day window exists, the UI uses the earliest real monitored baseline and labels the result as a partial range; older portfolios with missing history remain in **Awaiting baseline**.

The overview keeps one primary chart with a **Total value / Daily change** switch. Total value reconstructs the actual amount held at each dated valuation, so deposits, withdrawals, purchases and sales can move that line. It separates the period movement into investment performance and inferred portfolio activity. Quantity comparisons provide factual added, increased, reduced and exited holding markers even when a cash-funded trade leaves total value unchanged; unexplained EUR movement remains separately labelled as estimated capital activity. Recent events are listed below the chart. Daily change remains the capital-flow-adjusted investment-performance view: Today uses the summary only, while 7- and 30-day bars can be selected to inspect a specific date and EUR move. These meanings stay separate instead of overlaying incompatible EUR balances and returns.

FX observations are also stored as dated market data. The overview shows the latest ECB EUR/CNY reference rate (`€1` in CNY) in its compact data-status row. Portfolio and holding history use only prices and ECB rates known at each valuation date. Each holding shows its selected-period EUR change and a compact trend once a valid baseline exists; otherwise it explicitly stays in **Awaiting baseline**. Additional units, newly imported holdings and sale proceeds are treated as capital changes rather than investment return.

The overview also derives a local **Portfolio insights** read model from the valued holdings. It summarizes position concentration, holding-currency and asset-category allocation, the latest price/FX contribution, available movers and data-quality gaps. Holding currency means the instrument's quoted currency, not look-through exposure to its underlying assets. These facts are calculated by application code and remain useful without an LLM.

An optional cloud narrative can explain that read model in English or Simplified Chinese. It is generated only after selecting **Generate narrative**; loading or refreshing the dashboard never calls an LLM. The browser sends only the selected provider and language, and the server rebuilds current insights from the local ledger and Market Data before contacting the provider. Configure either `OPENAI_API_KEY` or `DEEPSEEK_API_KEY` in `.env.local`, optionally choose models with `OPENAI_NARRATIVE_MODEL` and `DEEPSEEK_NARRATIVE_MODEL`, then restart the app. The defaults are `gpt-5.6-terra` and `deepseek-v4-flash`. The provider receives only aggregate insight facts, including the display names of the largest holding and recent movers when available. It does not receive internal holding IDs, the full holding list, quantities, cost basis, trades, screenshots, credentials or database records.

Each generated statement must cite one or more server-defined fact keys. The completed report, model metadata, an aggregate-facts fingerprint and only the cited fact summaries are saved in the ignored local SQLite database. The latest report returns after a page reload; it is marked **current facts** while its fingerprint matches the current local insights, and **previous facts** after the portfolio facts change. Expand **View saved fact sources** to inspect the exact aggregate facts supporting each statement. API keys and raw prompts are never stored. Narrative text remains informational, may be incorrect, and is never investment advice.

## Near-term roadmap

- Add a small refresh-history view so provider failures and manual/automatic runs can be inspected without opening the local database.

Local portfolio records are stored in `data/invest-assets-monitor.sqlite`. The entire `data` database remains ignored by Git.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Privacy

This repository contains application code and the minimum documentation needed to build and run it. Personal financial data, raw screenshots, API keys, local databases, product-thinking notes, and development logs remain outside Git.
