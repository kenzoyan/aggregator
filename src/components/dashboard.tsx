"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import {
  demoHoldings,
  periodData,
} from "@/application/demo-dashboard";
import { shouldShowPortfolioValueTrend } from "@/application/portfolio-chart-presentation";
import type {
  FxOverviewReadModel,
  HoldingReadModel,
  Period,
  PortfolioDailyChangeReadModel,
  PortfolioOverviewReadModel,
  PortfolioValuePointReadModel,
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
import { PortfolioAnalyst } from "@/components/portfolio-analyst";
import { PortfolioInsights } from "@/components/portfolio-insights";
import { MarketIntelligence } from "@/components/market-intelligence";
import { PortfolioValueChart } from "@/components/ui/portfolio-value-chart";

const eur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const fxRate = new Intl.NumberFormat("en-FI", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const chartDate = new Intl.DateTimeFormat("en-FI", {
  month: "short",
  day: "numeric",
});

const refreshDateTime = new Intl.DateTimeFormat("en-FI", {
  dateStyle: "medium",
  timeStyle: "short",
});

const freshnessLabels: Record<HoldingReadModel["freshness"], string> = {
  fresh: "Updated",
  manual: "Manual",
  stale: "Stale",
  "awaiting-nav": "Awaiting NAV",
};

const allAccounts = "All accounts";
type ChartMode = "value" | "daily-change";

interface AutomaticRefreshSkip {
  automatic: true;
  skipped: true;
  reason: "already-refreshed-today" | "no-refreshable-positions";
  lastRefreshedAt?: string;
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
  points?: number[];
  negative: boolean;
  compact?: boolean;
  detail?: boolean;
  label?: string;
  comparableModel?: ComparableSparklineModel;
}) {
  const gradientId = `chart-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const chartPoints = points ?? [];
  const geometry = useMemo(() => {
    if (comparableModel) return comparableModel.path;
    const max = Math.max(...chartPoints);
    const min = Math.min(...chartPoints);
    const range = max - min || 1;
    const coordinates = chartPoints.map((point, index) => {
        const x = (index / (chartPoints.length - 1)) * 100;
        const y = 56 - ((point - min) / range) * 44;
        return { x, y };
      });
    return coordinates
      .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
  }, [chartPoints, comparableModel]);
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
      <path d={`${geometry} L100,${fillBottom} L0,${fillBottom} Z`} fill={`url(#${gradientId})`} />
      <path d={geometry} fill="none" stroke={negative ? "#d95763" : "#078d68"} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function formatChartDate(asOf: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? chartDate.format(new Date(`${asOf}T12:00:00Z`))
    : asOf;
}

function DailyChangeBars({
  changes,
  selectedAsOf,
  onSelect,
  label,
}: {
  changes: PortfolioDailyChangeReadModel[];
  selectedAsOf?: string;
  onSelect: (asOf: string) => void;
  label: string;
}) {
  const maximum = Math.max(...changes.map((point) => Math.abs(point.change)), 1);
  const selected = changes.find((point) => point.asOf === selectedAsOf) ?? changes.at(-1);

  return (
    <div className="daily-change-chart" aria-label={label}>
      {selected && (
        <div className="daily-change-selection" aria-live="polite">
          <span>{formatChartDate(selected.asOf)}</span>
          <strong className={selected.change > 0 ? "positive" : selected.change < 0 ? "negative" : "neutral"}>{signedEur(selected.change)}</strong>
        </div>
      )}
      <div className="daily-change-plot" role="group" aria-label="Select a day">
        {changes.map((point) => {
          const height = point.change === 0
            ? 1
            : Math.max(3, Math.abs(point.change) / maximum * 46);
          return (
            <button
              type="button"
              key={point.asOf}
              className={`${point.asOf === selected?.asOf ? "selected " : ""}${point.change > 0 ? "positive" : point.change < 0 ? "negative" : "neutral"}`}
              onClick={() => onSelect(point.asOf)}
              aria-pressed={point.asOf === selected?.asOf}
              aria-label={`${formatChartDate(point.asOf)} ${signedEur(point.change)}`}
            >
              <span className="daily-bar-zone">
                <i style={{ "--bar-height": `${height}%` } as CSSProperties} />
              </span>
              <small>{formatChartDate(point.asOf)}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function scaleDemoValueTrend(total: number, change: number, points: number[]) {
  if (points.length < 2) return [total];
  const first = points[0]!;
  const last = points.at(-1)!;
  const baseline = total - change;
  if (first === last) {
    return points.map((_, index) => baseline + change * index / (points.length - 1));
  }
  return points.map((point) => baseline + (point - first) / (last - first) * change);
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
  const [period, setPeriod] = useState<Period>("week");
  const [chartMode, setChartMode] = useState<ChartMode>("daily-change");
  const [selectedDailyDate, setSelectedDailyDate] = useState<string>();
  const [source, setSource] = useState(allAccounts);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [reviewedDemoHoldings, setReviewedDemoHoldings] = useState<HoldingReadModel[]>();
  const [loading, setLoading] = useState(true);
  const [portfolioLoadError, setPortfolioLoadError] = useState<string>();
  const [localPortfolio, setLocalPortfolio] = useState<PortfolioOverviewReadModel>();
  const [localFxOverview, setLocalFxOverview] = useState<FxOverviewReadModel>();
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string>();
  const [reviewHost, setReviewHost] = useState<HTMLDivElement | null>(null);
  async function loadLocalPortfolio(signal?: AbortSignal) {
    setPortfolioLoadError(undefined);
    try {
      const response = await fetch("/api/portfolio", { signal });
      if (!response.ok) throw new Error("Portfolio could not be loaded");
      const payload = (await response.json()) as {
        hasPortfolioData: boolean;
        portfolio: PortfolioOverviewReadModel;
      };
      setLocalFxOverview(payload.portfolio.fxOverview);
      setLocalPortfolio(payload.hasPortfolioData ? payload.portfolio : undefined);
      return payload.hasPortfolioData;
    } catch (error) {
      if (!signal?.aborted) {
        setPortfolioLoadError(
          error instanceof Error ? error.message : "Portfolio could not be loaded",
        );
      }
      throw error;
    }
  }

  function retryPortfolioLoad() {
    setLoading(true);
    loadLocalPortfolio()
      .catch(() => undefined)
      .finally(() => setLoading(false));
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
  const sources = [allAccounts, ...new Set(holdings.map((holding) => holding.source))];
  const latestMarketResult = localPortfolio?.marketData.latestResult;
  const marketRefreshHistory = localPortfolio?.marketData.refreshHistory ?? [];
  const eurCnyOverview = localFxOverview;
  const demoValuePoints = scaleDemoValueTrend(total, current.change, current.points);
  const demoDailyChanges = current.points.slice(1).map((point, index) => ({
    asOf: `Day ${index + 1}`,
    change: point - current.points[index]!,
  }));
  const dailyChanges = isLocal
    ? localHistory?.dailyChanges ?? []
    : demoEnabled && !usingReviewedDemo
      ? demoDailyChanges
      : [];
  const dailyHistoryAvailable = dailyChanges.length > 0;
  const demoValueTimeline = demoValuePoints.map((value, index) => ({
    asOf: `Day ${index + 1}`,
    valueEur: value,
    investmentChangeEur: index === 0 ? 0 : value - demoValuePoints[index - 1]!,
    portfolioActivityEur: 0,
    holdingActivities: [],
  }));
  const valueHistory = isLocal
    ? localHistory?.valueHistory
    : demoEnabled && !usingReviewedDemo
      ? {
          available: demoValuePoints.length > 1,
          change: current.change,
          percent: current.percent,
          investmentChange: current.change,
          portfolioActivity: 0,
          activityAvailable: true,
          timeline: demoValueTimeline,
        }
      : undefined;
  const showValueTrend = shouldShowPortfolioValueTrend(period, valueHistory?.timeline ?? []);
  const persistedMarketMessage = latestMarketResult
    ? latestMarketResult.failed > 0
      ? `Last check failed: ${formatRefreshFailures(latestMarketResult.failures)}; previous prices kept`
      : latestMarketResult.updated > 0
        ? `Last check updated ${latestMarketResult.updated} market prices`
        : `${latestMarketResult.unchanged} market prices were already current`
    : "Use Refresh prices to begin";

  return (
    <>
      <main className="main-content home-workspace" id="overview">
        <PortfolioAnalyst
          blocked={false}
          reviewHost={reviewHost}
          onPortfolioChanged={() => { void loadLocalPortfolio().catch(() => undefined); }}
        />
        <div className="home-workspace-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">YOUR INVESTMENT OVERVIEW</p>
            <h1>All your investments, together.</h1>
            <p className="page-intro">A clear view of your holdings and performance, measured in euros.</p>
          </div>
          <div className="header-actions">
            <span className="demo-badge">{isLocal ? "Local data" : portfolioLoadError ? "Load failed" : demoEnabled ? "Demo data" : loading ? "Loading" : "No portfolio"}</span>
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
                <RefreshCw aria-hidden="true" className={refreshingPrices ? "is-spinning" : undefined} />
                {refreshingPrices ? "Refreshing…" : "Refresh prices"}
              </button>
            )}
            <Link className="primary-button" href="/imports"><Plus aria-hidden="true" />Update assets</Link>
          </div>
        </header>

        {portfolioLoadError && (
          <section className="portfolio-load-error" role="alert">
            <div>
              <strong>Portfolio data could not be loaded</strong>
              <p>Your local records were not removed. Retry after the local server is ready.</p>
            </div>
            <button type="button" onClick={retryPortfolioLoad} disabled={loading}>
              {loading ? "Retrying…" : "Retry"}
            </button>
          </section>
        )}

        {!loading && !portfolioLoadError && !hasVisiblePortfolio && (
          <section className="empty-portfolio-banner">
            <div>
              <span><Image src="/brand/aggrigator-icon-192.png" alt="" width={48} height={48} /></span>
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

        <div ref={setReviewHost} className="home-review-host" id="agent-review" />

        <section className="hero-grid">
          <article className="balance-card">
            <div className="card-heading">
              <span>Portfolio value</span>
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
            <div className="chart-toolbar">
              <div className="chart-mode-tabs" role="group" aria-label="Select chart metric">
                <button type="button" className={chartMode === "daily-change" ? "selected" : ""} onClick={() => setChartMode("daily-change")} aria-pressed={chartMode === "daily-change"}>Investment change</button>
                <button type="button" className={chartMode === "value" ? "selected" : ""} onClick={() => setChartMode("value")} aria-pressed={chartMode === "value"} disabled={period === "today"}>Total value</button>
              </div>
              <div className="period-tabs" role="group" aria-label="Select chart period">
                {(Object.keys(periodData) as Period[]).map((key) => (
                  <button key={key} className={period === key ? "selected" : ""} onClick={() => { setPeriod(key); if (key === "today") setChartMode("daily-change"); setSelectedDailyDate(undefined); }} aria-pressed={period === key}>
                    {periodData[key].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="period-summary">
              {chartMode === "value" && valueHistory?.available ? (
                <div>
                  <span>{current.label} value movement</span>
                  <strong className={valueHistory.change >= 0 ? "positive" : "negative"}>
                    {valueHistory.change >= 0 ? "+" : "−"}{eur.format(Math.abs(valueHistory.change))}
                  </strong>
                  <small className={valueHistory.percent >= 0 ? "positive" : "negative"}>
                    {valueHistory.percent >= 0 ? "+" : "−"}{Math.abs(valueHistory.percent).toFixed(2)}%
                  </small>
                </div>
              ) : chartMode === "value" ? (
                <div><span>{current.label} value movement</span><strong className="pending-change">Waiting for another valuation</strong><small>Total value history starts with two dated records</small></div>
              ) : !hasVisiblePortfolio ? (
                <div><span>{current.label} change</span><strong className="pending-change">No data yet</strong><small>Import a confirmed snapshot to begin</small></div>
              ) : usingReviewedDemo ? (
                <div><span>{current.label} change</span><strong className="pending-change">Waiting for the next demo snapshot</strong><small>Your confirmed demo holdings are shown below</small></div>
              ) : isLocal && !localHistory?.available ? (
                <div><span>{current.label} change</span><strong className="pending-change">Waiting for another dated NAV</strong><small>Starts after two dated prices are recorded</small></div>
              ) : (
                <div>
                  <span>{current.label} investment change</span>
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
                  {isLocal && localHistory?.available &&
                    localHistory.priceChange !== undefined &&
                    localHistory.fxChange !== undefined && (
                    <div className="investment-breakdown" aria-label="Investment change components">
                      <span>Price <strong className={localHistory.priceChange >= 0 ? "positive" : "negative"}>{signedEur(localHistory.priceChange)}</strong></span>
                      <span>FX <strong className={localHistory.fxChange >= 0 ? "positive" : "negative"}>{signedEur(localHistory.fxChange)}</strong></span>
                    </div>
                  )}
                  <small className="performance-history-note">Investment performance · capital flows excluded</small>
                </div>
              )}
              <span className="market-note">{isLocal ? `ECB rates ${localPortfolio?.fxAsOf}` : usingReviewedDemo ? "Confirmed demo review" : demoEnabled ? "Synthetic valuation" : "EUR base currency"}<br />{isLocal
                ? localPortfolio?.marketData.lastRefreshedAt
                  ? `Prices checked ${localPortfolio.marketData.lastRefreshedAt.slice(0, 16).replace("T", " ")}`
                  : "Prices still use confirmed imports"
                : usingReviewedDemo ? "Stored only in this browser" : demoEnabled ? "Some funds await NAV" : "No demo data mixed in"}</span>
            </div>
            {chartMode === "value" && valueHistory?.available && showValueTrend ? (
              <PortfolioValueChart
                negative={valueHistory.change < 0}
                label={`${periodData[period].label} total portfolio value trend`}
                timeline={valueHistory.timeline}
              />
            ) : chartMode === "value" && period === "today" ? null : chartMode === "value" ? (
              <div className="sparkline-empty">Value trend appears after another dated valuation</div>
            ) : period === "today" ? null : !dailyHistoryAvailable ? (
              <div className="sparkline-empty">Daily changes appear after another dated valuation</div>
            ) : (
              <DailyChangeBars
                changes={dailyChanges}
                selectedAsOf={selectedDailyDate}
                onSelect={setSelectedDailyDate}
                label={`${periodData[period].label} capital-flow-adjusted investment changes`}
              />
            )}
          </article>
        </section>

        <section className="data-status-bar" aria-label="Data status">
          <span><i className="status-indicator current" />{isLocal ? "Local ledger" : usingReviewedDemo ? "Confirmed demo" : demoEnabled ? "Synthetic demo" : "Ledger ready"}</span>
          <span title={isLocal ? refreshMessage ?? persistedMarketMessage : undefined}><i className="status-indicator market" />{isLocal ? refreshMessage ?? persistedMarketMessage : demoEnabled ? "Missing values stay unknown" : "No price history yet"}</span>
          <span><i className="status-indicator fx" />{eurCnyOverview ? `€1 = ¥${fxRate.format(eurCnyOverview.currentRate)} · ECB ${eurCnyOverview.asOf}` : isLocal ? "CNY rate unavailable" : "ECB rates with local data"}</span>
        </section>

        {isLocal && marketRefreshHistory.length > 0 && (
          <details className="refresh-history">
            <summary>
              <span>
                <strong>Refresh history</strong>
                <small>Latest 10 Market Data checks · holdings never change here</small>
              </span>
              <span>{marketRefreshHistory.length} run{marketRefreshHistory.length === 1 ? "" : "s"}</span>
            </summary>
            <div className="refresh-history-list">
              {marketRefreshHistory.map((run, index) => (
                <article key={`${run.completedAt}:${index}`} className="refresh-history-run">
                  <div className="refresh-history-heading">
                    <span>
                      <strong>{run.mode === "manual"
                        ? "Manual"
                        : run.mode === "automatic"
                          ? "Automatic"
                          : "Earlier run"}</strong>
                      <small>{refreshDateTime.format(new Date(run.completedAt))}</small>
                    </span>
                    <span className={run.failed > 0 ? "refresh-run-failed" : "refresh-run-ok"}>
                      {run.failed > 0 ? `${run.failed} issue${run.failed === 1 ? "" : "s"}` : "Completed"}
                    </span>
                  </div>
                  <p className="refresh-run-provider">{run.provider}</p>
                  <div className="refresh-run-counts" aria-label="Refresh result counts">
                    <span><strong>{run.updated}</strong> updated</span>
                    <span><strong>{run.unchanged}</strong> unchanged</span>
                    <span><strong>{run.failed}</strong> failed</span>
                  </div>
                  {run.failures.length > 0 && (
                    <ul className="refresh-run-failures">
                      {run.failures.map((failure, failureIndex) => (
                        <li key={`${failure.instrumentCode}:${failureIndex}`}>
                          <strong>{failure.instrumentCode}</strong>
                          <span>{failure.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </details>
        )}

        {isLocal && localPortfolio?.insights && (
          <PortfolioInsights insights={localPortfolio.insights} />
        )}

        <MarketIntelligence />

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
                className={`holding-row${isLocal ? " holding-row-interactive" : ""}`}
                key={holding.id}
              >
                {isLocal && <Link className="holding-row-overlay" href={`/accounts/${encodeURIComponent(holding.sourceAccountId)}?holding=${encodeURIComponent(holding.id)}`} aria-label={`View ${holding.name} in ${holding.source}`} />}
                <div className="asset-cell"><span className="asset-icon">{holding.category === "Bond" ? "B" : holding.category === "Fund" ? "F" : holding.category === "ETF" ? "E" : holding.category === "Portfolio cash" ? "€" : holding.category === "Stock" ? "S" : "?"}</span><p><strong>{holding.name}</strong><small>{holding.source} · {holding.symbol} · {holding.category}</small></p></div>
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
        </div>
      </main>

    </>
  );
}
