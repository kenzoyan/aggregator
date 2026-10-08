"use client";

import Link from "next/link";
import { ImportReductionReviewFields } from "@/components/import-reduction-review";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import {
  createImportDraftConfirmationPayload,
  type ImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import {
  applyImportDraftEdit,
  type EditableHoldingField,
} from "@/application/imports/import-review-editor";
import type { SourceAccountView } from "@/application/source-account-status";
import { ScreenshotPreviewTray } from "@/components/screenshot-preview-tray";
import { parseImportStartResult } from "@/components/import-start-result";
import { resolveRequestedSourceAccountId } from "@/components/source-account-selection";
import {
  maximumScreenshotCount,
  mergeScreenshotFiles,
  removeScreenshotFile,
  screenshotSelectionSignature,
} from "@/components/screenshot-selection";
import { assetTypeLabels, assetTypes } from "@/domain/portfolio/types";
import type { ImportReconciliation } from "@/domain/imports";

type ImportDraftView = ImportDraftReadModel;

type AccountOption = Pick<
  SourceAccountView,
  "id" | "accountType" | "provider" | "label" | "updateMethod" | "connector"
>;

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

export function AssetImportWorkflow() {
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [csvFile, setCsvFile] = useState<File>();
  const [draft, setDraft] = useState<ImportDraftView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operationLabel, setOperationLabel] = useState("");
  const [analyzedScreenshotSignature, setAnalyzedScreenshotSignature] = useState<string>();

  useEffect(() => {
    fetch("/api/accounts", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { accounts?: AccountOption[]; error?: string };
        if (!response.ok || !payload.accounts) {
          throw new Error(payload.error ?? "Source accounts could not be loaded.");
        }
        setAccounts(payload.accounts);
        const search = new URLSearchParams(window.location.search);
        const requested = search.get("account");
        const requestedByType = resolveRequestedSourceAccountId(
          payload.accounts,
          search.get("accountType"),
        );
        setSourceAccountId((current) => {
          if (requested && payload.accounts!.some((account) => account.id === requested)) {
            return requested;
          }
          if (requestedByType) return requestedByType;
          if (payload.accounts!.some((account) => account.id === current)) return current;
          return payload.accounts![0]?.id ?? "";
        });
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Source accounts could not be loaded.");
      });
  }, []);

  const selectedAccount = accounts.find((account) => account.id === sourceAccountId);
  const imageImportSupported = selectedAccount?.updateMethod === "Screenshot";
  const screenshotSignature = useMemo(
    () => screenshotSelectionSignature(files),
    [files],
  );
  const screenshotsChangedSinceAnalysis = Boolean(
    draft?.sourceKind === "screenshot" &&
    analyzedScreenshotSignature !== undefined &&
    screenshotSignature !== analyzedScreenshotSignature,
  );

  function selectScreenshots(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    const merged = mergeScreenshotFiles(files, selected);
    setFiles(merged.files);
    setNotice(merged.duplicateCount > 0
      ? `${merged.duplicateCount} duplicate screenshot${merged.duplicateCount === 1 ? " was" : "s were"} already selected.`
      : "");
    setError(merged.overflowCount > 0
      ? `Only ${maximumScreenshotCount} screenshots can be analyzed together. Remove one before adding another.`
      : "");
    event.currentTarget.value = "";
  }

  function removeScreenshot(file: File) {
    setFiles((current) => removeScreenshotFile(current, file));
    setError("");
    setNotice("");
  }

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
      const result = parseImportStartResult(await response.json(), response.ok, fallbackError);
      if (result.outcome === "market-data-only") {
        setDraft(undefined);
        setNotice(result.message);
        return;
      }
      setDraft(result.draft);
      onLoaded?.(result.draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallbackError);
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    setOperationLabel("Analyzing with OpenAI…");
    try {
      await requestDraft(async () => {
        const form = new FormData();
        form.set("sourceAccountId", sourceAccountId);
        form.set("mode", "image");
        if (files.length === 0) throw new Error("Choose at least one screenshot first.");
        files.forEach((file) => form.append("images", file));

        return fetch("/api/imports/analyze", {
          method: "POST",
          body: form,
        });
      }, "Image analysis failed.", () => {
        setAnalyzedScreenshotSignature(screenshotSelectionSignature(files));
      });
    } finally {
      setOperationLabel("");
    }
  }

  async function syncTrading212() {
    await requestDraft(() => fetch("/api/imports/trading212", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceAccountId }),
    }), "Trading 212 sync failed.");
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
      return applyImportDraftEdit(current, {
        type: "add-holding",
        holding: addedHolding,
      });
    });
  }

  function removePosition(index: number) {
    setDraft((current) => current
      ? applyImportDraftEdit(current, { type: "remove-holding", index })
      : current);
  }

  function updatePosition(
    index: number,
    field: EditableHoldingField,
    value: string,
  ) {
    setDraft((current) => current
      ? applyImportDraftEdit(current, {
          type: "update-holding",
          index,
          field,
          value,
        })
      : current);
  }

  function updatePortfolioCash(field: "amount" | "currency", value: string) {
    setDraft((current) => current
      ? applyImportDraftEdit(current, {
          type: "update-cash",
          field,
          value,
        })
      : current);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (screenshotsChangedSinceAnalysis) {
      setError("Analyze the updated screenshot set before confirming this import.");
      return;
    }
    if (!draft.portfolio.asOf) {
      setError("Choose a valuation date including the year before confirming this import.");
      return;
    }
    if (draft.sourceKind === "screenshot" && draft.portfolio.holdings.some((holding) => holding.observedPrice && !holding.priceAsOf)) {
      setError("Choose a NAV / price date including the year for each priced screenshot holding.");
      return;
    }
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
        body: JSON.stringify(createImportDraftConfirmationPayload(draft)),
      });
      const payload = (await response.json()) as {
        draft?: ImportDraftView;
        error?: string;
        reconciliation?: ImportReconciliation;
      };
      if (!response.ok || !payload.draft) {
        if (payload.reconciliation) setDraft({ ...draft, reconciliation: payload.reconciliation });
        throw new Error(payload.error ?? "Confirmation failed.");
      }
      setDraft(payload.draft);
      setFiles([]);
      setAnalyzedScreenshotSignature(undefined);
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
                setFiles([]);
                setAnalyzedScreenshotSignature(undefined);
                setNotice("");
              }}
              disabled={busy}
            >
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>{account.label}</option>
              ))}
            </select>
          </label>

          {files.length === 0 && (
            <label className="upload-zone">
              <span className="upload-icon">↥</span>
              <strong>Choose portfolio screenshots</strong>
              <small>
                {imageImportSupported
                  ? "OpenAI Vision · 1–6 JPEG, PNG or WebP images · 10 MB each"
                  : "Select a screenshot-based Source Account"}
              </small>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                disabled={busy || !imageImportSupported}
                onChange={selectScreenshots}
              />
            </label>
          )}

          <ScreenshotPreviewTray
            files={files}
            disabled={busy}
            onRemove={removeScreenshot}
            addControl={files.length < maximumScreenshotCount ? (
              <label className="screenshot-add-tile">
                <span aria-hidden="true">＋</span>
                <strong>Add screenshot</strong>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy || !imageImportSupported}
                  onChange={selectScreenshots}
                />
              </label>
            ) : undefined}
          />
          {screenshotsChangedSinceAnalysis && (
            <p className="screenshot-change-notice" role="status">
              Screenshot set changed. Analyze again before confirming; re-analysis replaces the current review edits.
            </p>
          )}

          <div className="import-actions">
            <button
              className="primary-button action-button"
              type="button"
              disabled={busy || files.length === 0 || !imageImportSupported}
              onClick={() => analyze()}
            >
              {busy && operationLabel
                ? operationLabel
                : screenshotsChangedSinceAnalysis
                  ? "Analyze again"
                  : "Analyze with OpenAI"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy || !selectedAccount}
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
            <button type="button" disabled={busy || !csvFile || !selectedAccount} onClick={importCsv}>Review CSV</button>
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
          <Link className="manage-accounts-link" href="/accounts">Create or manage source accounts →</Link>
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
              <p>Prior return was retained as pre-monitoring history. Current value was not treated as new principal.</p>
              <Link className="primary-button" href="/">View portfolio overview</Link>
            </div>
          )}

          {draft?.status === "draft" && (
            <form onSubmit={confirm}>
              <div className="review-meta">
                <span className={`confidence ${draft.confidence}`}>Confidence: {draft.confidence}</span>
                <label className="review-date">Valuation date
                  <input
                    type="date"
                    value={draft.portfolio.asOf.slice(0, 10)}
                    onChange={(event) => setDraft((current) => current
                      ? applyImportDraftEdit(current, { type: "update-as-of", value: event.target.value })
                      : current)}
                  />
                </label>
              </div>
              <p className="review-date-explanation">
                This is when the account valued these holdings, not when you uploaded the screenshot.
              </p>
              {!draft.portfolio.asOf && <p className="review-date-help">Check the source account and enter the valuation date with its year before confirming.</p>}
              {draft.sourceKind === "screenshot" && draft.portfolio.holdings.some((holding) => holding.observedPrice && !holding.priceAsOf) && (
                <p className="review-date-help">Enter a NAV / price date including the year for each priced holding.</p>
              )}
              {draft.sourceKind === "screenshot" && draft.confidence === "low" && (
                <p className="review-date-help">Image reading is uncertain. Check the account, holdings and amounts before confirming.</p>
              )}
              {draft.warnings.length > 0 && (
                <details className="warning-list">
                  <summary>Additional review notes ({draft.warnings.length})</summary>
                  <div>{draft.warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}</div>
                </details>
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
              <ImportReductionReviewFields draft={draft} disabled={busy} onChange={(review) => setDraft(applyImportDraftEdit(draft, { type: "review-reduction", review }))} />
              <button className="primary-button confirm-button" disabled={busy || screenshotsChangedSinceAnalysis || !draft.portfolio.asOf || (draft.sourceKind === "screenshot" && draft.portfolio.holdings.some((holding) => holding.observedPrice && !holding.priceAsOf)) || (draft.portfolio.holdings.length === 0 && !draft.portfolio.portfolioCash)} type="submit">
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
