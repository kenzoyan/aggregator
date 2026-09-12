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

Schema v5 separates editable Import Drafts, Confirmed Imports and portfolio facts, saves narrative reports locally, records an explicit snapshot payload scope for legacy recovery, and distinguishes manual from automatic market refresh runs. Existing v2–v4 databases upgrade to v5 in place without rebuilding portfolio data. The pre-v2 local database contained test data only and is intentionally not migrated. If startup reports a disposable pre-v2 schema, stop the app and move the old file out of the active path:

```bash
mkdir -p data/pre-v2
mv data/invest-assets-monitor.sqlite* data/pre-v2/
```

If `.env.local` sets `PORTFOLIO_DB_FILENAME`, replace `invest-assets-monitor.sqlite` in the command with that configured basename. Start the app again to create a clean v5 database, then import your local CSV and sync Trading 212 again. The moved database remains local and ignored by Git, so the reset is recoverable.

Real integrations are enabled only through `.env.local`:

- `TRADING212_API_KEY` and `TRADING212_API_SECRET` configure the Trading 212 Source Account. Create a key with only account-data and portfolio read permissions; do not grant order permissions. Keep `TRADING212_ENVIRONMENT=demo` until that environment is verified, then create a separate Live key before switching to `live`. The server calls only `GET /equity/account/summary` and `GET /equity/positions`; credentials never reach the browser or portfolio database.

Screenshot-based accounts use OpenAI vision through the Responses API. Set `OPENAI_API_KEY` in `.env.local`; optionally choose a model with `OPENAI_IMAGE_IMPORT_MODEL` (default `gpt-5.6-terra`). One import may contain 1–6 complementary JPEG, PNG or WebP screenshots, up to 10 MB each and 30 MB total. The server sends them together with original detail and requests one strict account-level extraction, allowing an overview, holding rows and fund-detail screens to be joined by name or ISIN. It does not persist the original images or provider response. Every result becomes an editable Import Draft and cannot change the portfolio until the user confirms it. Do not upload screenshots if sending them to the configured OpenAI API account is unacceptable.

The normal test suite mocks the cloud boundary. To run the opt-in accuracy check against the committed synthetic Chinese multi-holding image, set `RUN_OPENAI_VISION_EVAL=1` and run `npm test -- tests/evaluation/openai-vision-import.eval.test.ts`. This consumes OpenAI API usage and never sends personal portfolio data.

Use **Accounts** to see current allocation by source, rename the four local Source Accounts and inspect Holding State separately from Market Data. Each account shows when its holdings were last confirmed and whether current valuations are fresh, manual or need attention; a screenshot account can therefore be due for a holding review while still using current NAVs. Account names are stored only in the ignored local SQLite database.

Use **Update assets → Saved holdings CSV** to reopen a locally stored holdings file as a review draft. CSV rows do not affect the portfolio until confirmation. Personal CSV files under `data/imports/` remain ignored by Git.

Screenshot review shows only the holdings detected in that image. On confirmation, other confirmed holdings in the same Source Account are preserved automatically, so a one-holding screenshot neither clutters the review nor removes the rest of the account. CSV and manual partial updates retain their existing full-review behavior: previously confirmed holdings are carried into review and can be explicitly removed. Trading 212 API synchronization remains a complete account snapshot.

Trading 212 synchronization reconciles the complete API response against the latest confirmed Holding State by Source Account plus ticker/ISIN identity. If quantity, Cost Basis and Portfolio Cash are unchanged, the app records new prices directly as Market Data and skips the confirmation screen. Real holding changes open a Before/After review: changed and new holdings are expanded, unchanged holdings are collapsed, and a holding absent from the complete API response is marked **Possibly removed** until explicitly confirmed. Repeated price checks never overwrite the Reported Prior Return captured when monitoring began.

When a Trading 212 state change does require review, existing price-only holdings can legitimately have a latest Current Value that no longer equals Cost Basis plus the frozen pre-monitoring Reported Prior Return. Confirmation therefore keeps quantity-times-price validation for every row, keeps the full accounting check for new holdings, and does not apply that initial-import accounting identity to already tracked Trading 212 holdings. The review count names holding changes and Portfolio Cash separately.

Use **Refresh prices** on the portfolio overview to check published NAVs for supported six-digit CNY fund codes held in Alipay or WeChat, locally configured Danske Invest ISINs held in Danske Bank, and current prices for already-confirmed Trading 212 positions. Each fund check fills missing NAV dates since monitoring began, so checking a few times per month can still preserve a near-daily curve. CNY funds use the public Eastmoney/Tiantian Fund NAV service. Danske routes are stored in the ignored local file `data/danske-invest-funds.json`; this keeps the owner's selected ISINs out of Git while using Danske Invest's public daily NAV history. The file maps each ISIN to the official site's `fund`, `fundGroup` and `siteId` values. Neither source requires credentials and each receives only the public fund identifier and requested date range—not account credentials, quantities, costs or portfolio totals. Trading 212 refresh reuses the configured read-only connection but stores Market Data only; a quantity, Cost Basis or cash change still requires **Update assets → Sync Trading 212** and confirmation. Provider failures keep the last successful local price.

