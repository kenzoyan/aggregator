"use client";

import { useState, type FormEvent } from "react";
import { ReviewDialog } from "@/components/ui/review-dialog";

import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { saleQuantityForDate, formatPortfolioSaleMoney, formatPortfolioSaleQuantity } from "@/application/portfolio-sale-presentation";
import { CashDestinationFields } from "@/components/cash-destination-fields";
import type { CashDestination } from "@/domain/portfolio/types";
import type { HoldingPriceHistoryReadModel } from "@/application/portfolio-read-model";
import type { SaleInput } from "@/application/portfolio-sale";

interface SalePreview {
  currency: string;
  quantityBefore: string;
  quantityAfter: string;
  costBasisBefore: string;
  costBasisAfter: string;
  soldCostBasis: string;
  saleResult: string;
  netProceeds: string;
  cashBefore: string;
  cashAfter: string;
  externalOutflow: string;
  destination: CashDestination;
}

export function PortfolioSaleForm({ sourceAccountId, instrumentId, holdingName, currency, accountName, isFund, prices = [], unitLabel = "units", destinations = [], onSaved, onCancel }: {
  sourceAccountId: string;
  instrumentId: string;
  holdingName: string;
  currency: string;
  accountName: string;
  isFund: boolean;
  prices?: readonly HoldingPriceHistoryReadModel[];
  unitLabel?: "units" | "shares";
  destinations?: readonly string[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(portfolioCalendarDate);
  const [proceeds, setProceeds] = useState("");
  const [actualQuantity, setActualQuantity] = useState("");
  const [fees, setFees] = useState("0");
  const [destination, setDestination] = useState<CashDestination>({ kind: "investment-account" });
  const [review, setReview] = useState<{ preview: SalePreview; reviewToken: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resolved = saleQuantityForDate({ amount: proceeds, date, currency, isFund, prices, actualQuantity });
  const quantity = resolved.quantity ?? "";
  const sale: SaleInput = { sourceAccountId, instrumentId, date, quantity, proceeds, fees, destination };
  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setReview(undefined);
    setError("");
  }
  async function previewSale(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!quantity) { setError("Enter the sale amount and actual quantity sold, both above zero."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/portfolio/sales", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(sale),
      });
      const payload = await response.json() as { preview?: SalePreview; reviewToken?: string; error?: string };
      if (!response.ok || !payload.preview || !payload.reviewToken) {
        throw new Error(payload.error ?? "Sale could not be reviewed.");
      }
      setReview({ preview: payload.preview, reviewToken: payload.reviewToken });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sale could not be reviewed.");
    } finally {
      setBusy(false);
    }
  }
  async function confirmSale() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/portfolio/sales", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sale, reviewToken: review.reviewToken, confirm: true }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 409) setReview(undefined);
        throw new Error(payload.error ?? "Sale could not be saved.");
      }
      setReview(undefined);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sale could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <ReviewDialog open title={review ? "Review sale" : "Record a completed sale"} busy={busy} onClose={onCancel}><div className="operation-dialog-content"><form className="account-price-form portfolio-sale-form" onSubmit={(event) => { if (review) { event.preventDefault(); void confirmSale(); } else void previewSale(event); }}>
    <fieldset disabled={busy}>
      <header className="sale-form-heading">
        <strong>{holdingName}</strong>
      </header>
      {!review && <>
      <div className="sale-input-grid">
        <label>Sale amount before fees ({currency})
          <input required inputMode="decimal" value={proceeds} onChange={(event) => change(setProceeds, event.target.value)} />
        </label>
        <label>{isFund ? "Sale / NAV date" : "Sale date"}
          <input required type="date" max={portfolioCalendarDate()} value={date} onChange={(event) => { change(setDate, event.target.value); setActualQuantity(""); }} />
        </label>
      </div>
      {!resolved.nav && <label>{unitLabel === "shares" ? "Actual shares sold" : "Actual units sold"}
        <input required inputMode="decimal" value={actualQuantity} onChange={(event) => change(setActualQuantity, event.target.value)} />
        <small>{isFund ? "No published NAV is saved for this date. Use the units on your sale confirmation." : "Use the quantity on your sale confirmation."}</small>
      </label>}
      <CashDestinationFields compact destination={destination} names={destinations} accountName={accountName} onChange={(next) => { setDestination(next); setReview(undefined); setError(""); }} />
      <details className="sale-more-settings">
        <summary>More settings</summary>
        <div className="sale-input-grid">
          <label>Fee ({currency})
            <input required inputMode="decimal" value={fees} onChange={(event) => change(setFees, event.target.value)} />
          </label>
          {resolved.nav && <label>Actual units sold (optional)
            <input inputMode="decimal" value={actualQuantity} onChange={(event) => change(setActualQuantity, event.target.value)} />
          </label>}
        </div>
      </details>
      </>}
      {review && <section className="sale-confirmation" aria-label="Sale summary" aria-live="polite">
        <table className="sale-summary-table">
          <caption>Sale summary</caption>
          <tbody>
            <tr><th scope="row">{unitLabel === "shares" ? "Shares sold" : "Units sold"}</th><td title={quantity}>{formatPortfolioSaleQuantity(quantity, 8)}</td></tr>
            <tr><th scope="row">Received after fees</th><td>{formatPortfolioSaleMoney(review.preview.netProceeds, currency)}</td></tr>
            <tr><th scope="row">Profit / loss</th><td>{formatPortfolioSaleMoney(review.preview.saleResult, currency)}</td></tr>
            <tr><th scope="row">{unitLabel === "shares" ? "Shares remaining" : "Units remaining"}</th><td title={review.preview.quantityAfter}>{formatPortfolioSaleQuantity(review.preview.quantityAfter, 8)}</td></tr>
            <tr><th scope="row">{review.preview.destination.kind === "external-account" ? "Withdraw to" : "Keep in"}</th><td>{review.preview.destination.kind === "external-account" ? review.preview.destination.name : accountName}</td></tr>
            <tr><th scope="row">Proceeds in portfolio total</th><td>{review.preview.destination.kind === "external-account" ? "Excluded" : "Included as cash"}</td></tr>
            {resolved.nav && !actualQuantity && <tr><th scope="row">NAV used · {date}</th><td>{resolved.nav.price} {currency}</td></tr>}
          </tbody>
        </table>
      </section>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="sale-form-actions">
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        {review && <button type="button" disabled={busy} onClick={() => { setReview(undefined); setError(""); }}>Back to edit</button>}
        {review
          ? <button className="sale-confirm" type="button" disabled={busy} onClick={confirmSale}>{busy ? "Saving…" : "Save sale record"}</button>
          : <button type="submit" disabled={busy}>{busy ? "Checking…" : "Review changes"}</button>}
      </div>
    </fieldset>
  </form></div></ReviewDialog>;
}
