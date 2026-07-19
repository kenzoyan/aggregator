"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  demoHoldings,
  periodData,
  type DashboardHolding,
  type Period,
} from "@/application/demo-dashboard";

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
  const [localPortfolio, setLocalPortfolio] = useState<{
    holdings: DashboardHolding[];
    totalValueEur: number;
    fxAsOf: string;
    missingInputs: unknown[];
    history: Record<Period, {
      available: boolean;
      change: number;
      percent: number;
      points: number[];
    }>;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/portfolio", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          hasPortfolioData: boolean;
          portfolio: NonNullable<typeof localPortfolio>;
        };
        if (payload.hasPortfolioData) setLocalPortfolio(payload.portfolio);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const isLocal = Boolean(localPortfolio);
  const holdings = localPortfolio?.holdings ?? demoHoldings;
  const localHistory = localPortfolio?.history[period];
  const current = isLocal
    ? {
        ...periodData[period],
        change: localHistory?.change ?? 0,
        percent: localHistory?.percent ?? 0,
        points: localHistory?.available && localHistory.points.length > 1
          ? localHistory.points
          : [50, 50, 50, 50, 50, 50],
      }
    : periodData[period];
  const total = localPortfolio?.totalValueEur ?? holdings.reduce((sum, holding) => sum + holding.eurValue, 0);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-hidden="true">IM</div>
        <nav aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><span>◫</span>Overview</a>
          <a className="nav-item" href="#holdings"><span>◎</span>Holdings</a>
          <Link className="nav-item" href="/imports"><span>↥</span>Import</Link>
        </nav>
        <div className="privacy-note"><span className="status-dot" />Local mode<br /><small>Data stays on this device</small></div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">INVEST ASSETS MONITOR</p>
            <h1>Portfolio overview</h1>
          </div>
          <div className="header-actions">
            <span className="demo-badge">{isLocal ? "Local data" : "Demo data"}</span>
            <Link className="primary-button" href="/imports">Update assets</Link>
          </div>
        </header>

        <section className="hero-grid">
          <article className="balance-card">
            <div className="card-heading">
              <span>Current investment assets</span>
              <span className="coverage">{isLocal ? `${holdings.length} valued positions` : "10 / 12 valued today"}</span>
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
              {isLocal && !localHistory?.available ? (
                <div><span>{current.label} change</span><strong className="pending-change">Waiting for the next snapshot</strong><small>Starts after two confirmed snapshots</small></div>
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
              <span className="market-note">{isLocal ? `ECB rates ${localPortfolio?.fxAsOf}` : "Last valued 16:18"}<br />{isLocal ? "Prior return retained" : "Some funds await NAV"}</span>
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
          <div><span className="insight-icon">✓</span><p><strong>{isLocal ? "Local ledger connected" : "Trading 212"}</strong><small>{isLocal ? "Confirmed snapshots are active" : "Read-only connector ready"}</small></p></div>
          <div><span className="insight-icon amber">◷</span><p><strong>{isLocal ? "Performance baseline" : "2 funds awaiting NAV"}</strong><small>{isLocal ? "Comparison starts after the next update" : "Missing data is never shown as zero"}</small></p></div>
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
          </div>
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <a className="active" href="#overview"><span>◫</span>Overview</a>
        <a href="#holdings"><span>◎</span>Holdings</a>
        <Link href="/imports"><span>↥</span>Import</Link>
      </nav>
    </div>
  );
}
