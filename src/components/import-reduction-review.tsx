import { findImportReductions } from "@/application/imports/import-reductions";
import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import type { ImportReductionReview } from "@/domain/imports";
import { CashDestinationFields } from "@/components/cash-destination-fields";

export function ImportReductionReviewFields({ draft, onChange, disabled = false, chinese = false }: {
  draft: ImportDraftReadModel;
  onChange: (review: ImportReductionReview) => void;
  disabled?: boolean;
  chinese?: boolean;
}) {
  if (draft.sourceKind !== "screenshot" && draft.sourceKind !== "trading-212") return null;
  const candidates = findImportReductions(draft.portfolio, draft.reconciliation);
  if (candidates.length === 0) return null;
  return <fieldset className="import-reduction-review" disabled={disabled}>
    <legend>{chinese ? "审核持仓减少" : "Review reduced holdings"}</legend>
    <p>{chinese ? "数量减少不一定是卖出。请核对原因；截图或同步没有提供的成交金额和收款账户需要你填写。" : "A lower quantity does not prove a sale. Confirm the reason and fill in sale amounts and destinations that the source did not provide."}</p>
    {candidates.map((candidate) => {
      const saved = draft.portfolio.reductionReviews?.find((review) => review.instrumentId === candidate.instrumentId && review.quantity === candidate.quantity);
      const base = { instrumentId: candidate.instrumentId, quantity: candidate.quantity };
      return <section key={candidate.instrumentId}>
        <strong>{candidate.name} · −{candidate.quantity} {chinese ? "份" : "units"}</strong>
        <label>{chinese ? "原因" : "Reason"}<select value={saved?.kind ?? ""} onChange={(event) => {
          if (event.target.value === "sale") onChange({ ...base, kind: "sale", proceeds: "", fees: "0", destination: { kind: "investment-account" } });
          if (event.target.value === "adjustment") onChange({ ...base, kind: "adjustment", reason: "" });
        }}>
          <option value="" disabled>{chinese ? "请选择" : "Choose a reason"}</option>
          <option value="sale">{chinese ? "卖出／赎回" : "Sale / redemption"}</option>
          <option value="adjustment">{chinese ? "数量修正，不是卖出" : "Quantity correction, not a sale"}</option>
        </select></label>
        {saved?.kind === "sale" && <>
          <label>{chinese ? "成交总额" : "Gross proceeds"} ({candidate.currency})<input required inputMode="decimal" value={saved.proceeds} onChange={(event) => onChange({ ...saved, proceeds: event.target.value })} /></label>
          <label>{chinese ? "手续费" : "Fees"} ({candidate.currency})<input required inputMode="decimal" value={saved.fees} onChange={(event) => onChange({ ...saved, fees: event.target.value })} /></label>
          <CashDestinationFields chinese={chinese} destination={saved.destination} names={[]} onChange={(destination) => onChange({ ...saved, destination })} />
          <small>{draft.portfolio.portfolioCash
            ? (chinese ? "同步或截图提供的现金余额会直接采用，不会重复加上卖出款。" : "The source's cash balance is used directly. Sale proceeds are not added a second time.")
            : (chinese ? "留在投资账户的净收入会加入现金；外部收款不计入追踪总额。" : "Retained net proceeds are added to account cash. External proceeds are excluded from tracked assets.")}</small>
        </>}
        {saved?.kind === "adjustment" && <label>{chinese ? "修正说明" : "Correction note"}<input required maxLength={300} value={saved.reason} onChange={(event) => onChange({ ...saved, reason: event.target.value })} /></label>}
      </section>;
    })}
  </fieldset>;
}
