import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import type { ImportDraftEdit } from "@/application/imports/import-review-editor";
import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";
import { partialImportPreservationWarning } from "@/domain/import-lifecycle-policy";
import { assetTypeLabels, assetTypes } from "@/domain/portfolio/types";

export function AgentImportDraftReview({
  draft,
  targetLabel,
  language,
  busy,
  saveStatus,
  onEdit,
  onAddHolding,
  onConfirm,
}: {
  draft: ImportDraftReadModel;
  targetLabel: string;
  language: PortfolioAnalystLanguage;
  busy: boolean;
  saveStatus?: "saving" | "saved" | "error";
  onEdit: (edit: ImportDraftEdit) => void;
  onAddHolding: () => void;
  onConfirm: () => void;
}) {
  const confirmed = draft.status === "confirmed";
  const missingPriceDates = draft.sourceKind === "screenshot"
    ? draft.portfolio.holdings.filter((holding) => holding.observedPrice && !holding.priceAsOf).length
    : 0;
  return (
    <div className="analyst-turn analyst-import-turn">
      <article className="portfolio-analyst-result analyst-import-draft-summary">
        <div className="analyst-import-draft-heading">
          <strong>{confirmed
            ? (language === "zh-CN" ? "已确认" : "Confirmed")
            : (language === "zh-CN" ? `审核草稿 · ${targetLabel}` : `Review draft · ${targetLabel}`)}</strong>
          <span className={`confidence ${draft.confidence}`}>{draft.confidence}</span>
        </div>
        {draft.warnings.length > 0 && (
          <details className="analyst-import-warnings">
            <summary>{language === "zh-CN" ? `其他审核提示（${draft.warnings.length}）` : `Additional review notes (${draft.warnings.length})`}</summary>
            <ul>{draft.warnings.map((warning, index) => <li key={`${index}:${warning}`}>
              {language === "zh-CN" && warning === partialImportPreservationWarning
                ? "本次仅更新识别到的持仓；其他已确认持仓保持不变。"
                : warning}
            </li>)}</ul>
          </details>
        )}
        <dl className="analyst-import-draft-facts">
          <div>
            <dt>{language === "zh-CN" ? "估值日期" : "Valuation date"}</dt>
            <dd>{confirmed
              ? (draft.portfolio.asOf || (language === "zh-CN" ? "未识别" : "Not detected"))
              : (
                  <>
                    <input
                      aria-label={language === "zh-CN" ? "估值日期" : "Valuation date"}
                      type="date"
                      value={draft.portfolio.asOf.slice(0, 10)}
                      onChange={(event) => onEdit({ type: "update-as-of", value: event.target.value })}
                    />
                    <small className="analyst-import-date-description">
                      {language === "zh-CN" ? "这是账户中持仓的估值日期，不是上传截图的日期。" : "When the account valued these holdings, not when you uploaded the screenshot."}
                    </small>
                    {!draft.portfolio.asOf && <small className="analyst-import-date-help">
                      {language === "zh-CN" ? "请在来源账户核对并填写包含年份的日期后再确认" : "Check the source account and enter the date with its year before confirming"}
                    </small>}
                  </>
                )}</dd>
          </div>
          <div>
            <dt>{language === "zh-CN" ? "持仓" : "Holdings"}</dt>
            <dd>{draft.portfolio.holdings.length}</dd>
          </div>
          {draft.portfolio.portfolioCash && (
            <div>
              <dt>{language === "zh-CN" ? "现金" : "Cash"}</dt>
              <dd className="analyst-import-cash-fields">
                {confirmed ? (
                  <>{draft.portfolio.portfolioCash.amount} {draft.portfolio.portfolioCash.currency}</>
                ) : (
                  <>
                    <input
                      aria-label={language === "zh-CN" ? "现金金额" : "Cash amount"}
                      inputMode="decimal"
                      value={draft.portfolio.portfolioCash.amount}
                      onChange={(event) => onEdit({ type: "update-cash", field: "amount", value: event.target.value })}
                    />
                    <input
                      aria-label={language === "zh-CN" ? "现金币种" : "Cash currency"}
                      maxLength={3}
                      value={draft.portfolio.portfolioCash.currency}
                      onChange={(event) => onEdit({ type: "update-cash", field: "currency", value: event.target.value })}
                    />
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
        {draft.portfolio.holdings.length > 0 && (
          <ol className="analyst-import-holdings">
            {draft.portfolio.holdings.map((holding, index) => (
              <li key={holding.lineId}>
                {confirmed ? (
                  <>
                    <div>
                      <strong>{holding.displayName || holding.instrumentId || (language === "zh-CN" ? "未命名持仓" : "Unnamed holding")}</strong>
                      {holding.instrumentCode && <small>{holding.instrumentCode}</small>}
                    </div>
                    <span>{holding.reportedMarketValue
                      ? `${holding.reportedMarketValue} ${holding.currency}`
                      : `${holding.quantity || "—"} · ${holding.currency || "—"}`}</span>
                  </>
                ) : (
                  <details open>
                    <summary>
                      <span>{holding.displayName || holding.instrumentId || (language === "zh-CN" ? `持仓 ${index + 1}` : `Holding ${index + 1}`)}</span>
                    </summary>
                    <div className="analyst-import-holding-actions">
                      <button type="button" onClick={() => onEdit({ type: "remove-holding", index })}>
                        {language === "zh-CN" ? "删除这项持仓" : "Remove holding"}
                      </button>
                    </div>
                    <div className="analyst-import-field-grid">
                      <AgentImportField label={language === "zh-CN" ? "名称" : "Name"} value={holding.displayName ?? holding.instrumentId} onChange={(value) => onEdit({ type: "update-holding", index, field: "displayName", value })} />
                      <AgentImportField label={language === "zh-CN" ? "代码 / ISIN" : "Code / ISIN"} value={holding.instrumentCode ?? ""} onChange={(value) => onEdit({ type: "update-holding", index, field: "instrumentCode", value })} />
                      <label>{language === "zh-CN" ? "资产类型" : "Asset type"}
                        <select value={holding.assetType ?? ""} onChange={(event) => onEdit({ type: "update-holding", index, field: "assetType", value: event.target.value })}>
                          <option value="">{language === "zh-CN" ? "未知" : "Unknown"}</option>
                          {assetTypes.map((assetType) => <option key={assetType} value={assetType}>{assetTypeLabels[assetType]}</option>)}
                        </select>
                      </label>
                      <AgentImportField label={language === "zh-CN" ? "数量" : "Quantity"} value={holding.quantity} inputMode="decimal" onChange={(value) => onEdit({ type: "update-holding", index, field: "quantity", value })} />
                      <AgentImportField label={language === "zh-CN" ? "币种" : "Currency"} value={holding.currency} onChange={(value) => onEdit({ type: "update-holding", index, field: "currency", value })} />
                      <AgentImportField label={language === "zh-CN" ? "历史成本" : "Cost basis"} value={holding.costBasis} inputMode="decimal" onChange={(value) => onEdit({ type: "update-holding", index, field: "costBasis", value })} />
                      <AgentImportField label={language === "zh-CN" ? "累计收益" : "Prior return"} value={holding.reportedPriorReturn ?? "0"} inputMode="decimal" onChange={(value) => onEdit({ type: "update-holding", index, field: "reportedPriorReturn", value })} />
                      <AgentImportField label={language === "zh-CN" ? "当前价值" : "Current value"} value={holding.reportedMarketValue ?? ""} inputMode="decimal" onChange={(value) => onEdit({ type: "update-holding", index, field: "reportedMarketValue", value })} />
                      <AgentImportField label={language === "zh-CN" ? "最新价格 / 净值" : "Latest price / NAV"} value={holding.observedPrice ?? ""} inputMode="decimal" onChange={(value) => onEdit({ type: "update-holding", index, field: "observedPrice", value })} />
                      <AgentImportField label={language === "zh-CN" ? "价格日期" : "Price date"} value={holding.priceAsOf?.slice(0, 10) ?? ""} type="date" onChange={(value) => onEdit({ type: "update-holding", index, field: "priceAsOf", value })} />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
        {!confirmed && (
          <>
            {missingPriceDates > 0 && <p className="analyst-import-date-help">
              {language === "zh-CN"
                ? `还有 ${missingPriceDates} 项持仓需要填写包含年份的价格日期。`
                : `${missingPriceDates} holding${missingPriceDates === 1 ? " needs" : "s need"} a price date including the year.`}
            </p>}
            <div className="analyst-import-review-actions">
              <span className="analyst-import-save-status" role="status">
                {saveStatus === "saving"
                  ? (language === "zh-CN" ? "正在保存草稿……" : "Saving draft…")
                  : saveStatus === "error"
                    ? (language === "zh-CN" ? "草稿保存失败，请再次修改或重试" : "Draft save failed; edit again to retry")
                    : saveStatus === "saved"
                      ? (language === "zh-CN" ? "草稿已保存" : "Draft saved")
                      : ""}
              </span>
              <button type="button" className="secondary" disabled={busy} onClick={onAddHolding}>
                {language === "zh-CN" ? "+ 添加持仓" : "+ Add holding"}
              </button>
              <button
                type="button"
                disabled={busy || saveStatus === "saving" || saveStatus === "error" || !draft.portfolio.asOf || missingPriceDates > 0 || (draft.portfolio.holdings.length === 0 && !draft.portfolio.portfolioCash)}
                onClick={onConfirm}
              >
                {busy
                  ? (language === "zh-CN" ? "正在确认……" : "Confirming…")
                  : (language === "zh-CN" ? "确认并更新资产" : "Confirm & update assets")}
              </button>
            </div>
          </>
        )}
        <p className="analyst-import-next-step">{confirmed
          ? (language === "zh-CN" ? "导入完成。原始截图没有保存。" : "Import complete. Original screenshots were not saved.")
          : (language === "zh-CN" ? "只有点击确认后，草稿才会更新投资组合。" : "The draft updates your portfolio only after you confirm it.")}</p>
      </article>
    </div>
  );
}

function AgentImportField({
  label,
  value,
  onChange,
  inputMode,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "decimal";
  type?: "text" | "date";
}) {
  return (
    <label>{label}
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
