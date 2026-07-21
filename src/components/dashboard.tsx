"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  demoHoldings,
  periodData,
  type DashboardHolding,
  type Period,
} from "@/application/demo-dashboard";
import {
  demoPortfolioStorageKey,
  parseDemoPortfolioRecord,
  toDemoDashboardHoldings,
} from "@/application/demo-portfolio";
import type { MarketRefreshResult } from "@/application/market-refresh";

const eur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const freshnessLabels: Record<DashboardHolding["freshness"], string> = {
  fresh: "Updated",
  manual: "Manual",
  stale: "Stale",
  "awaiting-nav": "Awaiting NAV",
};

const allAccounts = "All accounts";

function formatRefreshFailures(
  failures: readonly { instrumentCode: string; message: string }[],
) {
  return failures
    .map((failure) => `${failure.instrumentCode} (${failure.message})`)
    .join("; ");
}

interface LocalPortfolioData {
  holdings: DashboardHolding[];
  totalValueEur: number;
  fxAsOf: string;
  missingInputs: unknown[];
  marketData: {
    lastRefreshedAt?: string;
    latestResult?: {
      updated: number;
      unchanged: number;
      failed: number;
      failures: Array<{ instrumentCode: string; message: string }>;
    };
  };
  history: Record<Period, {
    available: boolean;
    change: number;
    percent: number;
    points: number[];
  }>;
}

