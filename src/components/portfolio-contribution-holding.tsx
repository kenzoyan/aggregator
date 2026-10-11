"use client";

import { useEffect, useRef } from "react";
import type { PeriodAnalysisHolding, PortfolioPeriodAnalysis } from "@/application/portfolio-period-analysis";

const eur = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${eur.format(Math.abs(value))}`;

export function ContributionHolding({ holding, analysis, zh, onBack }: {
  holding: PeriodAnalysisHolding; analysis: PortfolioPeriodAnalysis; zh: boolean; onBack: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [holding.id]);
  const row = holding.contribution;
  const events = analysis.events.filter((event) => event.sourceAccountId === holding.sourceAccountId &&
    (event.kind === "withdrawal" ? holding.category === "Portfolio cash" && event.amount.currency === holding.currency : event.holdingId === holding.id));
  return <section className="contribution-holding" aria-labelledby="contribution-holding-title">
    <button type="button" className="workspace-back" onClick={onBack}>{zh ? "返回贡献列表" : "Back to contributions"}</button>
    <h2 id="contribution-holding-title" ref={heading} tabIndex={-1}>{holding.name}</h2>
    <p>{holding.account} · {holding.currency}{holding.freshness ? ` · ${holding.freshness}` : ""}</p>
    {row && <>
      <strong className={`workspace-fact-value ${row.change >= 0 ? "positive" : "negative"}`}>{signed(row.change)}</strong>
      <p>{zh ? "期间贡献" : "Period contribution"}{row.percent === undefined ? "" : ` · ${row.percent.toFixed(2)}% ${zh ? "持仓涨跌" : "holding return"}`}</p>
      <dl className="contribution-details">
        <div><dt>{zh ? "估值区间" : "Valuation window"}</dt><dd>{row.baselineAsOf} → {row.currentAsOf}</dd></div>
        <div><dt>{zh ? "价格日期" : "Price dates"}</dt><dd>{row.baselinePriceAsOf ?? "—"} → {row.currentPriceAsOf ?? "—"}</dd></div>
        <div><dt>{zh ? "按当前数量回算的起始价值" : "Baseline at current quantity"}</dt><dd>{eur.format(row.baselineValueEur)}</dd></div>
        <div><dt>{zh ? "期末价值" : "End value"}</dt><dd>{eur.format(row.currentValueEur)}</dd></div>
        <div><dt>{zh ? "价格影响" : "Price effect"}</dt><dd>{row.priceChange === undefined ? "—" : signed(row.priceChange)}</dd></div>
        <div><dt>{zh ? "汇率影响" : "FX effect"}</dt><dd>{row.fxChange === undefined ? "—" : signed(row.fxChange)}</dd></div>
        {row.priceChange !== undefined && row.fxChange !== undefined && Math.abs(row.change - row.priceChange - row.fxChange) > 0.005 &&
          <div><dt>{zh ? "未拆分差额" : "Unexplained component"}</dt><dd>{signed(row.change - row.priceChange - row.fxChange)}</dd></div>}
      </dl>
    </>}
    {!row && <p>{holding.status === "excluded-closed"
      ? (zh ? "这项持仓已退出，不计入当前数量口径的涨跌；已实现收益需查看交易历史。" : "This holding has exited and is excluded from current-quantity performance. Realized results belong to transaction history.")
      : (zh ? "缺少可比较的估值或基线，不能计算贡献。" : "Comparable valuation or baseline data is missing; contribution cannot be calculated.")}</p>}
    {holding.detail && <details open><summary>{zh ? "当前保存的持仓与价格" : "Saved holding & price"}</summary>
      <dl className="contribution-details">
        <div><dt>{zh ? "当前数量" : "Current units"}</dt><dd>{holding.detail.quantity}</dd></div>
        <div><dt>{zh ? "最新保存的价格" : "Latest saved price"}</dt><dd>{holding.detail.currentPrice} {holding.currency}</dd></div>
        <div><dt>{zh ? "价格来源" : "Price source"}</dt><dd>{holding.detail.currentPriceSource} · {holding.detail.currentPriceAsOf}</dd></div>
      </dl>
      <details><summary>{zh ? "保存的价格记录" : "Saved price observations"}</summary>
        <ul>{holding.detail.priceHistory.map((price) => <li key={`${price.asOf}:${price.source}`}>{price.asOf} · {price.price} {price.currency} · {price.source}</li>)}</ul>
      </details>
    </details>}
    {events.length > 0 && <details><summary>{zh ? "相关期间记录" : "Related period records"}</summary>
      <ul>{events.map((event) => <li key={event.id}>{event.asOf.slice(0, 10)} · {event.label} · {event.amount.amount} {event.amount.currency}<small>{event.note}</small></li>)}</ul>
    </details>}
  </section>;
}
