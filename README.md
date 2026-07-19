# Invest Assets Monitor

A private, local-first investment portfolio monitor for combining holdings from multiple platforms into one EUR-based view.

## Initial product scope

- Responsive web app for desktop and mobile browsers
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

Real integrations are enabled only through `.env.local`:

- `OPENAI_API_KEY` and `OPENAI_VISION_MODEL` enable cloud screenshot extraction. Images are processed in memory and are not saved by the app.
- `TRADING212_API_KEY` and `TRADING212_API_SECRET` configure the Trading 212 Source Account. Keep `TRADING212_ENVIRONMENT=demo` until the read-only connection is verified.

Use **Accounts** to rename the four local Source Accounts and see the last confirmed snapshot, imported holding count, update method and stale/not-connected state. Account names are stored only in the ignored local SQLite database.

Use **Update assets → Saved holdings CSV** to reopen a locally stored holdings file as a review draft. CSV rows do not affect the portfolio until confirmation. Personal CSV files under `data/imports/` remain ignored by Git.

Local portfolio records are stored in `data/invest-assets-monitor.sqlite`. The entire `data` database remains ignored by Git.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Privacy

This repository contains application code and the minimum documentation needed to build and run it. Personal financial data, raw screenshots, API keys, local databases, product-thinking notes, and development logs remain outside Git.
