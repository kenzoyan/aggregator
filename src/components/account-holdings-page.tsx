"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { formatPortfolioSaleMoney, formatPortfolioSaleQuantity } from "@/application/portfolio-sale-presentation";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import type { PriceSourceBinding, PriceSourceCandidate } from "@/application/price-source-discovery";
import type { HoldingPriceHistoryReadModel, Period, PortfolioOverviewReadModel } from "@/application/portfolio-read-model";
import type { SourceAccountsPageReadModel } from "@/application/source-account-status";
import { accountDetailBackLink, accountDetailHref, holdingDetailTabs, holdingTabForKey, type HoldingDetailTab } from "@/components/holding-detail-navigation";
import { selectAccountHolding } from "@/components/account-holding-selection";
import { HoldingPerformanceChart } from "@/components/holding-performance-chart";
import { PortfolioCashActivity } from "@/components/portfolio-cash-activity";
import type { CashActivityReadModel } from "@/application/portfolio-cash-activity";
import { PortfolioSaleForm } from "@/components/portfolio-sale-form";

const eur = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR" });
const periods: Record<Period, string> = { today: "Today", week: "7 days", month: "30 days" };
type QuotedPriceSourceCandidate = PriceSourceCandidate & {
  quoteAvailable: boolean;
  price?: string;
  priceAsOf?: string;
};
type PriceSourceLookup = {
  binding: PriceSourceBinding | null;
  candidates: QuotedPriceSourceCandidate[];
};

function signedEur(value: number) {
  return `${value >= 0 ? "+" : "−"}${eur.format(Math.abs(value))}`;
}

function returnPercent(percent?: number) {
  return percent === undefined ? "" : ` · ${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(2)}%`;
}

function HoldingMarketData({ history, sourceInfo, action }: {
  history: readonly HoldingPriceHistoryReadModel[];
  sourceInfo: ReactNode;
  action?: ReactNode;
}) {
  const [visibleCount, setVisibleCount] = useState(5);
  const remaining = Math.max(0, history.length - visibleCount);

  return <section className="price-history-section holding-market-data">
    <div className="drawer-section-heading"><div><p className="eyebrow">DATA SOURCE</p><h3>Saved NAV / price history</h3></div>{action}</div>
    {sourceInfo}
    {history.length === 0 ? <p className="drawer-empty-copy">No saved price observations yet.</p> : <>
      <div className="price-history-list">
        {history.slice(0, visibleCount).map((observation) => <div key={`${observation.asOf}:${observation.source}`}>
          <span><strong>{observation.asOf}</strong><small>{observation.source}</small></span>
          <strong>{observation.price} {observation.currency}</strong>
        </div>)}
      </div>
      {remaining > 0 && <button
        className="price-history-more"
        type="button"
        onClick={() => setVisibleCount((count) => count + 5)}
      >Show {Math.min(5, remaining)} more</button>}
    </>}
  </section>;
}

