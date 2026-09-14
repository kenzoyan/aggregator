"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

import {
  type SourceAccountMarketDataStatus,
  type SourceAccountsPageReadModel,
  type SourceAccountView,
} from "@/application/source-account-status";
import type {
  SourceAccountAllocationReadModel,
} from "@/application/portfolio-read-model";

type AccountView = SourceAccountView;

const eur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const allocationPalette = ["#2f6ed8", "#102c52", "#0ca77d", "#d9aa61", "#7d64c2"];

const statusLabels: Record<AccountView["status"], string> = {
  current: "Holdings confirmed",
  stale: "Review holdings",
  "not-connected": "No holdings",
};

const marketStatusLabels = {
  current: "Current",
  attention: "Needs attention",
  manual: "Manual values",
} as const;

export function SourceAccountsPanel() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [allocation, setAllocation] = useState<SourceAccountAllocationReadModel[]>([]);
  const [marketDataStatuses, setMarketDataStatuses] = useState<SourceAccountMarketDataStatus[]>([]);
  const [allocationStatus, setAllocationStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [editing, setEditing] = useState<string>();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/accounts", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as Partial<SourceAccountsPageReadModel> & {
          error?: string;
        };
        if (
          !response.ok ||
          !payload.accounts ||
          !payload.accountAllocation ||
          !payload.marketDataStatuses
        ) {
          throw new Error(payload.error ?? "Accounts could not be loaded.");
        }
        setAccounts(payload.accounts);
        setAllocation(payload.accountAllocation);
        setMarketDataStatuses(payload.marketDataStatuses);
        setAllocationStatus("ready");
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Accounts could not be loaded.");
        setAllocationStatus("unavailable");
      });
  }, []);

  const accountLabels = useMemo(() => new Map(
    accounts.map((account) => [account.id, account.label]),
  ), [accounts]);
  const allocationTotal = allocation.reduce((total, account) => total + account.valueEur, 0);
  const marketDataByAccount = useMemo(() => new Map(
    marketDataStatuses.map((status) => [status.sourceAccountId, status]),
  ), [marketDataStatuses]);
  let allocationCursor = 0;
  const allocationGradient = allocation.length > 0
    ? `conic-gradient(${allocation.map((account, index) => {
        const start = allocationCursor;
        allocationCursor += allocationTotal === 0 ? 0 : account.valueEur / allocationTotal * 100;
        return `${allocationPalette[index % allocationPalette.length]} ${start.toFixed(2)}% ${allocationCursor.toFixed(2)}%`;
      }).join(", ")})`
    : undefined;

  function beginRename(account: AccountView) {
    setEditing(account.id);
    setLabel(account.label);
    setError("");
  }

  async function saveRename(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editing, label }),
      });
      const payload = (await response.json()) as { accounts?: AccountView[]; error?: string };
      if (!response.ok || !payload.accounts) throw new Error(payload.error ?? "Account name could not be saved.");
      setAccounts(payload.accounts);
      setEditing(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account name could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="accounts-page">
      <header className="import-header">
        <div>
          <p className="eyebrow">SOURCE ACCOUNTS</p>
          <h1>Accounts and data status</h1>
          <p>Holding snapshots and market prices are tracked separately. Names remain in your local database.</p>
        </div>
      </header>

      {error && <p className="error-message" role="alert">{error}</p>}
      <section className="account-allocation-panel" aria-labelledby="account-allocation-heading">
        <div className="account-allocation-copy">
          <p className="eyebrow">CURRENT ALLOCATION</p>
          <h2 id="account-allocation-heading">Account allocation</h2>
          <strong>{allocationStatus === "loading" ? "Loading…" : eur.format(allocationTotal)}</strong>
          <p>Current valued assets grouped by their source account.</p>
        </div>
        {allocationStatus === "ready" && allocation.length > 0 ? (
          <>
            <div className="donut-wrap account-donut-wrap">
              <div className="donut" style={allocationGradient ? ({ background: allocationGradient } as CSSProperties) : undefined}>
                <span><strong>{allocation.length}</strong>valued accounts</span>
              </div>
            </div>
            <div className="allocation-list account-allocation-list">
              {allocation.map((account, index) => (
                <div key={account.sourceAccountId}>
                  <span><i className="legend" style={{ background: allocationPalette[index % allocationPalette.length] }} />{accountLabels.get(account.sourceAccountId) ?? account.label}</span>
                  <strong>{Math.round(account.sharePercent)}%</strong>
                  <small>{eur.format(account.valueEur)}</small>
                </div>
              ))}
            </div>
          </>
        ) : allocationStatus === "unavailable" ? (
          <p className="account-allocation-empty">Current allocation could not be loaded.</p>
        ) : allocationStatus === "ready" ? (
          <p className="account-allocation-empty">Allocation appears after an account has valued assets.</p>
        ) : null}
      </section>
      <section className="accounts-grid">
        {accounts.map((account) => {
          const marketData = marketDataByAccount.get(account.id);
          return <article className="account-card" key={account.id}>
            <div className="account-card-heading">
              <span className={`account-provider ${account.provider}`}>{account.provider === "trading212" ? "T212" : account.provider.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{account.label}</strong>
                <small>{account.updateMethod}</small>
              </div>
              <span className={`account-status ${account.status}`}>{statusLabels[account.status]}</span>
            </div>
            <dl className="account-metadata">
              <div><dt>Holdings</dt><dd>{account.holdingCount}</dd></div>
              <div><dt>Holding snapshot</dt><dd>{account.dataAsOf ? new Date(account.dataAsOf).toLocaleDateString("en-FI") : "Not confirmed"}</dd></div>
              <div><dt>Market data</dt><dd>{marketData
                ? <><span className={`account-market-status ${marketData.status}`}>{marketStatusLabels[marketData.status]}</span>{marketData.asOf
                  ? ` · ${marketData.status === "attention" ? "Oldest issue " : ""}${new Date(marketData.asOf).toLocaleDateString("en-FI")}`
                  : marketData.status === "attention" ? " · Missing price or FX" : ""}</>
                : "No valued investments"}</dd></div>
              <div><dt>Confirmed on</dt><dd>{account.lastUpdatedAt ? new Date(account.lastUpdatedAt).toLocaleString("en-FI") : "Never"}</dd></div>
              {account.connector && (
                <div><dt>Connector</dt><dd>{account.connector.configured ? `${account.connector.environment} · ${account.connector.access}` : "API key not configured"}</dd></div>
              )}
            </dl>
            {editing === account.id ? (
              <form className="rename-form" onSubmit={saveRename}>
                <input autoFocus maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} aria-label="Account name" />
                <button disabled={busy || !label.trim()} type="submit">Save</button>
                <button disabled={busy} type="button" onClick={() => setEditing(undefined)}>Cancel</button>
              </form>
            ) : (
              <div className="account-actions">
                <button type="button" onClick={() => beginRename(account)}>Rename</button>
                <Link href={`/imports?account=${encodeURIComponent(account.id)}`}>{account.status === "not-connected" ? "Add assets" : "Update"}</Link>
              </div>
            )}
          </article>;
        })}
      </section>
    </main>
  );
}
