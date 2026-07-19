"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  createDemoPortfolioRecord,
  demoPortfolioStorageKey,
} from "@/application/demo-portfolio";
import type { SourceAccountView } from "@/application/source-account-status";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";
import {
  sourceAccounts,
  trading212SourceAccountId,
} from "@/domain/source-accounts";

interface ImportDraftView {
  id: string;
  sourceAccountId: string;
  sourceKind: "screenshot" | "trading-212" | "manual" | "demo";
  confidence: string;
  warnings: string[];
  status: "draft" | "confirmed";
  confirmedAt?: string;
  proposedOpeningSnapshot: OpeningSnapshotInput;
}

type AccountOption = Pick<SourceAccountView, "id" | "provider" | "label" | "connector">;

export function ScreenshotImport() {
  const [sourceAccountId, setSourceAccountId] = useState("alipay-main");
  const [accounts, setAccounts] = useState<AccountOption[]>(
    sourceAccounts.map((account) => ({ id: account.id, provider: account.provider, label: account.label })),
  );
  const [file, setFile] = useState<File>();
  const [draft, setDraft] = useState<ImportDraftView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/accounts", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { accounts?: AccountOption[] };
        if (!response.ok || !payload.accounts) return;
        setAccounts(payload.accounts);
        const requested = new URLSearchParams(window.location.search).get("account");
        if (requested && payload.accounts.some((account) => account.id === requested)) {
          setSourceAccountId(requested);
        }
      })
      .catch(() => undefined);
  }, []);

  const selectedAccount = accounts.find((account) => account.id === sourceAccountId);

  async function requestDraft(
    request: () => Promise<Response>,
    fallbackError: string,
    onLoaded?: (loadedDraft: ImportDraftView) => void,
  ) {
    setBusy(true);
    setError("");
    try {
      const response = await request();
      const payload = (await response.json()) as { draft?: ImportDraftView; error?: string };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? fallbackError);
      }
      setDraft(payload.draft);
      onLoaded?.(payload.draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallbackError);
    } finally {
      setBusy(false);
    }
  }

  async function analyze(mode: "image" | "demo") {
    await requestDraft(async () => {
      const form = new FormData();
      form.set("sourceAccountId", sourceAccountId);
      form.set(
        "sourceAccountHint",
        selectedAccount?.label ?? "",
      );
      form.set("mode", mode);
      if (mode === "image") {
        if (!file) throw new Error("Choose a screenshot first.");
        form.set("image", file);
      }

      return fetch("/api/imports/analyze", {
        method: "POST",
        body: form,
      });
    }, "Image analysis failed.");
  }

  async function syncTrading212() {
    const targetAccountId = selectedAccount?.provider === "trading212"
      ? sourceAccountId
      : trading212SourceAccountId;
    await requestDraft(() => fetch("/api/imports/trading212", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceAccountId: targetAccountId }),
      }), "Trading 212 sync failed.", () => {
      setSourceAccountId(targetAccountId);
    });
  }

  async function startManualEntry() {
    await requestDraft(() => fetch("/api/imports/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceAccountId }),
      }), "Manual draft could not be created.");
  }

  function addPosition() {
    setDraft((current) => {
      if (!current || current.status !== "draft") return current;
      const currency = selectedAccount?.provider === "alipay" || selectedAccount?.provider === "wechat"
        ? "CNY"
        : "EUR";
      return {
        ...current,
        proposedOpeningSnapshot: {
          ...current.proposedOpeningSnapshot,
          positions: [
            ...current.proposedOpeningSnapshot.positions,
            {
              instrumentId: "",
              quantity: "1",
              currency,
              costBasis: "",
              reportedPriorReturn: "0",
            },
          ],
        },
      };
    });
  }

  function removePosition(index: number) {
    setDraft((current) => {
      if (!current || current.status !== "draft") return current;
      return {
        ...current,
        proposedOpeningSnapshot: {
          ...current.proposedOpeningSnapshot,
          positions: current.proposedOpeningSnapshot.positions.filter((_, positionIndex) => positionIndex !== index),
        },
      };
    });
  }

  function updatePosition(
    index: number,
    field: "instrumentId" | "quantity" | "currency" | "costBasis" | "reportedPriorReturn",
    value: string,
  ) {
    setDraft((current) => {
      if (!current) return current;
      const positions = current.proposedOpeningSnapshot.positions.map(
        (position, positionIndex) =>
          positionIndex === index ? { ...position, [field]: value } : position,
      );
      return {
        ...current,
        proposedOpeningSnapshot: {
          ...current.proposedOpeningSnapshot,
          positions,
        },
      };
    });
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (draft.proposedOpeningSnapshot.positions.length === 0 && !draft.proposedOpeningSnapshot.portfolioCash) {
      setError("Add at least one holding before confirmation.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/imports/${draft.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confidence: draft.confidence,
          warnings: draft.warnings,
          proposedOpeningSnapshot: draft.proposedOpeningSnapshot,
        }),
      });
      const payload = (await response.json()) as {
        draft?: ImportDraftView;
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Confirmation failed.");
      }
      if (payload.draft.sourceKind === "demo") {
        try {
          window.localStorage.setItem(
            demoPortfolioStorageKey,
            JSON.stringify(createDemoPortfolioRecord({
              confirmedAt: payload.draft.confirmedAt ?? new Date().toISOString(),
              snapshot: payload.draft.proposedOpeningSnapshot,
            })),
          );
        } catch {
          // Confirmation still succeeds when private browsing blocks local storage.
        }
      }
      setDraft(payload.draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Confirmation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="import-page">
      <header className="import-header">
        <div>
          <p className="eyebrow">LOCAL IMPORT WORKFLOW</p>
          <h1>Update assets</h1>
          <p>A screenshot only creates a draft. Your portfolio does not change until you confirm it.</p>
        </div>
        <Link className="secondary-button" href="/">Back to overview</Link>
      </header>

      <div className="import-layout">
        <section className="import-card">
          <div className="step-label"><span>1</span>Select source and screenshot</div>
          <label className="field-label">
            Source account
            <select
              value={sourceAccountId}
              onChange={(event) => {
                setSourceAccountId(event.target.value);
                setDraft(undefined);
              }}
              disabled={busy}
            >
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>{account.label}</option>
              ))}
            </select>
          </label>

          <label className="upload-zone">
            <span className="upload-icon">↥</span>
            <strong>{file ? file.name : "Choose an asset screenshot"}</strong>
            <small>JPEG, PNG or WebP · up to 12 MB</small>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </label>

          <div className="privacy-callout">
            <strong>Before you send</strong>
            <p>When you click “Analyze screenshot”, the image is temporarily sent to the cloud vision service. This app does not save the original image or need any financial-app password.</p>
          </div>

          <div className="import-actions">
            <button
              className="primary-button action-button"
              type="button"
              disabled={busy || !file}
              onClick={() => analyze("image")}
            >
              {busy ? "Analyzing…" : "Analyze screenshot"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => analyze("demo")}
            >
              No API key? Try the demo
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={startManualEntry}
            >
              Enter manually
            </button>
          </div>
          <div className="connector-divider"><span>or</span></div>
          <div className="connector-panel">
            <div>
              <strong>Trading 212 API</strong>
              <small>
                {selectedAccount?.provider === "trading212"
                  ? `${selectedAccount.connector?.environment ?? "demo"} · read-only${selectedAccount.connector?.configured ? " · configured" : " · key missing"}`
                  : "Select a Trading 212 account above to sync it"}
              </small>
            </div>
            <button type="button" disabled={busy || selectedAccount?.provider !== "trading212"} onClick={syncTrading212}>Sync</button>
          </div>
          <Link className="manage-accounts-link" href="/accounts">Manage account names and connection status →</Link>
          {error && <p className="error-message" role="alert">{error}</p>}
        </section>

        <section className="import-card review-card">
          <div className="step-label"><span>2</span>Review and confirm</div>
          {!draft && (
            <div className="empty-review">
              <span>◎</span>
              <strong>Waiting for analysis</strong>
              <p>You can edit names, currencies, cost basis and prior return here.</p>
            </div>
          )}

          {draft?.status === "confirmed" && (
            <div className="confirmed-state">
              <span>✓</span>
              <h2>Import confirmed</h2>
              <p>{draft.sourceKind === "demo"
                ? "Demo review completed. These holdings are saved in your browser's separate demo area and never added to your real portfolio."
                : "Prior return was retained as pre-monitoring history. Current value was not treated as new principal."}</p>
              <Link
                className="primary-button"
                href={draft.sourceKind === "demo" ? "/?demo=1" : "/"}
              >
                {draft.sourceKind === "demo" ? "View demo overview" : "View portfolio overview"}
              </Link>
            </div>
          )}

          {draft?.status === "draft" && (
            <form onSubmit={confirm}>
              <div className="review-meta">
                <span className={`confidence ${draft.confidence}`}>Confidence: {draft.confidence}</span>
                <span>{draft.proposedOpeningSnapshot.asOf.slice(0, 10)}</span>
              </div>
              {draft.warnings.length > 0 && (
                <div className="warning-list">
                  {draft.warnings.map((warning, index) => <p key={`${warning}-${index}`}>◷ {warning}</p>)}
                </div>
              )}
              {draft.proposedOpeningSnapshot.portfolioCash && (
                <div className="cash-review">
                  <span>Portfolio cash</span>
                  <strong>{draft.proposedOpeningSnapshot.portfolioCash.amount} {draft.proposedOpeningSnapshot.portfolioCash.currency}</strong>
                </div>
              )}
              <div className="review-positions">
                {draft.proposedOpeningSnapshot.positions.map((position, index) => (
                  <fieldset key={`${draft.id}-holding-${index}`}>
                    <legend><span>Holding {index + 1}</span><button type="button" onClick={() => removePosition(index)}>Remove</button></legend>
                    <label className="field-label full-field">Name or code
                      <input required value={position.instrumentId} onChange={(event) => updatePosition(index, "instrumentId", event.target.value)} />
                    </label>
                    <div className="field-grid">
                      <label className="field-label">Quantity
                        <input required inputMode="decimal" value={position.quantity} onChange={(event) => updatePosition(index, "quantity", event.target.value)} />
                      </label>
                      <label className="field-label">Currency
                        <input required value={position.currency} onChange={(event) => updatePosition(index, "currency", event.target.value.toUpperCase())} />
                      </label>
                      <label className="field-label">Historical cost basis
                        <input required inputMode="decimal" value={position.costBasis} onChange={(event) => updatePosition(index, "costBasis", event.target.value)} />
                      </label>
                      <label className="field-label">Prior cumulative return
                        <input required inputMode="decimal" value={position.reportedPriorReturn ?? "0"} onChange={(event) => updatePosition(index, "reportedPriorReturn", event.target.value)} />
                      </label>
                    </div>
                    {position.quantity === "1" && <small className="whole-holding-note">When the screenshot does not show units, 1 represents the whole holding—not one actual fund unit.</small>}
                  </fieldset>
                ))}
              </div>
              <button className="add-holding-button" type="button" disabled={busy} onClick={addPosition}>+ Add holding</button>
              <button className="primary-button confirm-button" disabled={busy || (draft.proposedOpeningSnapshot.positions.length === 0 && !draft.proposedOpeningSnapshot.portfolioCash)} type="submit">
                {busy ? "Saving…" : `Confirm ${draft.proposedOpeningSnapshot.positions.length} holdings`}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
