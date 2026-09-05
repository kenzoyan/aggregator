"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import {
  demoHoldings,
  periodData,
} from "@/application/demo-dashboard";
import { formatSignedOriginalMoney } from "@/application/money-format";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import type {
  FxOverviewReadModel,
  HoldingReadModel,
  Period,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";
import {
  comparableSparklineModels,
  type ComparableSparklineModel,
} from "@/application/sparkline-model";
import {
  demoPortfolioStorageKey,
  parseDemoPortfolioRecord,
  toDemoDashboardHoldings,
} from "@/application/demo-portfolio";
import type { MarketRefreshResult } from "@/application/market-refresh";
import { PortfolioInsights } from "@/components/portfolio-insights";

const eur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const fxRate = new Intl.NumberFormat("en-FI", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const freshnessLabels: Record<HoldingReadModel["freshness"], string> = {
  fresh: "Updated",
  manual: "Manual",
  stale: "Stale",
  "awaiting-nav": "Awaiting NAV",
};

const allAccounts = "All accounts";

interface AutomaticRefreshSkip {
  automatic: true;
  skipped: true;
  reason: "already-refreshed-today" | "no-refreshable-positions";
  lastRefreshedAt?: string;
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function keepTabFocusInside(
  event: KeyboardEvent,
  focusable: readonly HTMLElement[],
) {
  if (event.key !== "Tab" || focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function formatRefreshFailures(
  failures: readonly { instrumentCode: string; message: string }[],
) {
  return failures
    .map((failure) => `${failure.instrumentCode} (${failure.message})`)
    .join("; ");
}

function Sparkline({
  points,
  negative,
  compact = false,
  detail = false,
  label = "Portfolio value trend",
  comparableModel,
}: {
  points: number[];
  negative: boolean;
  compact?: boolean;
  detail?: boolean;
  label?: string;
  comparableModel?: ComparableSparklineModel;
}) {
  const gradientId = `chart-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const path = useMemo(() => {
    if (comparableModel) return comparableModel.path;
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
  }, [comparableModel, points]);
  const zeroY = comparableModel?.zeroY;
  const fillBottom = zeroY ?? 64;

  return (
    <svg className={compact ? "holding-sparkline" : detail ? "detail-sparkline" : "sparkline"} viewBox="0 0 100 64" preserveAspectRatio="none" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={negative ? "#e26d76" : "#13a779"} stopOpacity="0.3" />
          <stop offset="100%" stopColor={negative ? "#e26d76" : "#13a779"} stopOpacity="0" />
        </linearGradient>
      </defs>
      {zeroY !== undefined && (
        <line className="sparkline-baseline" x1="0" x2="100" y1={zeroY} y2={zeroY} />
      )}
      <path d={`${path} L100,${fillBottom} L0,${fillBottom} Z`} fill={`url(#${gradientId})`} />
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

function signedEur(value: number) {
  return `${value >= 0 ? "+" : "−"}${eur.format(Math.abs(value))}`;
}

function returnPercent(percent?: number) {
  if (percent === undefined) return "";
  return ` · ${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(2)}%`;
}

export function Dashboard() {
  const [period, setPeriod] = useState<Period>("today");
  const [source, setSource] = useState(allAccounts);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [reviewedDemoHoldings, setReviewedDemoHoldings] = useState<HoldingReadModel[]>();
  const [loading, setLoading] = useState(true);
  const [localPortfolio, setLocalPortfolio] = useState<PortfolioOverviewReadModel>();
  const [localFxOverview, setLocalFxOverview] = useState<FxOverviewReadModel>();
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string>();
  const [priceEditor, setPriceEditor] = useState<HoldingReadModel>();
  const [manualPrice, setManualPrice] = useState("");
  const [manualPriceDate, setManualPriceDate] = useState("");
  const [savingManualPrice, setSavingManualPrice] = useState(false);
  const [manualPriceError, setManualPriceError] = useState<string>();
  const [selectedHoldingId, setSelectedHoldingId] = useState<string>();
  const [drawerPeriod, setDrawerPeriod] = useState<Period>("today");
  const holdingDrawerRef = useRef<HTMLElement>(null);
  const holdingDrawerTriggerRef = useRef<HTMLElement | null>(null);
  const priceEditorRef = useRef<HTMLFormElement>(null);
  const priceEditorTriggerRef = useRef<HTMLElement | null>(null);

  async function loadLocalPortfolio(signal?: AbortSignal) {
    const response = await fetch("/api/portfolio", { signal });
    if (!response.ok) throw new Error("Portfolio could not be loaded");
    const payload = (await response.json()) as {
      hasPortfolioData: boolean;
      portfolio: PortfolioOverviewReadModel;
    };
    setLocalFxOverview(payload.portfolio.fxOverview);
    setLocalPortfolio(payload.hasPortfolioData ? payload.portfolio : undefined);
    return payload.hasPortfolioData;
  }

  useEffect(() => {
    try {
      const savedDemo = parseDemoPortfolioRecord(window.localStorage.getItem(demoPortfolioStorageKey));
      if (savedDemo) setReviewedDemoHoldings(toDemoDashboardHoldings(savedDemo));
    } catch {
      // The built-in sample remains available if private browsing blocks local storage.
    }
    const controller = new AbortController();
    const showingDemo = new URLSearchParams(window.location.search).get("demo") === "1";
    setDemoEnabled(showingDemo);
    loadLocalPortfolio(controller.signal)
      .then((hasPortfolioData) => hasPortfolioData && !showingDemo
        ? refreshPrices("automatic", controller.signal)
        : undefined)
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedHoldingId && !priceEditor) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (priceEditor) {
        closePriceEditor();
      } else {
        closeHoldingDrawer();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [priceEditor, selectedHoldingId]);

  useEffect(() => {
    const drawer = holdingDrawerRef.current;
    if (!selectedHoldingId || priceEditor || !drawer) return;
    const focusable = [...drawer.querySelectorAll<HTMLElement>(focusableSelector)];
    focusable[0]?.focus();
    function keepFocusInside(event: KeyboardEvent) {
      keepTabFocusInside(event, focusable);
    }
    window.addEventListener("keydown", keepFocusInside);
    return () => window.removeEventListener("keydown", keepFocusInside);
  }, [priceEditor, selectedHoldingId]);

  useEffect(() => {
    const editor = priceEditorRef.current;
    if (!priceEditor || !editor) return;
    const focusable = [...editor.querySelectorAll<HTMLElement>(focusableSelector)];
    focusable[0]?.focus();
    function keepFocusInside(event: KeyboardEvent) {
      keepTabFocusInside(event, focusable);
    }
    window.addEventListener("keydown", keepFocusInside);
    return () => window.removeEventListener("keydown", keepFocusInside);
  }, [priceEditor]);

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

  async function refreshPrices(
    mode: "manual" | "automatic" = "manual",
    signal?: AbortSignal,
  ) {
    setRefreshingPrices(true);
    setRefreshMessage(undefined);
    try {
      const response = await fetch(
        `/api/market-data/refresh${mode === "automatic" ? "?mode=automatic" : ""}`,
        { method: "POST", signal },
      );
      const summary = (await response.json()) as
        | (MarketRefreshResult & { automatic: boolean; error?: string })
        | AutomaticRefreshSkip
        | { error: string };
      if (!response.ok) {
        throw new Error("error" in summary ? summary.error : "Price refresh failed");
      }
      if ("reason" in summary) return;
      if ("error" in summary) throw new Error(summary.error);
      if (!("updated" in summary)) return;
      await loadLocalPortfolio(signal);
      const tracked = summary.updated + summary.unchanged + summary.failed.length;
      const message =
        summary.failed.length > 0
          ? `${summary.updated} updated · failed: ${formatRefreshFailures(summary.failed)}; previous prices kept`
          : summary.updated > 0
            ? `${summary.updated} of ${tracked} market prices updated`
            : `${tracked} market prices are already current`;
      setRefreshMessage(mode === "automatic" ? `Daily check · ${message}` : message);
    } catch (error) {
      if (signal?.aborted) return;
      setRefreshMessage(error instanceof Error ? error.message : "Price refresh failed");
    } finally {
      setRefreshingPrices(false);
    }
  }

  function openPriceEditor(
    holding: HoldingReadModel,
    trigger?: HTMLElement,
  ) {
    priceEditorTriggerRef.current = trigger ?? null;
    trigger?.blur();
    setPriceEditor(holding);
    setManualPrice("");
    setManualPriceDate(portfolioCalendarDate());
    setManualPriceError(undefined);
  }

  function closePriceEditor() {
    setPriceEditor(undefined);
    window.requestAnimationFrame(() => priceEditorTriggerRef.current?.focus());
  }

  function openHoldingDrawer(
    holding: HoldingReadModel,
    trigger?: HTMLElement,
  ) {
    if (!holding.detail) return;
    holdingDrawerTriggerRef.current = trigger ?? null;
    trigger?.blur();
    setSelectedHoldingId(holding.id);
    setDrawerPeriod(period);
  }

  function closeHoldingDrawer() {
    setSelectedHoldingId(undefined);
    window.requestAnimationFrame(() => holdingDrawerTriggerRef.current?.focus());
  }

  async function saveManualPrice(event: FormEvent) {
    event.preventDefault();
    if (!priceEditor?.holdingKey) return;
    setSavingManualPrice(true);
    setManualPriceError(undefined);
    try {
      const response = await fetch("/api/market-data/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceAccountId: priceEditor.holdingKey.sourceAccountId,
          instrumentId: priceEditor.holdingKey.instrumentId,
          price: manualPrice,
          asOf: manualPriceDate,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Price update failed");
      await loadLocalPortfolio();
      setRefreshMessage(`Saved ${priceEditor.name} price for ${manualPriceDate}`);
      closePriceEditor();
    } catch (error) {
      setManualPriceError(error instanceof Error ? error.message : "Price update failed");
    } finally {
      setSavingManualPrice(false);
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
        points: localHistory?.points ?? [],
      }
    : demoEnabled && !usingReviewedDemo
      ? periodData[period]
      : { ...periodData[period], change: 0, percent: 0, points: [50, 50, 50, 50, 50, 50] };
  const total = isLocal
    ? localPortfolio?.totalValueEur ?? 0
    : holdings.reduce((sum, holding) => sum + holding.eurValue, 0);
  const filtered = source === allAccounts ? holdings : holdings.filter((holding) => holding.source === source);
  const comparableHoldingSparklines = comparableSparklineModels(
    filtered.flatMap((holding) =>
      isLocal && holding.history?.[period]?.available
        ? [{ id: holding.id, points: holding.history[period].points }]
        : []
    ),
  );
  const selectedHolding = isLocal
    ? holdings.find((holding) => holding.id === selectedHoldingId)
    : undefined;
  const selectedPerformance = selectedHolding?.history?.[drawerPeriod];
  const drawerSparkline = selectedHolding && selectedPerformance?.available
    ? comparableSparklineModels([{
        id: selectedHolding.id,
        points: selectedPerformance.points,
      }])[selectedHolding.id]
    : undefined;
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
  const eurCnyOverview = localFxOverview;
  const eurCnyPoints = eurCnyOverview?.history.map((point) => point.rate) ?? [];
  const eurCnyDeclined = eurCnyPoints.length > 1 &&
    eurCnyPoints.at(-1)! < eurCnyPoints[0]!;
  const persistedMarketMessage = latestMarketResult
    ? latestMarketResult.failed > 0
      ? `Last check failed: ${formatRefreshFailures(latestMarketResult.failures)}; previous prices kept`
      : latestMarketResult.updated > 0
        ? `Last check updated ${latestMarketResult.updated} market prices`
        : `${latestMarketResult.unchanged} market prices were already current`
    : "Use Refresh prices to begin";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-hidden={Boolean(selectedHolding || priceEditor)}>
        <div className="brand-mark" aria-hidden="true">IM</div>
        <nav aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><span>◫</span>Overview</a>
          <a className="nav-item" href="#holdings"><span>◎</span>Holdings</a>
          <Link className="nav-item" href="/accounts"><span>⌁</span>Accounts</Link>
          <Link className="nav-item" href="/imports"><span>↥</span>Import</Link>
        </nav>
        <div className="privacy-note"><span className="status-dot" />Local portfolio<br /><small>Confirmed records stay on this device</small></div>
      </aside>

      <main className="main-content" id="overview" aria-hidden={Boolean(selectedHolding || priceEditor)}>
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
                onClick={() => void refreshPrices()}
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
            <div className="period-tabs" role="group" aria-label="Select performance period">
              {(Object.keys(periodData) as Period[]).map((key) => (
                <button key={key} className={period === key ? "selected" : ""} onClick={() => setPeriod(key)} aria-pressed={period === key}>
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
                  {localHistory?.coverage === "partial" && (
                    <small className="partial-range-note">
                      Since tracking began · full {periodData[period].label.toLowerCase()} baseline pending
                    </small>
                  )}
                  {isLocal && period === "today" && (
                    <small className="partial-range-note">
                      Latest available daily move per holding · QDII NAVs may publish later
                    </small>
                  )}
                </div>
              )}
              <span className="market-note">{isLocal ? `ECB rates ${localPortfolio?.fxAsOf}` : usingReviewedDemo ? "Confirmed demo review" : demoEnabled ? "Synthetic valuation" : "EUR base currency"}<br />{isLocal
                ? localPortfolio?.marketData.lastRefreshedAt
                  ? `Prices checked ${localPortfolio.marketData.lastRefreshedAt.slice(0, 16).replace("T", " ")}`
                  : "Prices still use confirmed imports"
                : usingReviewedDemo ? "Stored only in this browser" : demoEnabled ? "Some funds await NAV" : "No demo data mixed in"}</span>
            </div>
            {isLocal && (!localHistory?.available || current.points.length < 2) ? (
              <div className="sparkline-empty">Trend appears after another dated valuation</div>
            ) : (
              <Sparkline points={current.points} negative={current.change < 0} />
            )}
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
          <div className="fx-insight-card">
            <span className="insight-icon blue">¥</span>
            <p>
              <strong>EUR / CNY</strong>
              {eurCnyOverview ? (
                <>
                  <span className="fx-current-rate">€1 = ¥{fxRate.format(eurCnyOverview.currentRate)}</span>
                  <small>ECB · {eurCnyOverview.asOf} · {eurCnyOverview.history.length} saved {eurCnyOverview.history.length === 1 ? "rate" : "rates"}</small>
                </>
              ) : (
                <small>{isLocal ? "CNY reference rate unavailable" : "ECB history appears with local data"}</small>
              )}
            </p>
            {eurCnyOverview && eurCnyPoints.length > 1 ? (
              <Sparkline
                compact
                points={eurCnyPoints}
                negative={eurCnyDeclined}
                label={`EUR to CNY exchange-rate history from ${eurCnyOverview.history[0]?.asOf} to ${eurCnyOverview.asOf}`}
              />
            ) : eurCnyOverview ? (
              <span className="fx-history-empty">History<br />building</span>
            ) : null}
          </div>
        </section>

        {isLocal && localPortfolio?.insights && (
          <PortfolioInsights insights={localPortfolio.insights} />
        )}

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
              <article
                className={`holding-row${isLocal && holding.detail ? " holding-row-interactive" : ""}`}
                key={holding.id}
                onClick={isLocal && holding.detail
                  ? (event) => openHoldingDrawer(
                      holding,
                      event.currentTarget.querySelector<HTMLElement>(".asset-cell") ??
                        event.currentTarget,
                    )
                  : undefined}
              >
                <div
                  className="asset-cell"
                  {...(isLocal && holding.detail
                    ? {
                        role: "button",
                        tabIndex: 0,
                        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openHoldingDrawer(holding, event.currentTarget);
                          }
                        },
                      }
                    : {})}
                ><span className="asset-icon">{holding.category === "Bond" ? "B" : holding.category === "Fund" ? "F" : holding.category === "ETF" ? "E" : holding.category === "Portfolio cash" ? "€" : holding.category === "Stock" ? "S" : "?"}</span><p><strong>{holding.name}</strong><small>{holding.source} · {holding.symbol} · {holding.category}</small></p></div>
                <div className="holding-status"><span className={`freshness ${holding.freshness}`}>{freshnessLabels[holding.freshness]}</span><small className="as-of">{holding.asOf}</small></div>
                <div className="value-cell">
                  <strong>{eur.format(holding.eurValue)}</strong>
                  <small>{holding.originalValue}</small>
                  {holding.totalReturn && (
                    <small className={holding.totalReturn.eurAmount >= 0 ? "total-return positive" : "total-return negative"}>
                      Total {signedEur(holding.totalReturn.eurAmount)}{returnPercent(holding.totalReturn.percent)}
                    </small>
                  )}
                </div>
                <div className="change-cell">
                  {isLocal ? holding.history?.[period]?.available ? (
                    <div className="holding-change">
                      <div className="holding-performance-copy">
                        <Change
                          value={holding.history[period].change}
                          percent={holding.history[period].percent}
                        />
                        <small>Price {signedEur(holding.history[period].priceChange ?? 0)} · FX {signedEur(holding.history[period].fxChange ?? 0)}</small>
                        <small>{holding.history[period].coverage === "partial" ? "Partial range · " : ""}{holding.history[period].baselineAsOf?.slice(0, 10)} → {holding.history[period].currentAsOf?.slice(0, 10)}</small>
                      </div>
                      <Sparkline
                        compact
                        points={holding.history[period].points}
                        negative={holding.history[period].change < 0}
                        label={`${holding.name} ${period} value trend`}
                        comparableModel={comparableHoldingSparklines[holding.id]}
                      />
                    </div>
                  ) : (
                    <span className="pending-change-cell">Awaiting baseline<small>
                      {period === "today" && holding.history?.week.available
                        ? "No recent daily price · select 7 days"
                        : "Record another dated NAV / price"}
                    </small></span>
                  ) : (
                    <Change value={holding.changeEur} percent={holding.changePercent} />
                  )}
                </div>
              </article>
            ))}
            {filtered.length === 0 && (
              <div className="empty-holdings"><strong>No confirmed holdings</strong><small>Add or import assets to populate this table.</small></div>
            )}
          </div>
        </section>
      </main>

      {selectedHolding?.detail && (
        <div className="holding-drawer-backdrop" role="presentation" onMouseDown={closeHoldingDrawer}>
          <aside
            ref={holdingDrawerRef}
            className="holding-drawer"
            role="dialog"
            aria-modal={priceEditor ? undefined : true}
            aria-hidden={Boolean(priceEditor)}
            aria-labelledby="holding-drawer-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="holding-drawer-header">
              <div>
                <p className="eyebrow">HOLDING DETAIL</p>
                <h2 id="holding-drawer-title">{selectedHolding.name}</h2>
                <p>{selectedHolding.source} · {selectedHolding.symbol} · {selectedHolding.category}</p>
              </div>
              <button type="button" className="drawer-close" aria-label="Close holding detail" onClick={closeHoldingDrawer}>×</button>
            </header>

            <section className="drawer-value-card">
              <span>Current value</span>
              <strong>{eur.format(selectedHolding.eurValue)}</strong>
              <small>{selectedHolding.originalValue}</small>
              {selectedHolding.totalReturn && (
                <small className={selectedHolding.totalReturn.eurAmount >= 0 ? "drawer-total-return positive" : "drawer-total-return negative"}>
                  Total return {signedEur(selectedHolding.totalReturn.eurAmount)}{returnPercent(selectedHolding.totalReturn.percent)}
                </small>
              )}
            </section>

            <dl className="holding-facts">
              <div><dt>Quantity</dt><dd>{selectedHolding.detail.quantity}</dd></div>
              <div><dt>Cost Basis</dt><dd>{selectedHolding.detail.costBasis} {selectedHolding.currency}</dd></div>
              <div><dt>Current NAV / price</dt><dd>{selectedHolding.detail.currentPrice} {selectedHolding.currency}</dd></div>
              <div><dt>NAV / price date</dt><dd>{selectedHolding.detail.currentPriceAsOf}</dd></div>
              {selectedHolding.detail.averageCost && (
                <div><dt>Average cost</dt><dd>{selectedHolding.detail.averageCost} {selectedHolding.currency}</dd></div>
              )}
              {selectedHolding.totalReturn && (
                <div>
                  <dt>Calculated total return</dt>
                  <dd className={selectedHolding.totalReturn.originalAmount >= 0 ? "positive" : "negative"}>
                    {formatSignedOriginalMoney(selectedHolding.totalReturn.originalAmount, selectedHolding.currency)}
                    {returnPercent(selectedHolding.totalReturn.percent)}
                  </dd>
                </div>
              )}
              <div><dt>Reported at last holding update</dt><dd>{selectedHolding.detail.reportedPriorReturn} {selectedHolding.currency}</dd></div>
            </dl>

            <section className="drawer-performance">
              <div className="drawer-section-heading">
                <div><p className="eyebrow">MONITORED PERFORMANCE</p><h3>{periodData[drawerPeriod].label}</h3></div>
                <div className="period-tabs drawer-period-tabs" role="group" aria-label="Select holding detail period">
                  {(Object.keys(periodData) as Period[]).map((key) => (
                    <button key={key} className={drawerPeriod === key ? "selected" : ""} type="button" onClick={() => setDrawerPeriod(key)} aria-pressed={drawerPeriod === key}>
                      {periodData[key].label}
                    </button>
                  ))}
                </div>
              </div>
              {selectedPerformance?.available && drawerSparkline ? (
                <>
                  <div className="drawer-change-summary">
                    <Change value={selectedPerformance.change} percent={selectedPerformance.percent} />
                    <small>Price {signedEur(selectedPerformance.priceChange ?? 0)} · FX {signedEur(selectedPerformance.fxChange ?? 0)}</small>
                    <small>{selectedPerformance.coverage === "partial" ? "Partial range · " : ""}{selectedPerformance.baselineAsOf?.slice(0, 10)} → {selectedPerformance.currentAsOf?.slice(0, 10)}</small>
                  </div>
                  <Sparkline
                    detail
                    points={selectedPerformance.points}
                    negative={selectedPerformance.change < 0}
                    comparableModel={drawerSparkline}
                    label={`${selectedHolding.name} ${drawerPeriod} detailed value trend`}
                  />
                </>
              ) : (
                <div className="drawer-awaiting">
                  <strong>Awaiting baseline</strong>
                  <span>
                    {drawerPeriod === "today" && selectedHolding.history?.week.available
                      ? "No recent daily price is available. Select 7 days to use the older baseline."
                      : "Record another dated NAV / price for this period."}
                  </span>
                </div>
              )}
            </section>

            <section className="price-history-section">
              <div className="drawer-section-heading">
                <div><p className="eyebrow">MARKET DATA</p><h3>Saved NAV / price history</h3></div>
                <button type="button" className="drawer-update-price" onClick={(event) => openPriceEditor(selectedHolding, event.currentTarget)}>Update NAV / price</button>
              </div>
              {selectedHolding.detail.priceHistory.length > 0 ? (
                <div className="price-history-list">
                  {selectedHolding.detail.priceHistory.map((observation) => (
                    <div key={`${observation.asOf}:${observation.source}`}>
                      <span><strong>{observation.asOf}</strong><small>{observation.source}</small></span>
                      <strong>{observation.price} {observation.currency}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="drawer-empty-copy">No saved price observations yet.</p>
              )}
            </section>
          </aside>
        </div>
      )}

      {priceEditor && (
        <div className="price-editor-backdrop" role="presentation" onMouseDown={() => !savingManualPrice && closePriceEditor()}>
          <form ref={priceEditorRef} className="price-editor" role="dialog" aria-modal="true" aria-labelledby="price-editor-title" onSubmit={saveManualPrice} onMouseDown={(event) => event.stopPropagation()}>
            <div>
              <p className="eyebrow">MARKET DATA ONLY</p>
              <h2 id="price-editor-title">Update NAV / price</h2>
              <p>{priceEditor.name} · {priceEditor.currency}</p>
            </div>
            <label className="field-label">NAV / price
              <input required autoFocus inputMode="decimal" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="e.g. 12.345" />
            </label>
            <label className="field-label">Price date
              <input required type="date" value={manualPriceDate} max={portfolioCalendarDate()} onChange={(event) => setManualPriceDate(event.target.value)} />
            </label>
            <p className="price-editor-note">This records Market Data only. Quantity and Cost Basis will not change.</p>
            {manualPriceError && <p className="error-message" role="alert">{manualPriceError}</p>}
            <div className="price-editor-actions">
              <button type="button" disabled={savingManualPrice} onClick={closePriceEditor}>Cancel</button>
              <button type="submit" disabled={savingManualPrice}>{savingManualPrice ? "Saving…" : "Save price"}</button>
            </div>
          </form>
        </div>
      )}

      <nav className="mobile-nav" aria-label="Mobile navigation" aria-hidden={Boolean(selectedHolding || priceEditor)}>
        <a className="active" href="#overview"><span>◫</span>Overview</a>
        <a href="#holdings"><span>◎</span>Holdings</a>
        <Link href="/accounts"><span>⌁</span>Accounts</Link>
        <Link href="/imports"><span>↥</span>Import</Link>
      </nav>
    </div>
  );
}
