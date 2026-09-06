"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  createDemoPortfolioRecord,
  demoPortfolioStorageKey,
} from "@/application/demo-portfolio";
import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import type { SourceAccountView } from "@/application/source-account-status";
import {
  assetTypeLabels,
  assetTypes,
  type AssetType,
} from "@/domain/portfolio/types";
import {
  sourceAccounts,
  trading212SourceAccountId,
} from "@/domain/source-accounts";
import type {
  HoldingStateComparison,
  ImportReconciliation,
} from "@/domain/imports";

type ImportDraftView = ImportDraftReadModel;

type AccountOption = Pick<
  SourceAccountView,
  "id" | "provider" | "label" | "updateMethod" | "connector"
>;

function recountReconciliation(
  reconciliation: ImportReconciliation,
): ImportReconciliation {
  const changeKinds = new Set(["holding-changed", "new", "possibly-removed"]);
  return {
    ...reconciliation,
    changeCount: reconciliation.holdings.filter(
      (item) => changeKinds.has(item.kind),
    ).length + (reconciliation.cash && reconciliation.cash.kind !== "unchanged" ? 1 : 0),
    unchangedCount: reconciliation.holdings.filter(
      (item) => item.kind === "unchanged",
    ).length,
    marketDataUpdatedCount: reconciliation.holdings.filter(
      (item) => item.kind === "market-data-updated",
    ).length,
  };
}

function reviewChangeLabel(reconciliation: ImportReconciliation): string {
  const holdingChanges = reconciliation.holdings.filter((item) =>
    item.kind === "holding-changed" ||
    item.kind === "new" ||
    item.kind === "possibly-removed"
  ).length;
  const cashChanged = Boolean(
    reconciliation.cash && reconciliation.cash.kind !== "unchanged",
  );
  if (holdingChanges === 0 && cashChanged) return "cash";
  const holdings = `${holdingChanges} holding${holdingChanges === 1 ? "" : "s"}`;
  return cashChanged ? `${holdings} + cash` : holdings;
}

function comparisonFromEditableHolding(
  holding: ImportDraftView["portfolio"]["holdings"][number],
): HoldingStateComparison {
  return {
    instrumentId: holding.instrumentId,
    ...(holding.displayName ? { displayName: holding.displayName } : {}),
    ...(holding.instrumentCode ? { instrumentCode: holding.instrumentCode } : {}),
    quantity: holding.quantity,
    costBasis: holding.costBasis,
    currency: holding.currency,
  };
}

