# Invest Assets Monitor

A private, local-first investment portfolio monitor for combining holdings from multiple platforms into one EUR-based view.

## Initial product scope

- Responsive web app for desktop and mobile browsers
- Funds, stocks, bonds, and investment-account cash
- Trading 212 read-only synchronization
- Screenshot-assisted imports with review and confirmation
- Current value plus daily and recent-period performance
- Clear source timestamps and stale/manual data states

The first milestone is developed and tested locally. Tested source-code milestones are committed to this repository afterward.

## Run locally

Requirements: Node.js 23+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard starts with clearly labelled synthetic demo data. Use **Update assets → No API key? Try the demo** to test the full review and confirmation gate.

Real integrations are enabled only through `.env.local`:

- `OPENAI_API_KEY` and `OPENAI_VISION_MODEL` enable cloud screenshot extraction. Images are processed in memory and are not saved by the app.
- `TRADING212_API_KEY` and `TRADING212_API_SECRET` enable the official read-only account summary and positions endpoints. Keep `TRADING212_ENVIRONMENT=demo` until the connection is verified.

Local portfolio records are stored in `data/invest-assets-monitor.sqlite`. The entire `data` database remains ignored by Git.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Privacy

This repository contains application code and the minimum documentation needed to build and run it. Personal financial data, raw screenshots, API keys, local databases, product-thinking notes, and development logs remain outside Git.