When a non-empty local portfolio first loads, the dashboard also requests an automatic price refresh. The server performs it only if no market refresh has completed during the current `Europe/Helsinki` calendar day, so reopening or reloading the dashboard does not repeatedly call providers. The manual **Refresh prices** button deliberately bypasses this daily gate for explicit retries. Automatic and manual refreshes share the same Market Data-only path and therefore never change Quantity, Cost Basis or Portfolio Cash.

Expand **Refresh history** below the data-status row to inspect the ten most recent checks. Each entry shows whether the run was manual or automatic, its completion time, provider set, updated/unchanged/failed counts and safe failure summaries. Runs created before schema v5 appear as **Earlier run** because their original trigger was not stored, and their old arbitrary error details are replaced during migration with a fixed privacy-safe summary. A valid Danske Invest fund ISIN without a local route is reported explicitly as a configuration issue; the private route mapping and raw provider responses are never exposed. Failed checks keep the last successful local prices.

Use **Update NAV / price** inside an existing holding's detail drawer to record a dated manual observation when an automatic provider is unavailable. This changes Market Data only; it never changes Quantity or Cost Basis. Once a valid baseline exists, the holding row shows the baseline/current dates and separates the EUR price effect from the FX effect.

Select an investment holding to open its detail drawer. The drawer keeps Holding State facts—Quantity and Cost Basis—separate from the current NAV, monitored-period Price/FX effects and saved price observations. Current value and the drawer show calculated total return from the latest value minus historical Cost Basis; the source-reported return remains visible as the value captured at the last holding update. Portfolio Cash is not presented as an investment holding detail.

Price observations are stored separately from Holding State. A refresh never changes quantity, Cost Basis or Reported Prior Return. **Today** means each holding's latest available daily price/NAV move plus the applicable FX move; this allows a QDII fund whose NAV publishes one or more days later to use its latest two available NAV dates instead of degrading to an FX-only calendar-day comparison. The portfolio Today number is the sum of those holding changes. The app cannot calculate a NAV that has not yet been published, so the UI retains the actual baseline/current NAV dates. Before a full 7-day or 30-day window exists, the UI uses the earliest real monitored baseline and labels the result as a partial range; older portfolios with missing history remain in **Awaiting baseline**.

The overview keeps one primary chart with an **Investment change / Total value** switch. Investment change is the default capital-flow-adjusted performance view: Today uses the summary only, while 7- and 30-day bars can be selected to inspect a specific date and EUR move. Its period summary separates Price and FX contributions. Total value reconstructs the actual amount held at each dated valuation, so deposits, withdrawals, purchases and sales can move that line; the low-information Total value mode is disabled for Today. The longer-period total-value view separates investment performance from inferred portfolio activity. Quantity comparisons provide factual added, increased, reduced and exited holding markers, while estimated activity below €1 is treated as rounding-sized display noise. The chart and grouped activity list show at most the four most recent material activity dates, keeping holding facts distinct from estimated capital activity.

FX observations are also stored as dated market data. The overview shows the latest ECB EUR/CNY reference rate (`€1` in CNY) in its compact data-status row. Portfolio and holding history use only prices and ECB rates known at each valuation date. Each holding shows its selected-period EUR change and a compact trend once a valid baseline exists; otherwise it explicitly stays in **Awaiting baseline**. Additional units, newly imported holdings and sale proceeds are treated as capital changes rather than investment return.

The overview also derives a local **What matters now** read model from the valued holdings. It gives current price/FX movement and movers first, surfaces data issues only when attention is needed, and keeps slower-changing portfolio concentration in a compact summary. Quoted-currency allocation is omitted from the homepage because it is not look-through market exposure. These facts are calculated by application code and remain useful without an LLM.

The overview presents Portfolio insights as local calculated facts without a separate cloud-narrative panel. Conversational explanations belong in the Portfolio Agent. The earlier on-demand narrative API and locally saved reports remain compatible for now, but loading or refreshing the dashboard does not call them or any LLM.

Legacy narrative reports remain evidence-backed: each saved statement cites server-defined fact keys, and the ignored local SQLite database stores only the completed report, model metadata, an aggregate-facts fingerprint and cited fact summaries. API keys and raw prompts are never stored. This compatibility path may be removed after equivalent aggregate-insight tools are available in the Portfolio Agent.