export function AccountHoldingsPage({ accountId, requestedHoldingId, navigationOrigin }: {
  accountId: string;
  requestedHoldingId?: string;
  navigationOrigin?: string | string[];
}) {
  const backLink = accountDetailBackLink(navigationOrigin);
  const [accountsPage, setAccountsPage] = useState<SourceAccountsPageReadModel>();
  const [activity, setActivity] = useState<CashActivityReadModel>();
  const [portfolio, setPortfolio] = useState<PortfolioOverviewReadModel>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [activeHoldingId, setActiveHoldingId] = useState(requestedHoldingId);
  const [editingPrice, setEditingPrice] = useState(false);
  const [editingSale, setEditingSale] = useState(false);
  const [detailTab, setDetailTab] = useState<HoldingDetailTab>("overview");
  const router = useRouter();
  const [price, setPrice] = useState("");
  const [priceDate, setPriceDate] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceError, setPriceError] = useState("");
  const [priceSourceLookup, setPriceSourceLookup] = useState<PriceSourceLookup>();
  const [priceSourceLoading, setPriceSourceLoading] = useState(false);
  const [priceSourceSaving, setPriceSourceSaving] = useState(false);
  const [priceSourceRefreshing, setPriceSourceRefreshing] = useState(false);
  const [priceSourceError, setPriceSourceError] = useState("");
  const activePriceSourceHolding = useRef("");

  async function loadData(signal?: AbortSignal) {
    const portfolioResponse = await fetch("/api/portfolio", { cache: "no-store", signal });
    if (!portfolioResponse.ok) throw new Error("Account holdings could not be loaded.");
    const accountsResponse = await fetch("/api/accounts", { cache: "no-store", signal });
    if (!accountsResponse.ok || !portfolioResponse.ok) throw new Error("Account holdings could not be loaded.");
    const accounts = await accountsResponse.json() as SourceAccountsPageReadModel;
    const result = await portfolioResponse.json() as { portfolio: PortfolioOverviewReadModel };
    if (!accounts.accounts || !accounts.holdings || !result.portfolio?.holdings) {
      throw new Error("Account holdings could not be loaded.");
    }
    const activityResponse = await fetch(`/api/portfolio/sales?sourceAccountId=${encodeURIComponent(accountId)}`, { cache: "no-store", signal });
    if (!activityResponse.ok) throw new Error("Account activity could not be loaded.");
    setActivity(await activityResponse.json());
    setAccountsPage(accounts);
    setPortfolio(result.portfolio);
  }

  useEffect(() => {
    setActiveHoldingId(requestedHoldingId);
  }, [requestedHoldingId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    loadData(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Account holdings could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountId]);

  function retryLoad() {
    setLoading(true);
    setLoadError("");
    loadData()
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Account holdings could not be loaded."))
      .finally(() => setLoading(false));
  }

  const account = accountsPage?.accounts.find((item) => item.id === accountId);
  const holdings = accountsPage?.holdings.filter((item) => item.sourceAccountId === accountId) ?? [];
  const selected = selectAccountHolding(holdings, accountId, activeHoldingId);
  const detailed = portfolio?.holdings.find((item) => item.id === selected?.id && item.sourceAccountId === accountId);
  const performance = detailed?.history?.[period];
  const accountValue = holdings.reduce((total, item) => total + (item.eurValue ?? 0), 0);
  const priceSourceEligible = Boolean(
    selected?.instrumentId && selected.category === "Fund" &&
    ((selected.currency === "CNY" && !/^\d{6}$/.test(selected.symbol)) ||
      (selected.currency === "EUR" && /^[A-Z]{2}[A-Z0-9]{10}$/.test(selected.symbol))),
  );

  useEffect(() => {
    activePriceSourceHolding.current = `${accountId}:${selected?.instrumentId ?? ""}`;
  }, [accountId, selected?.instrumentId]);

  useEffect(() => {
    setPriceSourceLookup(undefined);
    setPriceSourceError("");
    if (!priceSourceEligible || !selected?.instrumentId) return;
    const controller = new AbortController();
    setPriceSourceLoading(true);
    const params = new URLSearchParams({ sourceAccountId: accountId, instrumentId: selected.instrumentId });
    fetch(`/api/market-data/price-source?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Price sources could not be checked.");
        return response.json() as Promise<PriceSourceLookup>;
      })
      .then((result) => { if (!controller.signal.aborted) setPriceSourceLookup(result); })
      .catch(() => { if (!controller.signal.aborted) setPriceSourceError("Price sources could not be checked."); })
      .finally(() => { if (!controller.signal.aborted) setPriceSourceLoading(false); });
    return () => controller.abort();
  }, [accountId, selected?.instrumentId, priceSourceEligible]);

  async function confirmPriceSource(candidate: QuotedPriceSourceCandidate) {
    if (!selected?.instrumentId || !candidate.quoteAvailable) return;
    const holdingKey = `${accountId}:${selected.instrumentId}`;
    setPriceSourceSaving(true);
    setPriceSourceError("");
    try {
      const response = await fetch("/api/market-data/price-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceAccountId: accountId,
          instrumentId: selected.instrumentId,
          candidateId: candidate.id,
        }),
      });
      const payload = await response.json() as { binding?: PriceSourceBinding; error?: string };
      if (!response.ok || !payload.binding) throw new Error(payload.error ?? "Price source could not be saved.");
      if (activePriceSourceHolding.current === holdingKey) {
        setPriceSourceLookup({ binding: payload.binding, candidates: [] });
      }
    } catch (error) {
      if (activePriceSourceHolding.current === holdingKey) {
        setPriceSourceError(error instanceof Error ? error.message : "Price source could not be saved.");
      }
    } finally {
      setPriceSourceSaving(false);
    }
  }

  async function refreshConfirmedPriceSource() {
    if (!selected?.instrumentId || !priceSourceLookup?.binding) return;
    const holdingKey = `${accountId}:${selected.instrumentId}`;
    setPriceSourceRefreshing(true);
    setPriceSourceError("");
    try {
      const response = await fetch("/api/market-data/refresh", { method: "POST" });
      if (!response.ok) throw new Error("Market prices could not be refreshed.");
      const params = new URLSearchParams({ sourceAccountId: accountId, instrumentId: selected.instrumentId });
      const lookup = await fetch(`/api/market-data/price-source?${params}`, { cache: "no-store" });
      if (!lookup.ok) throw new Error("The price source status could not be loaded.");
      const result = await lookup.json() as PriceSourceLookup;
      if (activePriceSourceHolding.current === holdingKey) {
        setPriceSourceLookup(result);
        await loadData();
      }
    } catch (error) {
      if (activePriceSourceHolding.current === holdingKey) {
        setPriceSourceError(error instanceof Error ? error.message : "Market prices could not be refreshed.");
      }
    } finally {
      setPriceSourceRefreshing(false);
    }
  }

  async function savePrice(event: FormEvent) {
    event.preventDefault();
    if (!selected?.instrumentId) return;
    setSavingPrice(true);
    setPriceError("");
    try {
      const response = await fetch("/api/market-data/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceAccountId: accountId,
          instrumentId: selected.instrumentId,
          price,
          asOf: priceDate,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Price update failed.");
      await loadData();
      setEditingPrice(false);
      setPrice("");
    } catch (error) {
      setPriceError(error instanceof Error ? error.message : "Price update failed.");
    } finally {
      setSavingPrice(false);
    }
  }

  return <main className="account-detail-page">
    <div className="account-detail-topline">
      <Link href={backLink.href}>{backLink.label}</Link>
      {account && <Link className="account-detail-update" href={`/imports?account=${encodeURIComponent(accountId)}`}>Update this account</Link>}
    </div>
    {loading ? <p className="account-detail-message" role="status">Loading account holdings…</p>
      : loadError ? <div className="account-detail-message" role="alert"><p className="error-message">{loadError}</p><button type="button" onClick={retryLoad}>Retry</button></div>
      : !account ? <p className="account-detail-message">Account not found.</p>
      : <>
        <header className="account-detail-header">
          <div>
            <p className="eyebrow">SOURCE ACCOUNT</p>
            <h1>{account.label}</h1>
            <p>{account.accountType} · {account.updateMethod} · {holdings.length} {holdings.length === 1 ? "holding" : "holdings"}</p>
          </div>
          <div className="account-detail-total"><span>Valued holdings</span><strong>{eur.format(accountValue)}</strong><small>{account.dataAsOf ? `Holding snapshot ${new Date(account.dataAsOf).toLocaleDateString("en-FI")}` : "No confirmed snapshot"}</small></div>
        </header>
        {holdings.length === 0 ? <section className="account-detail-empty">
          <h2>No confirmed holdings yet</h2>
          <p>Add assets to start monitoring this account.</p>
          <Link href={`/imports?account=${encodeURIComponent(accountId)}`}>Add assets</Link>
        </section> : <div className="account-detail-columns">
          {selected && <article className="account-holding-detail" aria-labelledby="account-holding-title">
            <div className="account-holding-detail-header">
              <div className="holding-picker">
                <h2 id="account-holding-title" className="holding-accessible-title">Holding detail · {selected.name}</h2>
                <label htmlFor="account-holding-select">Holding</label>
                <select id="account-holding-select" value={selected.id} onChange={(event) => {
                  const id = event.target.value;
                  setActiveHoldingId(id); setDetailTab("overview"); setEditingPrice(false); setEditingSale(false); setPeriod("week");
                  router.replace(accountDetailHref(accountId, id, navigationOrigin), { scroll: false });
                }}>
                  {holdings.map((holding) => <option key={holding.id} value={holding.id}>{holding.name}</option>)}
                </select>
                <p>{selected.symbol} · {selected.category} · {selected.currency}</p>
              </div>
              {selected.instrumentId && <div className="account-holding-detail-actions">
                <button type="button" onClick={() => { setEditingSale(true); setEditingPrice(false); }}>Record sale</button>
              </div>}
            </div>
            <dl className="holding-summary">
              <div><dt>Current value</dt><dd>{selected.eurValue === undefined ? "Unavailable" : eur.format(selected.eurValue)}</dd>{selected.originalValue && <small>{selected.originalValue}</small>}</div>
              {selected.instrumentId && <div><dt>Total return</dt><dd className={detailed?.totalReturn && detailed.totalReturn.eurAmount < 0 ? "negative" : "positive"}>{detailed?.totalReturn ? signedEur(detailed.totalReturn.eurAmount) : "—"}</dd><small>{detailed?.totalReturn ? returnPercent(detailed.totalReturn.percent).replace(" · ", "") : "Unavailable"}</small></div>}
              <div><dt>{selected.category === "Portfolio cash" ? "Balance" : "Quantity"}</dt><dd title={selected.quantity}>{selected.category === "Portfolio cash" ? formatPortfolioSaleMoney(selected.quantity, selected.currency) : formatPortfolioSaleQuantity(selected.quantity, 8)}</dd></div>
              {selected.instrumentId && <div><dt>Cost basis</dt><dd>{detailed?.detail ? formatPortfolioSaleMoney(detailed.detail.costBasis, selected.currency) : "—"}</dd></div>}
            </dl>
            {selected.missing && <p className="account-valuation-note" role="status">{selected.missing === "price" ? "A current price is needed to calculate this holding's value." : "An FX rate is needed to calculate its EUR value."}</p>}
            {editingPrice && selected.instrumentId && <form className="account-price-form" onSubmit={savePrice}>
              <h3>Update NAV / price</h3>
              <p>This records market data only. Quantity and cost basis stay unchanged.</p>
              <label>NAV / price <input required inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 12.345" /></label>
              <label>Price date <input required type="date" max={portfolioCalendarDate()} value={priceDate} onChange={(event) => setPriceDate(event.target.value)} /></label>
              {priceError && <p className="error-message" role="alert">{priceError}</p>}
              <div><button type="button" disabled={savingPrice} onClick={() => setEditingPrice(false)}>Cancel</button><button type="submit" disabled={savingPrice}>{savingPrice ? "Saving…" : "Save price"}</button></div>
            </form>}
            {editingSale && selected.instrumentId && <PortfolioSaleForm
              key={`sale:${selected.id}`}
              sourceAccountId={accountId}
              instrumentId={selected.instrumentId}
              destinations={activity?.destinations}
              accountName={account.label}
              isFund={selected.category === "Fund"}
              prices={detailed?.detail?.priceHistory}
              unitLabel={selected.category === "Stock" || selected.category === "ETF" ? "shares" : "units"}
              holdingName={selected.name}
              currency={selected.currency}
              onSaved={async () => { await loadData(); setEditingSale(false); }}
              onCancel={() => setEditingSale(false)}
            />}
            <div className="holding-tabs" role="tablist" aria-label="Holding details">
              {holdingDetailTabs.map((tab) => <button key={tab} type="button" role="tab" id={`holding-tab-${tab}`} aria-controls={`holding-panel-${tab}`} aria-selected={detailTab === tab} tabIndex={detailTab === tab ? 0 : -1} onClick={() => setDetailTab(tab)} onKeyDown={(event) => {
                const next = holdingTabForKey(tab, event.key);
                if (next) { event.preventDefault(); setDetailTab(next); document.getElementById(`holding-tab-${next}`)?.focus(); }
              }}>{tab === "overview" ? "Overview" : "Data Source"}</button>)}
            </div>
            <div className="holding-tab-panel" role="tabpanel" id="holding-panel-overview" aria-labelledby="holding-tab-overview" hidden={detailTab !== "overview"} tabIndex={0}>
            {detailed?.history && <section className="drawer-performance">
              <div className="drawer-section-heading"><div><p className="eyebrow">MONITORED PERFORMANCE</p><h3>{periods[period]}</h3></div><div className="period-tabs drawer-period-tabs" role="group" aria-label="Select holding period">
                {(Object.keys(periods) as Period[]).map((key) => <button key={key} type="button" className={period === key ? "selected" : ""} aria-pressed={period === key} onClick={() => setPeriod(key)}>{periods[key]}</button>)}
              </div>
              </div>
              {performance?.available ? <div className="account-performance-content">
                <strong>{signedEur(performance.change)} · {performance.percent >= 0 ? "+" : "−"}{Math.abs(performance.percent).toFixed(2)}%</strong>
                <small>Price {signedEur(performance.priceChange ?? 0)} · FX {signedEur(performance.fxChange ?? 0)}</small>
                <small>{performance.baselineAsOf?.slice(0, 10)} → {performance.currentAsOf?.slice(0, 10)}</small>
                {performance.holdingPoints && <HoldingPerformanceChart points={performance.holdingPoints} currency={selected.currency} cash={selected.category === "Portfolio cash"} label={`${selected.name} ${periods[period]} value trend`} />}
              </div> : <p className="drawer-empty-copy">No comparable baseline for this period.</p>}
            </section>}
            {detailed?.detail && <dl className="holding-secondary-facts">
              <div><dt>NAV / price</dt><dd>{detailed.detail.currentPrice} {selected.currency} · {detailed.detail.currentPriceAsOf}</dd></div>
              {detailed.detail.averageCost && <div><dt>Average cost</dt><dd>{detailed.detail.averageCost} {selected.currency}</dd></div>}
            </dl>}
            {!detailed?.history && <p className="drawer-empty-copy">No performance history available yet.</p>}
            {activity && <PortfolioCashActivity key={`history:${selected.id}`} sourceAccountId={accountId} activity={activity} instrumentId={selected.instrumentId} cashCurrency={selected.currency} onSaved={loadData} />}
            {!activity && <p className="drawer-empty-copy">No activity recorded yet.</p>}
            </div>
            <div className="holding-tab-panel" role="tabpanel" id="holding-panel-market" aria-labelledby="holding-tab-market" hidden={detailTab !== "market"} tabIndex={0}>
            {selected.instrumentId && <button className="holding-manual-price" type="button" onClick={() => { setEditingPrice(true); setEditingSale(false); setPriceDate(portfolioCalendarDate()); setPriceError(""); }}>Update NAV / price manually</button>}
            {selected.instrumentId && <HoldingMarketData
              key={`market-data:${selected.id}`}
              history={detailed?.detail?.priceHistory ?? []}
              action={priceSourceEligible && priceSourceLookup?.binding ? <button className="market-data-refresh" type="button" disabled={priceSourceRefreshing} onClick={refreshConfirmedPriceSource}>
                {priceSourceRefreshing ? "Checking…" : "Check NAV now"}
              </button> : undefined}
              sourceInfo={
                <div className="market-data-source" aria-label="Price source">
                {!priceSourceLookup?.binding && detailed?.detail && <p>Source: {detailed.detail.currentPriceSource}</p>}
                {priceSourceLoading && <p role="status">Checking verified sources…</p>}
                {priceSourceError && <p className="error-message" role="alert">{priceSourceError}</p>}
                {priceSourceLookup?.binding && <div className="price-source-confirmed">
                  <p>Source: {priceSourceLookup.binding.provider} · {priceSourceLookup.binding.instrumentCode} · {priceSourceLookup.binding.shareClass} share class.</p>
                  {priceSourceLookup.binding.provider === "nordea-funds" && <p>This source reads the latest dated NAV only. Checks accumulate records; missed dates cannot be backfilled.</p>}
                  <p role="status">{priceSourceLookup.binding.lastRefresh
                    ? `Last checked ${new Date(priceSourceLookup.binding.lastRefresh.checkedAt).toLocaleString("en-GB", { timeZone: "Europe/Helsinki" })} · ${priceSourceLookup.binding.lastRefresh.outcome}${priceSourceLookup.binding.lastRefresh.failureCategory ? ` (${priceSourceLookup.binding.lastRefresh.failureCategory})` : ""}`
                    : "Awaiting the first price check."}</p>
                  {priceSourceLookup.binding.lastRefresh?.latestPriceAsOf && <p>Latest saved NAV date: {priceSourceLookup.binding.lastRefresh.latestPriceAsOf}</p>}
                </div>}
                {priceSourceEligible && Boolean(priceSourceLookup?.candidates.length) && <details className="market-data-source-options" open={!priceSourceLookup?.binding}>
                  <summary>{priceSourceLookup?.binding ? "Change price source" : "Set up automatic NAV updates"}</summary>
                {priceSourceLookup?.candidates.map((candidate) => <div className="price-source-candidate" key={candidate.id}>
                  <strong>{candidate.name}</strong>
                  <p>Source: {candidate.provider} · Code: {candidate.instrumentCode} · Currency: {candidate.currency} · Share class: {candidate.shareClass}</p>
                  <p>{candidate.quoteAvailable
                    ? `Recent NAV: ${candidate.price} ${candidate.currency} · ${candidate.priceAsOf}`
                    : "A recent NAV is unavailable. Confirmation is paused."}</p>
                  <a href={candidate.identityUrl} target="_blank" rel="noreferrer">View source page</a>
                  {candidate.coverage === "latest-only" && <p>Latest dated NAV only. Historical NAVs and missed dates cannot be backfilled.</p>}
                  <button type="button" disabled={!candidate.quoteAvailable || priceSourceSaving}
                    onClick={() => confirmPriceSource(candidate)}>
                    {priceSourceSaving ? "Confirming…" : "Confirm this price source"}
                  </button>
                </div>)}
                </details>}
                {priceSourceEligible && priceSourceLookup && !priceSourceLookup.binding && priceSourceLookup.candidates.length === 0 &&
                  <p>No verified price source candidate is available for this holding yet.</p>}
                </div>
              }
            />}
            {!selected.instrumentId && <p className="drawer-empty-copy">Cash balances do not have NAV or price data.</p>}
            </div>
          </article>}
        </div>}
      </>}
  </main>;
}
