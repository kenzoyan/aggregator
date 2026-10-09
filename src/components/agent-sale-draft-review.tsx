"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AgentSaleDraft, SaleDraftFields, SaleDraftHolding } from "@/application/agent-sale-draft";
import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { formatPortfolioSaleMoney, formatPortfolioSaleQuantity } from "@/application/portfolio-sale-presentation";
interface Review {
  reviewToken: string; quantity: string; estimatedQuantity: boolean; possibleDuplicate: boolean;
  preview: { currency: string; quantityAfter: string; netProceeds: string; saleResult: string; externalOutflow: string };
}
export function AgentSaleDraftReview({ conversationId, turnId, draft, language, onConversation, onSaved, disabled, onBusy }: {
  conversationId: string; turnId: string; draft: AgentSaleDraft; language: "en" | "zh-CN";
  disabled?: boolean; onBusy: (busy: boolean) => void;
  onConversation: (conversation: PortfolioAnalystConversation) => void; onSaved: () => void;
}) {
  const zh = language === "zh-CN";
  const [fields, setFields] = useState(draft.fields);
  const [holdings, setHoldings] = useState<SaleDraftHolding[]>([]);
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const savedFields = JSON.stringify(draft.fields);
  useEffect(() => {
    if (JSON.stringify(fields) !== savedFields) {
      setFields(JSON.parse(savedFields) as SaleDraftFields); setReview(undefined); setDuplicateAcknowledged(false);
    }
  }, [savedFields]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/portfolio/analyst/sale?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Holdings unavailable.");
        if (active) setHoldings(data.holdings);
      }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Holdings unavailable."); });
    return () => { active = false; };
  }, [conversationId, turnId]);
  const accounts = [...new Map(holdings.map((holding) => [holding.sourceAccountId, holding.accountName])).entries()];
  const holding = holdings.find((item) => item.sourceAccountId === fields.sourceAccountId && item.instrumentId === fields.instrumentId);
  function change(patch: Partial<SaleDraftFields>) {
    setFields((current) => ({ ...current, ...patch })); setReview(undefined); setDuplicateAcknowledged(false); setError("");
  }
  async function call(method: string, data: object) {
    const response = await fetch("/api/portfolio/analyst/sale", {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, turnId, ...data }),
    });
    const payload = await response.json();
    if (payload.conversation) onConversation(payload.conversation);
    if (!response.ok) throw new Error(payload.conversation
      ? (zh ? "请查看 Agent 的回复，修改后重新核对。" : "See the Agent reply, then review your changes again.")
      : payload.error ?? "Sale draft request failed.");
    return payload;
  }
  async function act(action: "review" | "confirm" | "cancel", event?: FormEvent) {
    event?.preventDefault(); setBusy(true); onBusy(true); setError("");
    try {
      if (action === "cancel") {
        const data = await call("PATCH", { cancel: true }); onConversation(data.conversation);
      } else if (action === "review") {
        const data = await call("PATCH", { fields }); onConversation(data.conversation);
        setReview(await call("PUT", { confirm: false }));
      } else if (review) {
        const data = await call("PUT", { confirm: true, reviewToken: review.reviewToken, duplicateAcknowledged });
        onConversation(data.conversation); onSaved();
      }
    } catch (cause) {
      setReview(undefined);
      setError(cause instanceof Error ? cause.message : "Sale draft request failed.");
    } finally { setBusy(false); onBusy(false); }
  }
  return <section className="home-review-panel" aria-label={zh ? "审核卖出" : "Review sale"}>
    <div className="home-review-panel-heading"><h3>{zh ? "审核卖出" : "Review sale"}</h3></div>
    <form className="account-price-form portfolio-sale-form" onSubmit={(event) => void act("review", event)}>
      <fieldset disabled={busy || disabled}>
        <p>{zh ? "来自卖出截图。核对后再保存；也可以在对话中补充信息。" : "From your sale screenshot. Check before saving, or supply corrections in chat."}</p>
        {draft.extraction.warnings.length > 0 && <ul>{draft.extraction.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <label>{zh ? "投资账户" : "Investment account"}
          <select required value={fields.sourceAccountId} onChange={(event) => change({ sourceAccountId: event.target.value, instrumentId: "" })}>
            <option value="">{zh ? "选择账户" : "Choose account"}</option>
            {accounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>{zh ? "卖出的资产" : "Asset sold"}
          <select required value={fields.instrumentId} onChange={(event) => change({ instrumentId: event.target.value })}>
            <option value="">{zh ? "选择持仓" : "Choose holding"}</option>
            {holdings.filter((item) => item.sourceAccountId === fields.sourceAccountId).map((item) => <option key={item.instrumentId} value={item.instrumentId}>{item.name} · {item.symbol ?? item.currency}</option>)}
          </select>
        </label>
        <div className="sale-input-grid">
          <label>{zh ? "卖出日期" : "Sale date"}<input required type="date" value={fields.date} onChange={(event) => change({ date: event.target.value })} /></label>
          <label>{zh ? "金额" : "Amount"} ({holding?.currency ?? draft.extraction.currency ?? "—"})<input required inputMode="decimal" value={fields.amount} onChange={(event) => change({ amount: event.target.value })} /></label>
        </div>
        <label>{zh ? "这个金额是" : "This amount is"}
          <select value={fields.amountType} onChange={(event) => change({ amountType: event.target.value as "gross" | "net" })}>
            <option value="gross">{zh ? "扣费前成交总额" : "Sale total before fees"}</option>
            <option value="net">{zh ? "扣费后实际到账" : "Actual received after fees"}</option>
          </select>
        </label>
        <div className="sale-input-grid">
          <label>{zh ? "实际卖出份数" : "Actual quantity sold"}<input inputMode="decimal" value={fields.quantity} onChange={(event) => change({ quantity: event.target.value })} />
            {!fields.quantity && <small>{zh ? "有对应日期的基金 NAV 时可估算，否则需要填写。" : "Can be estimated only with a saved fund NAV for this date."}</small>}
          </label>
          <label>{zh ? "手续费（没有则填 0）" : "Fee (enter 0 if none)"}<input required inputMode="decimal" value={fields.fees} onChange={(event) => change({ fees: event.target.value })} /></label>
        </div>
        <label>{zh ? "卖出款去向" : "Sale proceeds"}
          <select required value={fields.destination} onChange={(event) => change({ destination: event.target.value as SaleDraftFields["destination"] })}>
            <option value="">{zh ? "选择去向" : "Choose destination"}</option>
            <option value="investment-account">{zh ? "留在投资账户" : "Keep in investment account"}</option>
            <option value="external-account">{zh ? "转出至外部账户" : "Withdraw to external account"}</option>
          </select>
        </label>
        {fields.destination === "external-account" && <label>{zh ? "外部账户名称" : "External account name"}<input required maxLength={100} value={fields.destinationName} onChange={(event) => change({ destinationName: event.target.value })} /></label>}
        {review && <div className="sale-confirmation" aria-live="polite">
          <table className="sale-summary-table"><caption>{zh ? "确认表" : "Sale summary"}</caption><tbody>
            <tr><th scope="row">{zh ? "资产" : "Asset"}</th><td>{holding?.name}</td></tr>
            <tr><th scope="row">{zh ? "日期" : "Date"}</th><td>{fields.date}</td></tr>
            <tr><th scope="row">{zh ? "卖出份数" : "Quantity sold"}</th><td>{formatPortfolioSaleQuantity(review.quantity, 8)}{review.estimatedQuantity ? (zh ? "（按 NAV 估算）" : " (estimated from NAV)") : ""}</td></tr>
            <tr><th scope="row">{zh ? "实际到账" : "Net received"}</th><td>{formatPortfolioSaleMoney(review.preview.netProceeds, review.preview.currency)}</td></tr>
            <tr><th scope="row">{zh ? "本次盈亏" : "Profit / loss"}</th><td>{formatPortfolioSaleMoney(review.preview.saleResult, review.preview.currency)}</td></tr>
            <tr><th scope="row">{zh ? "剩余份数" : "Quantity remaining"}</th><td>{formatPortfolioSaleQuantity(review.preview.quantityAfter, 8)}</td></tr>
            <tr><th scope="row">{zh ? "资金去向" : "Destination"}</th><td>{fields.destination === "external-account" ? fields.destinationName : holding?.accountName}</td></tr>
            <tr><th scope="row">{zh ? "卖出款计入组合" : "Proceeds in portfolio total"}</th><td>{fields.destination === "external-account" ? (zh ? "不计入" : "Excluded") : (zh ? "作为现金计入" : "Included as cash")}</td></tr>
          </tbody></table>
          {review.possibleDuplicate && <label><input type="checkbox" checked={duplicateAcknowledged} onChange={(event) => setDuplicateAcknowledged(event.target.checked)} />{zh ? "已有相似记录。我已核对 History，确认这是另一笔交易。" : "A similar record exists. I checked History and confirm this is a separate transaction."}</label>}
        </div>}
        {error && <p role="alert" className="error-message">{error}</p>}
        <div className="sale-form-actions">
          <button type="button" className="secondary" onClick={() => void act("cancel")}>{zh ? "取消草稿" : "Cancel draft"}</button>
          {review ? <button type="button" disabled={review.possibleDuplicate && !duplicateAcknowledged} onClick={() => void act("confirm")}>{zh ? "确认保存卖出" : "Confirm sale"}</button>
            : <button type="submit">{zh ? "核对变更" : "Review changes"}</button>}
        </div>
      </fieldset>
    </form>
  </section>;
}
