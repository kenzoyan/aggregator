"use client";

import { useState, type FormEvent } from "react";

import type { CashActivityReadModel } from "@/application/portfolio-cash-activity";
import { selectHoldingActivity } from "@/application/portfolio-activity-selection";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { formatPortfolioSaleMoney, formatPortfolioSaleQuantity } from "@/application/portfolio-sale-presentation";
import { CashDestinationFields } from "@/components/cash-destination-fields";
import type { CashDestination } from "@/domain/portfolio/types";

type TransferPreview = { cashBefore: string; cashAfter: string; currency: string; externalOutflow: string; destination: { kind: "external-account"; name: string } };

export function PortfolioCashActivity({ sourceAccountId, activity, instrumentId, cashCurrency, onSaved }: {
  sourceAccountId: string;
  activity: CashActivityReadModel;
  instrumentId?: string;
  cashCurrency?: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);
  const [date, setDate] = useState(portfolioCalendarDate);
  const [currency, setCurrency] = useState(activity.cashBalances[0]?.currency ?? "EUR");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState<CashDestination>({ kind: "external-account", name: "" });
  const [review, setReview] = useState<{ preview: TransferPreview; reviewToken: string }>();
  const [undoId, setUndoId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function transfer(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const withdrawal = { sourceAccountId, date, currency, amount, destination };
    try {
      const response = await fetch("/api/portfolio/sales", {
        method: review ? "PUT" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(review
          ? { type: "cash-withdrawal", withdrawal, reviewToken: review.reviewToken, confirm: true }
          : { type: "cash-withdrawal", ...withdrawal }),
      });
      const payload = await response.json();
      if (!response.ok) { if (response.status === 409) setReview(undefined); throw new Error(payload.error ?? "Transfer could not be saved."); }
      if (review) { setReview(undefined); setOpen(false); setAmount(""); await onSaved(); }
      else setReview(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Transfer failed."); }
    finally { setBusy(false); }
  }
  async function undo() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/portfolio/sales", {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: undoId, reviewToken: activity.reviewToken, confirm: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Record could not be undone.");
      setUndoId(undefined); await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Undo failed."); }
    finally { setBusy(false); }
  }
  const { records, updates } = selectHoldingActivity(activity, { instrumentId, cashCurrency });
  const rows = [
    ...records.map((record) => ({ id: record.id, asOf: record.asOf, record, update: undefined })),
    ...updates.map((update) => ({ id: update.id, asOf: update.asOf, record: undefined, update })),
  ].sort((a, b) => b.asOf.localeCompare(a.asOf));
  function changed() { setReview(undefined); setError(""); }
  return <section className="price-history-section holding-activity-history">
    <div className="drawer-section-heading"><h3>History</h3></div>
    {!instrumentId && activity.cashBalances.length > 0 && <button type="button" disabled={busy} onClick={() => { setOpen(!open); setReview(undefined); }}>Withdraw cash</button>}
    {open && <form className="account-price-form" onSubmit={transfer}>
      <fieldset disabled={busy}>
        <h3>Transfer investment account cash out</h3>
        <label>Date<input required type="date" max={portfolioCalendarDate()} value={date} onChange={(event) => { setDate(event.target.value); changed(); }} /></label>
        <label>Currency<select value={currency} onChange={(event) => { setCurrency(event.target.value); changed(); }}>{activity.cashBalances.map((cash) => <option key={cash.currency} value={cash.currency}>{cash.currency} · available {cash.amount}</option>)}</select></label>
        <label>Amount<input required inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); changed(); }} /></label>
        <CashDestinationFields externalOnly destination={destination} names={activity.destinations} onChange={(next) => { setDestination(next); changed(); }} />
        {review && <div className="sale-review" role="status">
          <strong>Review transfer to {review.preview.destination.name}</strong>
          <span>Account cash: {review.preview.cashBefore} → {review.preview.cashAfter} {review.preview.currency}</span>
          <span>Tracked total decreases by {formatPortfolioSaleMoney(review.preview.externalOutflow, review.preview.currency)}.</span>
        </div>}
        <div><button type="button" onClick={() => setOpen(false)}>Cancel</button><button type="submit">{busy ? "Saving…" : review ? "Confirm transfer" : "Review transfer"}</button></div>
      </fieldset>
    </form>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {rows.length === 0 ? <p className="drawer-empty-copy">No activity recorded yet.</p> : <div className="holding-history-table-wrap"><table className="holding-history-table">
      <thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Quantity</th><th scope="col">Amount</th><th scope="col">Details</th><th scope="col"><span className="history-action-heading">Actions</span></th></tr></thead>
      <tbody>{rows.slice(0, visibleCount).map(({ id, asOf, record, update }) => <tr key={id}>
        <td>{asOf.slice(0, 10)}</td>
        <td>{update ? update.type : record?.type === "sale" ? "Sold" : "Withdrawal"}
          {record?.voidedAt && <small>Undone</small>}
        </td>
        <td title={update?.quantity ?? (record?.type === "sale" ? record.quantity : undefined)}>{update ? formatPortfolioSaleQuantity(update.quantity, 8) : record?.type === "sale" ? formatPortfolioSaleQuantity(record.quantity, 8) : "—"}</td>
        <td>{update ? formatPortfolioSaleMoney(update.amount.amount, update.amount.currency) : record?.type === "sale" ? formatPortfolioSaleMoney(record.proceeds.amount, record.proceeds.currency) : record ? formatPortfolioSaleMoney(record.amount.amount, record.amount.currency) : "—"}</td>
        <td>{update ? update.note : record?.destination?.kind === "external-account" ? `Withdrawn to ${record.destination.name}` : record?.destination?.kind === "investment-account" ? "Kept as account cash" : "Legacy record · destination not saved"}
          {record?.type === "sale" && <small>Before fees · fee {formatPortfolioSaleMoney(record.fees?.amount ?? "0", record.proceeds.currency)}</small>}
        </td>
        <td>{record && !record.voidedAt && (record.undoBlockedReason ? <span title={record.undoBlockedReason}>Undo unavailable</span> : <>
          {undoId === record.id ? <div className="history-undo-confirmation">
            <p>Undo this record and restore its quantities and cash?</p>
            <button type="button" disabled={busy} onClick={() => setUndoId(undefined)}>Cancel</button>
            <button type="button" disabled={busy} onClick={undo}>{busy ? "Undoing…" : "Confirm undo"}</button>
          </div> : <button type="button" disabled={busy} onClick={() => setUndoId(record.id)}>Undo</button>}
        </>)}</td>
      </tr>)}</tbody>
    </table></div>}
    {rows.length > visibleCount && <button className="price-history-more" type="button" onClick={() => setVisibleCount((count) => count + 5)}>Show {Math.min(5, rows.length - visibleCount)} more</button>}
  </section>;
}
