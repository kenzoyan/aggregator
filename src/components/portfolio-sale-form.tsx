"use client";

import { useState, type FormEvent } from "react";

import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { formatPortfolioSaleMoney } from "@/application/portfolio-sale-presentation";
import type { SaleInput } from "@/application/portfolio-sale";

interface SalePreview {
  currency: string;
  quantityBefore: string;
  quantityAfter: string;
  costBasisBefore: string;
  costBasisAfter: string;
  soldCostBasis: string;
  saleResult: string;
  cashBefore: string;
  cashAfter: string;
}

export function PortfolioSaleForm({ sourceAccountId, instrumentId, holdingName, currency, onSaved, onCancel }: {
  sourceAccountId: string;
  instrumentId: string;
  holdingName: string;
  currency: string;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(portfolioCalendarDate);
  const [quantity, setQuantity] = useState("");
  const [proceeds, setProceeds] = useState("");
  const [fees, setFees] = useState("0");
  const [review, setReview] = useState<{ preview: SalePreview; reviewToken: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sale: SaleInput = { sourceAccountId, instrumentId, date, quantity, proceeds, fees };
  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setReview(undefined);
    setError("");
  }
  async function previewSale(event: FormEvent) {
    event.preventDefault();
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
    if (!review) return;
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

  return <form className="account-price-form" onSubmit={previewSale}>
    <h3>Record sale · {holdingName}</h3>
    <p>Cost basis is allocated by quantity sold. Sale proceeds go to portfolio cash.</p>
    <label>Sale date<input required type="date" max={portfolioCalendarDate()} value={date} onChange={(event) => change(setDate, event.target.value)} /></label>
    <label>Quantity sold<input required inputMode="decimal" value={quantity} onChange={(event) => change(setQuantity, event.target.value)} /></label>
    <label>Gross proceeds ({currency})<input required inputMode="decimal" value={proceeds} onChange={(event) => change(setProceeds, event.target.value)} /></label>
    <label>Fees ({currency})<input required inputMode="decimal" value={fees} onChange={(event) => change(setFees, event.target.value)} /></label>
    {review && <div className="sale-review" role="status">
      <strong>Review sale</strong>
      <span>Quantity: {review.preview.quantityBefore} → {review.preview.quantityAfter}</span>
      <span>Remaining cost basis: {formatPortfolioSaleMoney(review.preview.costBasisBefore, currency)} → {formatPortfolioSaleMoney(review.preview.costBasisAfter, currency)}</span>
      <span>Cost allocated to sold units: {formatPortfolioSaleMoney(review.preview.soldCostBasis, currency)}</span>
      <span>Sale result after fees: {formatPortfolioSaleMoney(review.preview.saleResult, currency)}</span>
      <span>Portfolio cash: {formatPortfolioSaleMoney(review.preview.cashBefore, currency)} → {formatPortfolioSaleMoney(review.preview.cashAfter, currency)}</span>
    </div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      {review
        ? <button className="sale-confirm" type="button" disabled={busy} onClick={confirmSale}>{busy ? "Saving…" : "Confirm sale"}</button>
        : <button type="submit" disabled={busy}>{busy ? "Checking…" : "Review sale"}</button>}
    </div>
  </form>;
}
