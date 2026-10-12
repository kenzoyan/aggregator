"use client";
import { useState } from "react";
import type { AgentPriceSourceReview } from "@/application/agent-price-source-discovery";
import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";

export function AgentPriceSourceReviewContent({ review, conversationId, turnId, language, busy, setBusy, onConfirmed, onCancel }: {
  review: AgentPriceSourceReview; conversationId: string; turnId: string; language: PortfolioAnalystLanguage;
  busy: boolean; setBusy: (busy: boolean) => void; onConfirmed: (conversation: PortfolioAnalystConversation) => void; onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const zh = language === "zh-CN";
  async function confirm(candidateId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/portfolio/analyst/price-source", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, turnId, candidateId }) });
      const result = await response.json() as { conversation?: PortfolioAnalystConversation; error?: string };
      if (!response.ok || !result.conversation) throw new Error(result.error ?? (zh ? "确认失败，请重试。" : "Confirmation failed. Try again."));
      onConfirmed(result.conversation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Confirmation failed."); }
    finally { setBusy(false); }
  }
  return <div className="agent-memory-review">
    <h2>{review.instrumentName}</h2>
    <p>{review.instrumentCode} · {review.currency}</p>
    <p>{zh ? "确认后，系统会复用此来源检查净值。数量、成本和现金不会改变。" : "After confirmation, price checks will reuse this source. Quantity, cost and cash stay unchanged."}</p>
    <p>{zh ? "查询时间：" : "Retrieved: "}{new Date(review.retrievedAt).toLocaleString(zh ? "zh-CN" : "en-GB", { timeZone: "Europe/Helsinki" })}</p>
    {review.state === "adapter-required" && <p role="status">{zh ? "已找到候选网页，但当前还没有可用读取方式，暂时不能启用自动更新。" : "Candidate pages found. A supported reader is still needed before automatic updates can be enabled."}</p>}
    {review.researchStatus === "unavailable" && <p>{zh ? "本次网页搜索不可用。下列来源来自已有支持，并已实际试读。" : "Web research was unavailable. The source below is already supported and was directly probed."}</p>}
    {review.candidates.map((candidate) => <section key={candidate.id} className="price-source-candidate">
      <h3>{candidate.name}</h3>
      <p>{candidate.provider} · {candidate.shareClass} · {candidate.currency}</p>
      <p>{candidate.quoteAvailable ? `${candidate.price} ${candidate.currency} · ${candidate.priceAsOf}`
        : zh ? "净值试读失败，不能确认。" : "Trial NAV unavailable. Confirmation is disabled."}</p>
      <a href={candidate.identityUrl} target="_blank" rel="noreferrer">{zh ? "查看价格来源" : "View price source"}</a>
      <p>{zh ? "覆盖近期历史；完整历史数据不保证可用。" : "Recent history is available; complete history is not guaranteed."}</p>
      <button type="button" disabled={busy || !candidate.quoteAvailable} onClick={() => void confirm(candidate.id)}>
        {busy ? zh ? "正在确认…" : "Confirming…" : zh ? "确认这个价格源" : "Confirm this price source"}
      </button>
    </section>)}
    {review.sources.length > 0 && <details><summary>{zh ? "搜索找到的参考网页" : "Research links"}</summary>
      <ul>{review.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p>{source.summary}</p></li>)}</ul>
    </details>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={onCancel}>{zh ? "取消草稿" : "Cancel draft"}</button>
  </div>;
}
