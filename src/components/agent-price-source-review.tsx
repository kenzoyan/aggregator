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
  const providerName = (provider: string) => ({ "financial-times": "Financial Times", "danske-invest": "Danske Invest", eastmoney: zh ? "东方财富" : "Eastmoney" }[provider] ?? provider);
  return <section className="home-review-panel agent-price-source-review" aria-label={zh ? "价格源审核内容" : "Price source review details"}>
    <header className="source-review-heading">
      <p className="eyebrow">{zh ? "账户中的持仓" : "YOUR HOLDING"}</p>
      <h2>{review.instrumentName}</h2>
      <p className="source-review-identity">{review.instrumentCode} · {review.currency}</p>
    </header>
    <p className="source-review-note">{zh ? "确认后，净值检查会复用此来源。数量、成本和现金保持不变。" : "Confirm to reuse this source for NAV checks. Quantity, cost and cash stay unchanged."}</p>
    {review.state === "adapter-required" && <p className="source-review-notice" role="status">{zh ? "找到了候选网页，但还没有可用读取方式，暂时不能启用自动更新。" : "Candidate pages found. A supported reader is needed before automatic updates can be enabled."}</p>}
    {review.researchStatus === "unavailable" && <p className="source-review-notice">{zh ? "网页搜索暂不可用。下列来源来自已有支持，并已实际试读。" : "Web search was unavailable. The supported source below was directly checked."}</p>}
    <div className="source-review-candidates">
      {review.candidates.map((candidate) => <section key={candidate.id} className="source-review-candidate">
        <div className="source-review-candidate-heading">
          <p className="eyebrow">{zh ? "匹配的基金份额" : "MATCHED FUND SHARE CLASS"}</p>
          <span className={candidate.quoteAvailable ? "source-review-status verified" : "source-review-status"}>{candidate.quoteAvailable ? zh ? "试读成功" : "NAV verified" : zh ? "试读不可用" : "NAV unavailable"}</span>
        </div>
        <h3>{candidate.name}</h3>
        <dl className="source-review-facts">
          <div><dt>{zh ? "价格来源" : "Provider"}</dt><dd>{providerName(candidate.provider)}</dd></div>
          <div><dt>{zh ? "份额类别" : "Share class"}</dt><dd>{candidate.shareClass}</dd></div>
          <div><dt>ISIN</dt><dd>{candidate.instrumentCode}</dd></div>
          <div><dt>{zh ? "币种" : "Currency"}</dt><dd>{candidate.currency}</dd></div>
        </dl>
        <div className="source-review-quote">
          <span>{zh ? "试读净值" : "Trial NAV"}</span>
          {candidate.quoteAvailable ? <><strong>{candidate.price} <small>{candidate.currency}</small></strong><p>{zh ? "净值日期：" : "Valuation date: "}<time dateTime={candidate.priceAsOf}>{candidate.priceAsOf}</time></p></>
            : <p role="status">{zh ? "无法读取近期净值，暂时不能确认。" : "A recent NAV could not be read. Confirmation is unavailable."}</p>}
        </div>
        <a className="source-review-link" href={candidate.identityUrl} target="_blank" rel="noopener noreferrer">{zh ? "打开来源网页 ↗" : "Open source page ↗"}</a>
        <p className="source-review-coverage">{zh ? "可读取近期历史；完整历史覆盖尚未验证。" : "Recent history is available. Complete historical coverage has not been verified."}</p>
        <button type="button" className="source-review-confirm" disabled={busy || !candidate.quoteAvailable} onClick={() => void confirm(candidate.id)}>
          {busy ? zh ? "正在确认并生成回复…" : "Confirming and preparing reply…" : zh ? "确认这个价格源" : "Confirm this price source"}
        </button>
      </section>)}
    </div>
    <p className="source-review-retrieved">{zh ? "查询时间：" : "Checked: "}<time dateTime={review.retrievedAt}>{new Date(review.retrievedAt).toLocaleString(zh ? "zh-CN" : "en-GB", { timeZone: "Europe/Helsinki" })}</time></p>
    {review.sources.length > 0 && <details className="source-review-references"><summary>{zh ? `参考网页（${review.sources.length}）` : `Reference pages (${review.sources.length})`}</summary>
      <p>{zh ? "搜索参考信息；可确认的净值以试读结果为准。" : "Search references. The verified trial above determines the NAV available for confirmation."}</p>
      <ul>{review.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a><p>{source.summary}</p></li>)}</ul>
    </details>}
    {error && <p className="source-review-error" role="alert">{error}</p>}
    <footer className="source-review-actions"><button type="button" disabled={busy} onClick={onCancel}>{zh ? "取消草稿" : "Cancel draft"}</button></footer>
  </section>;
}
