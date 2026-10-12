"use client";

import { motion } from "motion/react";
import { SummaryDialog } from "@/components/ui/summary-dialog";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Info,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { periodLabels } from "@/application/portfolio-period-labels";
import { currentHoldingsPnl } from "@/application/current-holdings-pnl";
import { nextHoldingChangeSort, sortHoldingsByPeriodChange, type HoldingChangeSort } from "@/components/holding-change-sort";
import { shouldShowPortfolioValueTrend } from "@/application/portfolio-chart-presentation";
import type {
  FxOverviewReadModel,
  HoldingReadModel,
  Period,
  PortfolioDailyChangeReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";
import type { MarketRefreshResult } from "@/application/market-refresh";
import { PortfolioAnalyst } from "@/components/portfolio-analyst";
import { PortfolioInsights } from "@/components/portfolio-insights";
import { MarketIntelligence } from "@/components/market-intelligence";
import { PortfolioValueChart } from "@/components/ui/portfolio-value-chart";

import { AnalystWorkspaceDetail } from "@/components/analyst-workspace-detail";
import type { AnalystWorkspaceSelection } from "@/components/analyst-workspace-selection";

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
  const [workspaceSelection, setWorkspaceSelection] = useState<AnalystWorkspaceSelection>();
  const detailOpener = useRef<HTMLElement | null>(null);
  const [questionRequest, setQuestionRequest] = useState<{ id: number; text: string }>();
  const [canFillQuestion, setCanFillQuestion] = useState(false);
  const questionRequestId = useRef(0);
  const [period, setPeriod] = useState<Period>("week");
  const [chartMode, setChartMode] = useState<ChartMode>("daily-change");
  const [selectedDailyDate, setSelectedDailyDate] = useState<string>();
  const [source, setSource] = useState(allAccounts);
  const [holdingChangeSort, setHoldingChangeSort] = useState<HoldingChangeSort>("default");
  const [loading, setLoading] = useState(true);
  const [portfolioLoadError, setPortfolioLoadError] = useState<string>();
  const [localPortfolio, setLocalPortfolio] = useState<PortfolioOverviewReadModel>();
  const [localFxOverview, setLocalFxOverview] = useState<FxOverviewReadModel>();
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string>();
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
    const controller = new AbortController();
    loadLocalPortfolio(controller.signal)
      .then((hasPortfolioData) => hasPortfolioData
        ? refreshPrices("automatic", controller.signal)
        : undefined)
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function refreshPrices(
    mode: "manual" | "automatic" = "manual",
    signal?: AbortSignal,
  ) {
    setRefreshingPrices(true);
    setRefreshMessage(undefined);
    setRefreshFailed(false);
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
      setRefreshFailed(true);
      setRefreshMessage(error instanceof Error ? error.message : "Price refresh failed");
    } finally {
      setRefreshingPrices(false);
    }
  }

  const isLocal = Boolean(localPortfolio);
  const holdings = localPortfolio?.holdings ?? [];
  const localHistory = localPortfolio?.history[period];
  const current = {
    label: periodLabels[period],
    change: localHistory?.change ?? 0,
    percent: localHistory?.percent ?? 0,
  };
  const total = localPortfolio?.totalValueEur ?? 0;
  const holdingsPnl = localPortfolio ? currentHoldingsPnl(localPortfolio) : undefined;
  const filtered = source === allAccounts ? holdings : holdings.filter((holding) => holding.source === source);
  const sortedHoldings = sortHoldingsByPeriodChange(filtered, period, holdingChangeSort);
  const sources = [allAccounts, ...new Set(holdings.map((holding) => holding.source))];
  const latestMarketResult = localPortfolio?.marketData.latestResult;
  const marketRefreshHistory = localPortfolio?.marketData.refreshHistory ?? [];
  const eurCnyOverview = localFxOverview;
  const dailyChanges = localHistory?.dailyChanges ?? [];
  const dailyHistoryAvailable = dailyChanges.length > 0;
  const valueHistory = localHistory?.valueHistory;
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
          questionRequest={questionRequest}
          onQuestionAvailabilityChange={setCanFillQuestion}
          onViewDetail={(selection) => {
            detailOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setWorkspaceSelection(selection);
          }}
          onPortfolioChanged={() => { void loadLocalPortfolio().catch(() => undefined); }}
        />
        <div className="home-workspace-main">
        <div id="agent-import-review-host" />
        {workspaceSelection && <AnalystWorkspaceDetail selection={workspaceSelection}
          onResearch={canFillQuestion ? (text) => setQuestionRequest({ id: ++questionRequestId.current, text }) : undefined}
          onBack={() => {
          setWorkspaceSelection(undefined);
          if (detailOpener.current?.isConnected) detailOpener.current.focus();
        }} />}
        <div className="workspace-overview" hidden={Boolean(workspaceSelection)}>
        <header className="topbar">
          <div>
            <p className="eyebrow">YOUR PORTFOLIO</p>
            <h1>Overview</h1>
          </div>
          <div className="header-actions">
            <span className="portfolio-badge">{isLocal ? "Local data" : portfolioLoadError ? "Load failed" : loading ? "Loading" : "No portfolio"}</span>
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

        {!loading && !portfolioLoadError && !isLocal && (
          <section className="empty-portfolio-banner">
            <div>
              <span><Image src="/brand/aggrigator-icon-192.png" alt="" width={48} height={48} /></span>
              <div>
                <p className="eyebrow">YOUR PORTFOLIO IS EMPTY</p>
                <h2>Start with a screenshot, manual entry or Trading 212</h2>
                <p>Confirmed imports will appear here after review.</p>
              </div>
            </div>
            <div className="empty-portfolio-actions">
              <Link className="primary-button" href="/imports">Add my assets</Link>
            </div>
          </section>
        )}


        <section className="hero-grid">
          <article className="balance-card" aria-busy={loading}>
            <div className="card-heading">
              <span title="Investments and cash in tracked investment accounts. External bank accounts are excluded.">Tracked portfolio value</span>
              <span className="coverage">{loading ? "Loading portfolio…" : isLocal ? `${holdings.length} valued positions` : "No confirmed positions"}</span>
            </div>
            <strong className="total-value">{loading ? "—" : portfolioLoadError ? "Unavailable" : eur.format(total)}</strong>
            <div className="home-balance-meta">
              <div className="home-holdings-pnl">
                <div className="home-holdings-pnl-label">
                  <span>Holdings P&amp;L</span>
                  <details className="home-pnl-info">
                    <summary aria-label="About holdings profit and loss"><Info size={14} aria-hidden="true" /></summary>
                    <p>Current holdings value minus their remaining cost. Excludes cash and realised profit or loss. Converted to EUR at current rates; the percentage is based on covered holdings’ total cost.</p>
                  </details>
                </div>
                <div className="home-holdings-pnl-value">
                  <strong className={holdingsPnl?.pnlEur === undefined ? "" : holdingsPnl.pnlEur >= 0 ? "positive" : "negative"}>
                    {loading ? "—" : portfolioLoadError ? "Unavailable" : holdingsPnl?.pnlEur !== undefined ? signedEur(holdingsPnl.pnlEur) : "—"}
                  </strong>
                  {!loading && !portfolioLoadError && holdingsPnl?.percent !== undefined && <span className={holdingsPnl.percent >= 0 ? "positive" : "negative"}>
                    {holdingsPnl.percent >= 0 ? "+" : "−"}{Math.abs(holdingsPnl.percent).toFixed(2)}%
                  </span>}
                </div>
                {(loading || portfolioLoadError || holdingsPnl?.coverage !== "complete") && <small>{loading ? "Loading…" : portfolioLoadError ? "Could not load holdings" : holdingsPnl?.coverage === "partial"
                  ? `${holdingsPnl.includedHoldingCount}/${holdingsPnl.totalHoldingCount} holdings covered`
                  : holdingsPnl?.coverage === "unavailable" ? "Cost or valuation data unavailable"
                    : !holdingsPnl || holdingsPnl.coverage === "empty" ? "No investment holdings yet"
                      : ""}</small>}
              </div>
              <div className="home-fx-entry">
                <SummaryDialog title="EUR/CNY" summary={<strong>{loading ? "—" : eurCnyOverview ? fxRate.format(eurCnyOverview.currentRate) : "Unavailable"}</strong>}>
                  <h2>Exchange rate</h2>
                  <p className="home-fx-current">{eurCnyOverview ? `€1 = ¥${fxRate.format(eurCnyOverview.currentRate)}` : "CNY rate unavailable"}</p>
                  <p className="subtle">ECB reference rate · {eurCnyOverview?.asOf ?? "No recorded rate yet"}</p>
                  {eurCnyOverview && <table className="home-fx-history"><caption>Recent recorded rates</caption><thead><tr><th>Date</th><th>CNY per EUR</th></tr></thead><tbody>{eurCnyOverview.history.slice(-20).toReversed().map((point) => <tr key={point.asOf}><td>{point.asOf}</td><td>{fxRate.format(point.rate)}</td></tr>)}</tbody></table>}
                </SummaryDialog>
              </div>
            </div>
            <div className="chart-toolbar">
              <div className="chart-mode-tabs" role="group" aria-label="Select chart metric">
                <button type="button" className={chartMode === "daily-change" ? "selected" : ""} onClick={() => setChartMode("daily-change")} aria-pressed={chartMode === "daily-change"}>Investment change{chartMode === "daily-change" && <motion.span className="tab-selection" layoutId="chart-metric" />}</button>
                <button type="button" className={chartMode === "value" ? "selected" : ""} onClick={() => setChartMode("value")} aria-pressed={chartMode === "value"} disabled={period === "today"}>Total value{chartMode === "value" && <motion.span className="tab-selection" layoutId="chart-metric" />}</button>
              </div>
              <div className="period-tabs" role="group" aria-label="Select chart period">
                {(Object.keys(periodLabels) as Period[]).map((key) => (
                  <button key={key} className={period === key ? "selected" : ""} onClick={() => { setPeriod(key); if (key === "today") setChartMode("daily-change"); setSelectedDailyDate(undefined); }} aria-pressed={period === key}>
                    {periodLabels[key]}{period === key && <motion.span className="tab-selection" layoutId="chart-period" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="period-summary">
              {loading ? (
                <div><span>Portfolio performance</span><strong className="pending-change">Loading…</strong></div>
              ) : chartMode === "value" && valueHistory?.available ? (
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
              ) : !isLocal ? (
                <div><span>{current.label} change</span><strong className="pending-change">No data yet</strong><small>Import a confirmed snapshot to begin</small></div>
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
                      Since tracking began · full {periodLabels[period].toLowerCase()} baseline pending
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
              <span className="market-note">{isLocal ? `ECB rates ${localPortfolio?.fxAsOf}` : "EUR base currency"}<br />{isLocal
                ? localPortfolio?.marketData.lastRefreshedAt
                  ? `Prices checked ${localPortfolio.marketData.lastRefreshedAt.slice(0, 16).replace("T", " ")}`
                  : "Prices still use confirmed imports"
                : "No price history yet"}</span>
            </div>
            {chartMode === "value" && valueHistory?.available && showValueTrend ? (
              <PortfolioValueChart
                negative={valueHistory.change < 0}
                label={`${periodLabels[period]} total portfolio value trend`}
                timeline={valueHistory.timeline}
                events={localPortfolio?.chartEvents}
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
                label={`${periodLabels[period]} capital-flow-adjusted investment changes`}
              />
            )}
          </article>
        </section>

        <section className="home-summary-strip" aria-label="Portfolio context">
        <SummaryDialog title="Data & refresh" summary={<><strong>{loading ? "Loading…" : portfolioLoadError ? "Unavailable" : !isLocal ? "No portfolio" : refreshFailed ? "Refresh failed" : (latestMarketResult?.failed ?? 0) > 0 ? `${latestMarketResult!.failed} refresh issues` : "Local records"}</strong><small>{localPortfolio?.marketData.lastRefreshedAt ? `Checked ${refreshDateTime.format(new Date(localPortfolio.marketData.lastRefreshedAt))}` : "View data status and refresh history"}</small></>}>
          <h2>Data &amp; refresh</h2>
          {portfolioLoadError && <p className="market-intelligence-error" role="alert">{portfolioLoadError}</p>}
        <section className="data-status-bar" aria-label="Data status">
          <span><i className="status-indicator current" />{isLocal ? "Local ledger" : "Ledger ready"}</span>
          <span title={isLocal ? refreshMessage ?? persistedMarketMessage : undefined}><i className="status-indicator market" />{isLocal ? refreshMessage ?? persistedMarketMessage : "No price history yet"}</span>
        </section>

        {isLocal && marketRefreshHistory.length > 0 && (
          <section className="refresh-history">
            <header className="home-refresh-heading">
              <span>
                <strong>Refresh history</strong>
                <small>Latest 10 Market Data checks · holdings never change here</small>
              </span>
              <span>{marketRefreshHistory.length} run{marketRefreshHistory.length === 1 ? "" : "s"}</span>
            </header>
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
          </section>
        )}

        {marketRefreshHistory.length === 0 && <p className="subtle">No recorded market data checks yet.</p>}
        </SummaryDialog>
        {isLocal && localPortfolio?.insights && (
          <PortfolioInsights insights={localPortfolio.insights} />
        )}

        <MarketIntelligence />
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
            <div className="holding-row holding-header"><span>Asset</span><span>Status</span><span>Current value</span><button
              type="button"
              className="holding-change-sort"
              title="Sort by absolute period change in EUR"
              aria-label={`Absolute period change in EUR: ${holdingChangeSort === "default" ? "default order; sort largest movement first" : holdingChangeSort === "descending" ? "largest movement first; sort smallest movement first" : "smallest movement first; restore default order"}`}
              onClick={() => setHoldingChangeSort(nextHoldingChangeSort)}
            >Period change {holdingChangeSort === "default" ? <ArrowUpDown size={14} aria-hidden="true" /> : holdingChangeSort === "descending" ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}</button></div>
            {sortedHoldings.map((holding) => (
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
                  {holding.history?.[period]?.available ? (
                    <div className="holding-change">
                      <div className="holding-performance-copy">
                        <Change
                          value={holding.history[period].change}
                          percent={holding.history[period].percent}
                        />
                        {holding.history[period].coverage === "partial" && <small>Partial range</small>}
                      </div>
                    </div>
                  ) : (
                    <span className="pending-change-cell">Awaiting baseline<small>
                      {period === "today" && holding.history?.week.available
                        ? "No recent daily price · select 7 days"
                        : "Record another dated NAV / price"}
                    </small></span>
                  )}
                </div>
              </article>
            ))}
            {filtered.length === 0 && (
              <div className="empty-holdings"><strong>{loading ? "Loading holdings…" : "No confirmed holdings"}</strong><small>{loading ? "Reading your local portfolio" : "Add or import assets to populate this table."}</small></div>
            )}
          </div>
        </section>
        </div>
        </div>
      </main>

    </>
  );
}