The **Portfolio Agent** opens from a floating control into a left-side conversation workspace while the portfolio remains visible on the right; on small screens it becomes a full-width sheet. One shared collapsible navigation rail now remains visible across Overview, Accounts, Import and Settings, with mobile navigation using the same destinations. Infrequently changed Agent defaults and AI privacy controls live on Settings so the conversation remains primary. A new conversation offers three localized starter questions for common performance and data-quality checks; choosing one sends it immediately, as does submitting a typed question. Agent Activity shows one compact row for each read tool that actually ran, including its scope and bounded fact count; generic selection and answer-generation steps are omitted. The conversational answer streams beneath that activity without changing into a report when it completes. Each answer retains only its generation time and local-facts marker in the conversation; scope, snapshot time, provider and model move inside the collapsed Facts & evidence attachment, while the investment-advice boundary appears once at the composer. The streamed text is provisional: only a complete answer that passes the existing schema and current-turn Evidence validation is persisted. Every message rebuilds fresh, bounded facts; only the last three user/assistant turn pairs are sent to resolve conversational references, and historical answer text is explicitly excluded as evidence. Up to twelve complete turns are retained in the ignored local SQLite database for page reloads. Provider, language and holding-name privacy remain fixed within a conversation; saved Settings apply after **Reset & delete** starts a new conversation. Pi owns the model/tool loop, provider transport, events and cancellation behind an application interface; application-owned tools and semantic validation continue to own portfolio facts and safety boundaries.

## Near-term roadmap

The milestone letters are retained for continuity, but their execution order is intentionally not alphabetical. Milestone O remains deferred until explicit Portfolio Events are useful enough to justify their additional workflow complexity.

### Completed foundation

- **Milestones K–M — Application seams and import reliability (complete):** import lifecycle semantics, review editing, valuation orchestration, provider boundaries, synthetic tests and the current Danske multi-image workflow.
- **Milestone N — Stabilization and operational visibility (complete, v1.0):** auditable manual/automatic refresh history, provider results, updated/unchanged/failed counts and privacy-safe configuration diagnostics. Market refresh remains read-only with respect to Holding State.
- **Milestone P — Bounded Analyst foundation (complete, v1.1):** deterministic `readPeriodDrivers` and `readDataQuality` tools, a versioned privacy-preserving context, strict Evidence and answer validation, OpenAI/DeepSeek adapters and the explicit on-demand Analyst panel. This foundation was later extended by the conversational milestones below.
- **Milestone Q — Conversation architecture and Pi Harness spike (accepted):** the owner accepted the conversational interaction after hands-on review. A disposable synthetic prototype validated per-turn immutable facts snapshots, stale-Evidence omission, privacy-triggered reset, cancellation and application-owned budgets. Its decision was absorbed into the production `PortfolioAnalystSession` seam; the prototype itself was removed.
- **Milestone R — Evidence-backed multi-round Analyst (complete locally):** Pi-backed conversation lifecycle, bounded history, fresh facts on every turn, local persistence, reload recovery, cancellation, reset/delete controls, genuine provider streaming and per-call disclosure. A pending question is visible immediately; partial answer text is never persisted and is replaced only by a complete schema- and Evidence-validated report. Provider/language/name privacy settings are immutable inside one conversation. The app still chooses the approved job, and every material claim must pass the existing current-turn Evidence validator.

### Planned execution order

1. **Milestone S — Model-controlled read-only tools and audit (in progress):** Pi and `pi-ai` let the configured OpenAI or DeepSeek model select the current read tools it needs, up to a four-call safety bound. The allowlist now includes period drivers, data quality and a bounded portfolio overview; results from multiple calls receive separate Evidence namespaces and are combined before answer validation. Each actual tool call appears as one compact Agent Activity row and is stored in the completed turn audit. Synthetic runtime tests and an opt-in real-OpenAI evaluation verify tool selection without using the owner's portfolio. Next slices can add period comparison, holding timeline, refresh-history inspection and durable audit records for failed runs. Tools may suggest a refresh or open an import workflow, but they cannot execute a Holding State change.

### Deferred and optional work

- **Milestone O — Explicit Portfolio Events (deferred):** add confirmed purchase, sale, deposit/withdrawal, distribution, fee, transfer and correction workflows only when the owner needs those operations or Agent evaluations show that estimated portfolio activity is no longer sufficient. Preserve confirmation and append-only auditability.
- **Milestone T — Automation and reliability (optional):** consider local scheduled market refresh, stale-data alerts, provider health/backoff and backup/recovery guidance after the conversational Analyst and refresh history are reliable. Do not run background LLM calls by default.

The current intended sequence is **N → P → Q → R → S**, then reassess **O** and **T** from actual usage. The Agent remains informational: no trading permissions, autonomous portfolio mutations or investment advice.

Local portfolio records are stored in `data/invest-assets-monitor.sqlite`. The entire `data` database remains ignored by Git.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Privacy

This repository contains application code and the minimum documentation needed to build and run it. Personal financial data, raw screenshots, API keys, local databases, product-thinking notes, and development logs remain outside Git.
