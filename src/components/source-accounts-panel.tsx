"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import type { SourceAccountView } from "@/application/source-account-status";

type AccountView = SourceAccountView;

const statusLabels: Record<AccountView["status"], string> = {
  current: "Current",
  stale: "Needs update",
  "not-connected": "Not connected",
};

export function SourceAccountsPanel() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [editing, setEditing] = useState<string>();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/accounts", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { accounts?: AccountView[]; error?: string };
        if (!response.ok || !payload.accounts) throw new Error(payload.error ?? "Accounts could not be loaded.");
        setAccounts(payload.accounts);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Accounts could not be loaded."));
  }, []);

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
          <h1>Connections and update status</h1>
          <p>Names are stored only in your local database. API credentials remain in ignored environment configuration.</p>
        </div>
        <Link className="secondary-button" href="/">Back to overview</Link>
      </header>

      {error && <p className="error-message" role="alert">{error}</p>}
      <section className="accounts-grid">
        {accounts.map((account) => (
          <article className="account-card" key={account.id}>
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
              <div><dt>Last confirmed update</dt><dd>{account.lastUpdatedAt ? new Date(account.lastUpdatedAt).toLocaleString("en-FI") : "Never"}</dd></div>
              {account.dataAsOf && <div><dt>Data as of</dt><dd>{new Date(account.dataAsOf).toLocaleString("en-FI")}</dd></div>}
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
          </article>
        ))}
      </section>
    </main>
  );
}