function Sparkline({ points, negative }: { points: number[]; negative: boolean }) {
  const path = useMemo(() => {
    const max = Math.max(...points);
    const min = Math.min(...points);
    const range = max - min || 1;
    return points
      .map((point, index) => {
        const x = (index / (points.length - 1)) * 100;
        const y = 56 - ((point - min) / range) * 44;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);

  return (
    <svg className="sparkline" viewBox="0 0 100 64" preserveAspectRatio="none" aria-label="Portfolio value trend">
      <defs>
        <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={negative ? "#e26d76" : "#13a779"} stopOpacity="0.3" />
          <stop offset="100%" stopColor={negative ? "#e26d76" : "#13a779"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L100,64 L0,64 Z`} fill="url(#chart-fill)" />
      <path d={path} fill="none" stroke={negative ? "#d95763" : "#078d68"} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Change({ value, percent }: { value: number; percent: number }) {
  const positive = value >= 0;
  return (
    <span className={positive ? "positive" : "negative"}>
      {positive ? "+" : "−"}{eur.format(Math.abs(value))} · {positive ? "+" : "−"}{Math.abs(percent).toFixed(2)}%
    </span>
  );
}

export function Dashboard() {
  const [period, setPeriod] = useState<Period>("today");
  const [source, setSource] = useState(allAccounts);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [reviewedDemoHoldings, setReviewedDemoHoldings] = useState<DashboardHolding[]>();
  const [loading, setLoading] = useState(true);
  const [localPortfolio, setLocalPortfolio] = useState<LocalPortfolioData>();
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string>();

  async function loadLocalPortfolio(signal?: AbortSignal) {
    const response = await fetch("/api/portfolio", { signal });
    if (!response.ok) throw new Error("Portfolio could not be loaded");
    const payload = (await response.json()) as {
      hasPortfolioData: boolean;
      portfolio: LocalPortfolioData;
    };
    if (payload.hasPortfolioData) setLocalPortfolio(payload.portfolio);
  }

  useEffect(() => {
    setDemoEnabled(new URLSearchParams(window.location.search).get("demo") === "1");
    try {
      const savedDemo = parseDemoPortfolioRecord(window.localStorage.getItem(demoPortfolioStorageKey));
      if (savedDemo) setReviewedDemoHoldings(toDemoDashboardHoldings(savedDemo));
    } catch {
      // The built-in sample remains available if private browsing blocks local storage.
    }
    const controller = new AbortController();
    loadLocalPortfolio(controller.signal)
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  function setDemoMode(enabled: boolean) {
    setDemoEnabled(enabled);
    const url = new URL(window.location.href);
    if (enabled) {
      url.searchParams.set("demo", "1");
    } else {
      url.searchParams.delete("demo");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function refreshPrices() {
    setRefreshingPrices(true);
    setRefreshMessage(undefined);
    try {
      const response = await fetch("/api/market-data/refresh", { method: "POST" });
      const summary = (await response.json()) as MarketRefreshResult & { error?: string };
      if (!response.ok) throw new Error(summary.error ?? "Price refresh failed");
      await loadLocalPortfolio();
      const tracked = summary.updated + summary.unchanged + summary.failed.length;
      setRefreshMessage(
        summary.failed.length > 0
          ? `${summary.updated} updated · failed: ${formatRefreshFailures(summary.failed)}; previous prices kept`
          : summary.updated > 0
            ? `${summary.updated} of ${tracked} fund NAVs updated`
            : `${tracked} fund NAVs are already current`,
      );
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : "Price refresh failed");
    } finally {
      setRefreshingPrices(false);
    }
  }

  const isLocal = Boolean(localPortfolio) && !demoEnabled;
  const hasVisiblePortfolio = isLocal || demoEnabled;
  const usingReviewedDemo = demoEnabled && Boolean(reviewedDemoHoldings);
  const activeDemoHoldings = reviewedDemoHoldings ?? demoHoldings;
  const holdings = demoEnabled ? activeDemoHoldings : localPortfolio?.holdings ?? [];
  const localHistory = isLocal ? localPortfolio?.history[period] : undefined;
  const current = isLocal
    ? {
        ...periodData[period],
        change: localHistory?.change ?? 0,
        percent: localHistory?.percent ?? 0,
        points: localHistory?.available && localHistory.points.length > 1
          ? localHistory.points
          : [50, 50, 50, 50, 50, 50],
      }
    : demoEnabled && !usingReviewedDemo
      ? periodData[period]
      : { ...periodData[period], change: 0, percent: 0, points: [50, 50, 50, 50, 50, 50] };
  const total = isLocal
    ? localPortfolio?.totalValueEur ?? 0
    : holdings.reduce((sum, holding) => sum + holding.eurValue, 0);
  const filtered = source === allAccounts ? holdings : holdings.filter((holding) => holding.source === source);
  const sources = [allAccounts, ...new Set(holdings.map((holding) => holding.source))];
  const sourceTotals = Array.from(
    holdings.reduce((totals, holding) => {
      totals.set(holding.source, (totals.get(holding.source) ?? 0) + holding.eurValue);
      return totals;
    }, new Map<string, number>()),
  ).sort((left, right) => right[1] - left[1]);
  const palette = ["#2f6ed8", "#102c52", "#0ca77d", "#d9aa61", "#7d64c2"];
  let allocationCursor = 0;
  const allocationGradient = sourceTotals.length
    ? `conic-gradient(${sourceTotals.map(([, value], index) => {
        const start = allocationCursor;
        allocationCursor += total === 0 ? 0 : (value / total) * 100;
        return `${palette[index % palette.length]} ${start.toFixed(2)}% ${allocationCursor.toFixed(2)}%`;
      }).join(", ")})`
    : undefined;
  const latestMarketResult = localPortfolio?.marketData.latestResult;
  const persistedMarketMessage = latestMarketResult
    ? latestMarketResult.failed > 0
      ? `Last check failed: ${formatRefreshFailures(latestMarketResult.failures)}; previous prices kept`
      : latestMarketResult.updated > 0
        ? `Last check updated ${latestMarketResult.updated} fund NAVs`
        : `${latestMarketResult.unchanged} fund NAVs were already current`
    : "Use Refresh prices to begin";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-hidden="true">IM</div>
        <nav aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><span>◫</span>Overview</a>
          <a className="nav-item" href="#holdings"><span>◎</span>Holdings</a>
          <Link className="nav-item" href="/accounts"><span>⌁</span>Accounts</Link>
          <Link className="nav-item" href="/imports"><span>↥</span>Import</Link>
        </nav>
        <div className="privacy-note"><span className="status-dot" />Local portfolio<br /><small>Confirmed records stay on this device</small></div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">INVEST ASSETS MONITOR</p>
            <h1>Portfolio overview</h1>
          </div>
          <div className="header-actions">
            <span className="demo-badge">{isLocal ? "Local data" : demoEnabled ? "Demo data" : loading ? "Loading" : "No portfolio"}</span>
            {!isLocal && (
              <button className="demo-toggle" type="button" onClick={() => setDemoMode(!demoEnabled)}>
                {demoEnabled ? "Exit demo" : "Explore demo"}
              </button>
            )}
            {isLocal && (
              <button
                className="refresh-button"
                type="button"
                onClick={refreshPrices}
                disabled={refreshingPrices}
              >
                {refreshingPrices ? "Refreshing…" : "↻ Refresh prices"}
              </button>
            )}
            <Link className="primary-button" href="/imports">Update assets</Link>
          </div>
        </header>

        {!loading && !hasVisiblePortfolio && (
          <section className="empty-portfolio-banner">
            <div>
              <span>◎</span>
              <div>
                <p className="eyebrow">YOUR PORTFOLIO IS EMPTY</p>
                <h2>Start with a screenshot, manual entry or Trading 212</h2>
                <p>Demo values stay separate and never become part of your local portfolio.</p>
              </div>
            </div>
            <div className="empty-portfolio-actions">
              <Link className="primary-button" href="/imports">Add my assets</Link>
              <button type="button" onClick={() => setDemoMode(true)}>View synthetic demo</button>
            </div>
          </section>
        )}

        <section className="hero-grid">
          <article className="balance-card">
            <div className="card-heading">
              <span>Current investment assets</span>
              <span className="coverage">{isLocal
                ? `${holdings.length} valued positions`
                : usingReviewedDemo
                  ? `${holdings.length} confirmed demo positions`
                  : demoEnabled
                    ? "10 / 12 valued today"
                    : "No confirmed positions"}</span>
            </div>
            <strong className="total-value">{eur.format(total)}</strong>
            <p className="subtle">EUR base currency · original currencies retained</p>
            <div className="period-tabs" role="tablist" aria-label="Select performance period">
              {(Object.keys(periodData) as Period[]).map((key) => (
                <button key={key} className={period === key ? "selected" : ""} onClick={() => setPeriod(key)} role="tab" aria-selected={period === key}>
                  {periodData[key].label}
                </button>
              ))}
            </div>
            <div className="period-summary">
              {!hasVisiblePortfolio ? (
                <div><span>{current.label} change</span><strong className="pending-change">No data yet</strong><small>Import a confirmed snapshot to begin</small></div>
              ) : usingReviewedDemo ? (
                <div><span>{current.label} change</span><strong className="pending-change">Waiting for the next demo snapshot</strong><small>Your confirmed demo holdings are shown below</small></div>
              ) : isLocal && !localHistory?.available ? (
                <div><span>{current.label} change</span><strong className="pending-change">Waiting for another dated NAV</strong><small>Starts after two dated prices are recorded</small></div>
              ) : (
                <div>
                  <span>{current.label} change</span>
                  <strong className={current.change >= 0 ? "positive" : "negative"}>
                    {current.change >= 0 ? "+" : "−"}{eur.format(Math.abs(current.change))}
                  </strong>
                  <small className={current.percent >= 0 ? "positive" : "negative"}>
                    {current.percent >= 0 ? "+" : "−"}{Math.abs(current.percent).toFixed(2)}%
                  </small>
                </div>
              )}
              <span className="market-note">{isLocal ? `ECB rates ${localPortfolio?.fxAsOf}` : usingReviewedDemo ? "Confirmed demo review" : demoEnabled ? "Synthetic valuation" : "EUR base currency"}<br />{isLocal
                ? localPortfolio?.marketData.lastRefreshedAt
                  ? `Prices checked ${localPortfolio.marketData.lastRefreshedAt.slice(0, 16).replace("T", " ")}`
                  : "Prices still use confirmed imports"
                : usingReviewedDemo ? "Stored only in this browser" : demoEnabled ? "Some funds await NAV" : "No demo data mixed in"}</span>
            </div>
            <Sparkline points={current.points} negative={current.change < 0} />
          </article>

          <article className="allocation-card">
            <div className="card-heading"><span>Account allocation</span><span>EUR</span></div>
            <div className="donut-wrap">
              <div className="donut" style={allocationGradient ? ({ background: allocationGradient } as CSSProperties) : undefined}><span><strong>{sourceTotals.length}</strong>source accounts</span></div>
            </div>
            <div className="allocation-list">
              {sourceTotals.map(([name, value], index) => (
                <div key={name}><span><i className="legend" style={{ background: palette[index % palette.length] }} />{name}</span><strong>{total === 0 ? "0%" : `${Math.round((value / total) * 100)}%`}</strong></div>
              ))}
            </div>
          </article>
        </section>

        <section className="insight-strip" aria-label="Data status">
          <div><span className="insight-icon">✓</span><p><strong>{isLocal ? "Local ledger connected" : usingReviewedDemo ? "Confirmed demo review" : demoEnabled ? "Synthetic example" : "Local ledger ready"}</strong><small>{isLocal ? "Confirmed snapshots are active" : demoEnabled ? "Never mixed with your assets" : "Add a confirmed snapshot to begin"}</small></p></div>
          <div><span className="insight-icon amber">◷</span><p><strong>{isLocal ? "Market price history" : demoEnabled ? "2 funds awaiting NAV" : "No performance baseline"}</strong><small>{isLocal ? refreshMessage ?? persistedMarketMessage : demoEnabled ? "Missing data is never shown as zero" : "Starts after two confirmed snapshots"}</small></p></div>
          <div><span className="insight-icon blue">€</span><p><strong>EUR overview</strong><small>{isLocal ? `ECB reference rates · ${localPortfolio?.missingInputs.length ?? 0} missing` : "Price and FX are calculated separately"}</small></p></div>
        </section>

        <section className="holdings-section" id="holdings">
          <div className="section-title">
            <div><p className="eyebrow">PORTFOLIO</p><h2>Holdings</h2></div>
            <label className="source-filter">Source account
              <select value={source} onChange={(event) => setSource(event.target.value)}>
                {sources.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="holdings-card">
            <div className="holding-row holding-header"><span>Asset</span><span>Status</span><span>Current value</span><span>Period change</span></div>
            {filtered.map((holding) => (
              <article className="holding-row" key={holding.id}>
                <div className="asset-cell"><span className="asset-icon">{holding.category === "Bond" ? "B" : holding.category === "Fund" ? "F" : holding.category === "Portfolio cash" ? "€" : holding.category === "Stock" ? "S" : "?"}</span><p><strong>{holding.name}</strong><small>{holding.source} · {holding.symbol} · {holding.category}</small></p></div>
                <div><span className={`freshness ${holding.freshness}`}>{freshnessLabels[holding.freshness]}</span><small className="as-of">{holding.asOf}</small></div>
                <div className="value-cell"><strong>{eur.format(holding.eurValue)}</strong><small>{holding.originalValue}</small></div>
                <div className="change-cell">
                  {isLocal
                    ? <span className="pending-change-cell">Awaiting baseline</span>
                    : <Change value={holding.changeEur} percent={holding.changePercent} />}
                </div>
              </article>
            ))}
            {filtered.length === 0 && (
              <div className="empty-holdings"><strong>No confirmed holdings</strong><small>Add or import assets to populate this table.</small></div>
            )}
          </div>
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <a className="active" href="#overview"><span>◫</span>Overview</a>
        <a href="#holdings"><span>◎</span>Holdings</a>
        <Link href="/accounts"><span>⌁</span>Accounts</Link>
        <Link href="/imports"><span>↥</span>Import</Link>
      </nav>
    </div>
  );
}