export function AssetImportWorkflow() {
  const [sourceAccountId, setSourceAccountId] = useState("alipay-main");
  const [accounts, setAccounts] = useState<AccountOption[]>(
    sourceAccounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      label: account.label,
      updateMethod: account.updateMethod === "screenshot"
        ? "Screenshot"
        : "Trading 212 API",
    })),
  );
  const [file, setFile] = useState<File>();
  const [csvFile, setCsvFile] = useState<File>();
  const [draft, setDraft] = useState<ImportDraftView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operationLabel, setOperationLabel] = useState("");

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
  const imageImportSupported = selectedAccount?.updateMethod === "Screenshot";

  async function requestDraft(
    request: () => Promise<Response>,
    fallbackError: string,
    onLoaded?: (loadedDraft: ImportDraftView) => void,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
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
    setOperationLabel(mode === "image"
      ? "Analyzing with OpenAI…"
      : "Loading demo…");
    try {
      await requestDraft(async () => {
        const form = new FormData();
        form.set("sourceAccountId", sourceAccountId);
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
    } finally {
      setOperationLabel("");
    }
  }

  async function syncTrading212() {
    const targetAccountId = selectedAccount?.provider === "trading212"
      ? sourceAccountId
      : trading212SourceAccountId;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/imports/trading212", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceAccountId: targetAccountId }),
      });
      const payload = (await response.json()) as {
        outcome?: "review-required" | "market-data-only";
        draft?: ImportDraftView;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Trading 212 sync failed.");
      }
      setSourceAccountId(targetAccountId);
      if (payload.outcome === "market-data-only") {
        setDraft(undefined);
        setNotice(payload.message ?? "Prices updated. No holding changes need review.");
        return;
      }
      if (!payload.draft) {
        throw new Error(payload.error ?? "Trading 212 sync failed.");
      }
      setDraft(payload.draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Trading 212 sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startManualEntry() {
    await requestDraft(() => fetch("/api/imports/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceAccountId }),
      }), "Manual draft could not be created.");
  }

  async function importCsv() {
    await requestDraft(async () => {
      if (!csvFile) throw new Error("Choose a CSV file first.");
      const form = new FormData();
      form.set("sourceAccountId", sourceAccountId);
      form.set("file", csvFile);
      return fetch("/api/imports/csv", { method: "POST", body: form });
    }, "CSV import failed.");
  }

  function addPosition() {
    setDraft((current) => {
      if (!current || current.status !== "draft") return current;
      const currency = selectedAccount?.provider === "alipay" || selectedAccount?.provider === "wechat"
        ? "CNY"
        : "EUR";
      const addedHolding = {
        lineId: crypto.randomUUID(),
        instrumentId: "",
        displayName: "",
        assetType: undefined,
        quantity: "1",
        currency,
        costBasis: "",
        reportedPriorReturn: "0",
      };
      return {
        ...current,
        ...(current.reconciliation
          ? {
              reconciliation: recountReconciliation({
                ...current.reconciliation,
                holdings: [
                  ...current.reconciliation.holdings,
                  {
                    key: addedHolding.lineId,
                    proposedLineId: addedHolding.lineId,
                    kind: "new",
                    after: comparisonFromEditableHolding(addedHolding),
                    changes: [],
                  },
                ],
              }),
            }
          : {}),
        portfolio: {
          ...current.portfolio,
          holdings: [
            ...current.portfolio.holdings,
            addedHolding,
          ],
        },
      };
    });
  }

  function removePosition(index: number) {
    setDraft((current) => {
      if (!current || current.status !== "draft") return current;
      const removed = current.portfolio.holdings[index];
      const reconciliation = current.reconciliation && removed
        ? recountReconciliation({
            ...current.reconciliation,
            holdings: current.reconciliation.holdings.flatMap((item) => {
              if (item.proposedLineId !== removed.lineId) return [item];
              if (!item.before) return [];
              return [{
                ...item,
                proposedLineId: undefined,
                kind: "possibly-removed" as const,
                after: undefined,
                changes: [],
              }];
            }),
          })
        : current.reconciliation;
      return {
        ...current,
        ...(reconciliation ? { reconciliation } : {}),
        portfolio: {
          ...current.portfolio,
          holdings: current.portfolio.holdings.filter((_, positionIndex) => positionIndex !== index),
        },
      };
    });
  }

  function updatePosition(
    index: number,
    field: "displayName" | "instrumentCode" | "assetType" | "quantity" | "currency" | "costBasis" | "reportedPriorReturn" | "averageCost" | "observedPrice" | "priceAsOf" | "reportedMarketValue",
    value: string,
  ) {
    setDraft((current) => {
      if (!current) return current;
      const holdings = current.portfolio.holdings.map(
        (position, positionIndex) => {
          if (positionIndex !== index) return position;
          if (field === "displayName") {
            return {
              ...position,
              displayName: value,
              instrumentId: position.instrumentCode || value,
            };
          }
          if (field === "instrumentCode") {
            return {
              ...position,
              instrumentCode: value || undefined,
              instrumentId: value || position.displayName || position.instrumentId,
            };
          }
          if (field === "assetType") {
            return {
              ...position,
              assetType: value ? value as AssetType : undefined,
            };
          }
          if (field === "observedPrice") {
            return { ...position, observedPrice: value || undefined };
          }
          if (field === "priceAsOf") {
            return {
              ...position,
              priceAsOf: value ? `${value}T00:00:00.000Z` : undefined,
            };
          }
          if (field === "averageCost" || field === "reportedMarketValue") {
            return { ...position, [field]: value || undefined };
          }
          return { ...position, [field]: value };
        },
      );
      const updatedHolding = holdings[index];
      const reconciliation = current.reconciliation && updatedHolding
        ? recountReconciliation({
            ...current.reconciliation,
            holdings: current.reconciliation.holdings.map((item) =>
              item.proposedLineId === updatedHolding.lineId
                ? {
                    ...item,
                    kind: item.before ? "holding-changed" as const : "new" as const,
                    after: comparisonFromEditableHolding(updatedHolding),
                  }
                : item
            ),
          })
        : current.reconciliation;
      return {
        ...current,
        ...(reconciliation ? { reconciliation } : {}),
        portfolio: {
          ...current.portfolio,
          holdings,
        },
      };
    });
  }

  function updatePortfolioCash(field: "amount" | "currency", value: string) {
    setDraft((current) => {
      if (!current?.portfolio.portfolioCash) return current;
      const portfolioCash = {
        ...current.portfolio.portfolioCash,
        [field]: field === "currency" ? value.toUpperCase() : value,
      };
      const reconciliation = current.reconciliation
        ? recountReconciliation({
            ...current.reconciliation,
            cash: current.reconciliation.cash?.before
              ? {
                  before: current.reconciliation.cash.before,
                  after: portfolioCash,
                  kind:
                    current.reconciliation.cash.before.amount === portfolioCash.amount &&
                      current.reconciliation.cash.before.currency.toUpperCase() ===
                        portfolioCash.currency.toUpperCase()
                      ? "unchanged"
                      : "holding-changed",
                }
              : { kind: "new", after: portfolioCash },
          })
        : undefined;
      return {
        ...current,
        ...(reconciliation ? { reconciliation } : {}),
        portfolio: { ...current.portfolio, portfolioCash },
      };
    });
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (draft.portfolio.holdings.length === 0 && !draft.portfolio.portfolioCash) {
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
          portfolio: draft.portfolio,
        }),
      });
      const payload = (await response.json()) as {
        draft?: ImportDraftView;
        confirmedSnapshot?: Parameters<typeof createDemoPortfolioRecord>[0]["snapshot"];
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Confirmation failed.");
      }
      if (payload.draft.sourceKind === "demo" && payload.confirmedSnapshot) {
        try {
          window.localStorage.setItem(
            demoPortfolioStorageKey,
            JSON.stringify(createDemoPortfolioRecord({
              confirmedAt: payload.draft.confirmedAt ?? new Date().toISOString(),
              snapshot: payload.confirmedSnapshot,
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
          <p>Every update creates a draft. Your portfolio does not change until you confirm it.</p>
        </div>
        <Link className="secondary-button" href="/">Back to overview</Link>
      </header>

      <div className="import-layout">
        <section className="import-card">
          <div className="step-label"><span>1</span>Select source and update method</div>
          <label className="field-label">
            Source account
            <select
              value={sourceAccountId}
              onChange={(event) => {
                setSourceAccountId(event.target.value);
                setDraft(undefined);
                setNotice("");
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
            <strong>{file ? file.name : "Choose a portfolio screenshot"}</strong>
            <small>
              {imageImportSupported
                ? "OpenAI Vision · JPEG, PNG or WebP · up to 10 MB"
                : "Select a screenshot-based Source Account"}
            </small>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </label>

          <div className="privacy-callout">
            <strong>OpenAI cloud image analysis</strong>
            <p>The selected screenshot is sent to the OpenAI API for structured extraction. This app does not save the original image or provider response. Review every detected value; your portfolio changes only after confirmation.</p>
          </div>

          <div className="import-actions">
            <button
              className="primary-button action-button"
              type="button"
              disabled={busy || !file || !imageImportSupported}
              onClick={() => analyze("image")}
            >
              {busy && operationLabel
                ? operationLabel
                : "Analyze with OpenAI"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => analyze("demo")}
            >
              Try the synthetic demo
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
          {busy && operationLabel && (
            <p className="image-analysis-progress" role="status">{operationLabel}</p>
          )}
          <div className="connector-divider"><span>or</span></div>
          <div className="csv-import-panel">
            <div>
              <strong>Saved holdings CSV</strong>
              <small>Processed locally · creates a review draft</small>
            </div>
            <label className="csv-file-button">
              {csvFile ? csvFile.name : "Choose CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setCsvFile(event.target.files?.[0])}
              />
            </label>
            <button type="button" disabled={busy || !csvFile} onClick={importCsv}>Review CSV</button>
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
          {notice && <p className="success-message" role="status">{notice}</p>}
        </section>

        <section className="import-card review-card">
          <div className="step-label"><span>2</span>Review and confirm</div>
          {!draft && (
            <div className="empty-review">
              <span>◎</span>
              <strong>Waiting for analysis</strong>
              <p>You can review names, codes, quantities, NAV dates, values and prior return here.</p>
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
                <span>{draft.portfolio.asOf.slice(0, 10)}</span>
              </div>
              {draft.warnings.length > 0 && (
                <div className="warning-list">
                  {draft.warnings.map((warning, index) => <p key={`${warning}-${index}`}>◷ {warning}</p>)}
                </div>
              )}
              {draft.reconciliation && (
                <div className="reconciliation-summary">
                  <div>
                    <strong>
                      {draft.reconciliation.snapshotKind === "opening"
                        ? "Opening snapshot"
                        : "Holding changes"}
                    </strong>
                    <small>
                      {draft.reconciliation.mode === "complete"
                        ? "Complete account snapshot"
                        : "Partial account update"}
                    </small>
                  </div>
                  <span>{reviewChangeLabel(draft.reconciliation)} to review</span>
                  {draft.reconciliation.marketDataUpdatedCount > 0 && (
                    <span>{draft.reconciliation.marketDataUpdatedCount} price-only</span>
                  )}
                  {draft.reconciliation.unchangedCount > 0 && (
                    <span>{draft.reconciliation.unchangedCount} unchanged</span>
                  )}
                </div>
              )}
              {draft.portfolio.portfolioCash && (
                <div className={`cash-review ${draft.reconciliation?.cash?.kind ?? ""}`}>
                  <span>Portfolio cash</span>
                  <span className="cash-review-values">
                    {draft.reconciliation?.cash?.before &&
                      draft.reconciliation.cash.kind !== "unchanged" &&
                      `${draft.reconciliation.cash.before.amount} ${draft.reconciliation.cash.before.currency} → `}
                    <input
                      aria-label="Portfolio cash amount"
                      required
                      inputMode="decimal"
                      value={draft.portfolio.portfolioCash.amount}
                      onChange={(event) => updatePortfolioCash("amount", event.target.value)}
                    />
                    <input
                      aria-label="Portfolio cash currency"
                      required
                      maxLength={3}
                      value={draft.portfolio.portfolioCash.currency}
                      onChange={(event) => updatePortfolioCash("currency", event.target.value)}
                    />
                  </span>
                </div>
              )}
              <div className="review-positions">
                {draft.portfolio.holdings
                  .map((position, index) => ({
                    position,
                    index,
                    reconciliation: draft.reconciliation?.holdings.find(
                      (item) => item.proposedLineId === position.lineId,
                    ),
                  }))
                  .filter(({ reconciliation }) =>
                    draft.sourceKind !== "trading-212" ||
                    reconciliation?.kind !== "market-data-updated"
                  )
                  .map(({ position, index, reconciliation }) => {
                  const collapsed = reconciliation?.kind === "unchanged";
                  return (
                  <details
                    className={`review-position ${reconciliation?.kind ?? ""}`}
                    key={`${draft.id}-holding-${index}`}
                    open={!collapsed}
                  >
                    <summary>
                      <span>
                        <strong>{position.displayName ?? position.instrumentId}</strong>
                        <small>{position.instrumentCode ?? position.instrumentId}</small>
                      </span>
                      {reconciliation && (
                        <em>{reconciliation.kind.replaceAll("-", " ")}</em>
                      )}
                    </summary>
                    {reconciliation?.changes.length ? (
                      <div className="before-after-list">
                        {reconciliation.changes.map((change) => (
                          <span key={change.field}>
                            <small>{change.field === "costBasis" ? "Cost basis" : change.field}</small>
                            <strong>{change.before} → {change.after}</strong>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <fieldset>
                    <legend><span>Holding {index + 1}</span><button type="button" onClick={() => removePosition(index)}>Remove</button></legend>
                    <div className="field-grid">
                      <label className="field-label">Name
                        <input required value={position.displayName ?? position.instrumentId} onChange={(event) => updatePosition(index, "displayName", event.target.value)} />
                      </label>
                      <label className="field-label">Code / ISIN / ticker
                        <input value={position.instrumentCode ?? ""} onChange={(event) => updatePosition(index, "instrumentCode", event.target.value)} />
                      </label>
                      <label className="field-label">Asset type
                        <select value={position.assetType ?? ""} onChange={(event) => updatePosition(index, "assetType", event.target.value)}>
                          <option value="">Unknown / not classified</option>
                          {assetTypes.map((assetType) => (
                            <option value={assetType} key={assetType}>{assetTypeLabels[assetType]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">Average cost
                        <input inputMode="decimal" value={position.averageCost ?? ""} onChange={(event) => updatePosition(index, "averageCost", event.target.value)} placeholder="Optional" />
                      </label>
                      <label className="field-label">Latest price / NAV
                        <input inputMode="decimal" value={position.observedPrice ?? ""} onChange={(event) => updatePosition(index, "observedPrice", event.target.value)} placeholder="Optional" />
                      </label>
                      <label className="field-label">Price / NAV date
                        <input type="date" value={position.priceAsOf?.slice(0, 10) ?? ""} onChange={(event) => updatePosition(index, "priceAsOf", event.target.value)} />
                      </label>
                      <label className="field-label">Current value
                        <input inputMode="decimal" value={position.reportedMarketValue ?? ""} onChange={(event) => updatePosition(index, "reportedMarketValue", event.target.value)} placeholder="Optional" />
                      </label>
                    </div>
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
                  </details>
                  );
                })}
                {draft.reconciliation?.holdings
                  .filter((item) => item.kind === "possibly-removed")
                  .map((item) => (
                    <div className="removed-holding-review" key={item.key}>
                      <span>
                        <strong>{item.before?.displayName ?? item.before?.instrumentId}</strong>
                        <small>{item.before?.instrumentCode ?? item.before?.instrumentId}</small>
                      </span>
                      <div>
                        <em>Possibly removed</em>
                        <small>This holding is absent from the complete Trading 212 snapshot and will be removed only if you confirm.</small>
                      </div>
                    </div>
                  ))}
              </div>
              <button className="add-holding-button" type="button" disabled={busy} onClick={addPosition}>+ Add holding</button>
              <button className="primary-button confirm-button" disabled={busy || (draft.portfolio.holdings.length === 0 && !draft.portfolio.portfolioCash)} type="submit">
                {busy
                  ? "Saving…"
                  : draft.reconciliation
                    ? `Confirm ${reviewChangeLabel(draft.reconciliation)}`
                    : `Confirm ${draft.portfolio.holdings.length} changes`}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
