import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import type { ImportDraftEdit } from "@/application/imports/import-review-editor";
import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";

export type ImportDateFollowUp =
  | { field: "valuation-date" }
  | { field: "price-date"; holdingLineId: string; holdingLabel: string; holdingIndex: number };

export type ImportCodeReply =
  | { kind: "edit"; holdingLineId: string; holdingLabel: string; holdingIndex: number; value: string }
  | { kind: "needs-holding"; value: string };

export function nextImportDateFollowUp(draft: ImportDraftReadModel): ImportDateFollowUp | undefined {
  if (draft.status !== "draft" || draft.sourceKind !== "screenshot") return undefined;
  if (!draft.portfolio.asOf) return { field: "valuation-date" };
  const holdingIndex = draft.portfolio.holdings.findIndex((holding) => holding.observedPrice && !holding.priceAsOf);
  if (holdingIndex < 0) return undefined;
  const holding = draft.portfolio.holdings[holdingIndex]!;
  return {
    field: "price-date", holdingLineId: holding.lineId, holdingIndex,
    holdingLabel: holding.displayName || holding.instrumentId || `holding ${holdingIndex + 1}`,
  };
}

export function importDateFollowUpQuestion(
  request: ImportDateFollowUp,
  language: PortfolioAnalystLanguage,
): string {
  return request.field === "valuation-date"
    ? (language === "zh-CN" ? "截图里缺少完整的估值日期。请回复 YYYY-MM-DD（包括年份）。" : "I need the full valuation date. Please reply with YYYY-MM-DD, including the year.")
    : (language === "zh-CN"
        ? `${request.holdingLabel} 的价格日期缺少年份。请回复它的完整日期 YYYY-MM-DD。`
        : `I need the full price date for ${request.holdingLabel}. Please reply with YYYY-MM-DD.`);
}

export function parseImportDateAnswer(text: string): string | undefined {
  const answer = dateReplyText(text);
  let parts: [number, number, number] | undefined;
  const yearFirst = answer.match(/^(\d{4})(?:[-/.\s]+|年)(\d{1,2})(?:[-/.\s]+|月)(\d{1,2})日?$/);
  if (yearFirst) parts = [Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3])];

  const numericYearLast = answer.match(/^(\d{1,2})[-/.\s]+(\d{1,2})[-/.\s]+(\d{4})$/);
  if (!parts && numericYearLast) {
    const first = Number(numericYearLast[1]);
    const second = Number(numericYearLast[2]);
    if (first > 12 && second <= 12) parts = [Number(numericYearLast[3]), second, first];
    if (second > 12 && first <= 12) parts = [Number(numericYearLast[3]), first, second];
    if (first === second && first <= 12) parts = [Number(numericYearLast[3]), first, second];
  }

  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const dayFirst = answer.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/i);
  const monthFirst = answer.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (!parts && (dayFirst || monthFirst)) {
    const monthText = (dayFirst?.[2] ?? monthFirst?.[1] ?? "").toLowerCase();
    const month = monthNames.findIndex((name) => name === monthText || name.slice(0, 3) === monthText || (name === "september" && monthText === "sept")) + 1;
    if (month > 0) {
      parts = dayFirst
        ? [Number(dayFirst[3]), month, Number(dayFirst[1])]
        : [Number(monthFirst![3]), month, Number(monthFirst![2])];
    }
  }

  if (!parts) return undefined;
  const date = `${parts[0].toString().padStart(4, "0")}-${parts[1].toString().padStart(2, "0")}-${parts[2].toString().padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
    ? date : undefined;
}

export function importDateClarificationQuestion(text: string, language: PortfolioAnalystLanguage): string {
  const answer = dateReplyText(text);
  const numericYearLast = answer.match(/^(\d{1,2})[-/.\s]+(\d{1,2})[-/.\s]+(\d{4})$/);
  if (numericYearLast) {
    const first = Number(numericYearLast[1]);
    const second = Number(numericYearLast[2]);
    if (first >= 1 && first <= 12 && second >= 1 && second <= 12 && first !== second) {
      const year = numericYearLast[3];
      const monthFirst = `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
      const dayFirst = `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
      return language === "zh-CN"
        ? `我无法确定 ${answer} 的月日顺序。你是指 ${monthFirst}，还是 ${dayFirst}？请回复其中一个完整日期。`
        : `I can't tell the month and day order in ${answer}. Do you mean ${monthFirst} or ${dayFirst}? Please reply with one full date.`;
    }
  }
  return language === "zh-CN"
    ? "我还不能确定这个完整日期。请换一种写法，例如 2026-10-02；草稿暂时没有修改。"
    : "I couldn't determine the full date. Please write it as 2026-10-02; I haven't changed the draft.";
}

export function parseImportCodeReply(text: string, draft: ImportDraftReadModel): ImportCodeReply | undefined {
  if (draft.status !== "draft" || draft.sourceKind !== "screenshot") return undefined;
  const match = text.match(/(?:\b(?:code\s*\/\s*isin|(?:fund\s+|instrument\s+)?code|isin)\b|(?:基金|证券)?代码)\s*(?:is|=|:|：|是|为)\s*([a-z0-9][a-z0-9._-]{0,31})(?=$|[\s.,!?，。])/i);
  if (!match) return undefined;
  const value = match[1]!.toUpperCase();
  const holdings = draft.portfolio.holdings;
  const mentioned = holdings.map((holding, index) => ({ holding, index })).filter(({ holding }) =>
    holding.displayName && text.includes(holding.displayName)
  );
  const missing = holdings.map((holding, index) => ({ holding, index })).filter(({ holding }) => !holding.instrumentCode);
  const target = mentioned.length === 1 ? mentioned[0]
    : missing.length === 1 ? missing[0]
      : holdings.length === 1 ? { holding: holdings[0]!, index: 0 } : undefined;
  if (!target) return { kind: "needs-holding", value };
  return {
    kind: "edit", holdingLineId: target.holding.lineId, holdingIndex: target.index,
    holdingLabel: target.holding.displayName || target.holding.instrumentId || `holding ${target.index + 1}`,
    value,
  };
}

export function looksLikeImportDateAnswer(text: string): boolean {
  const answer = dateReplyText(text);
  return /^\d{1,4}(?:[-/.\s]+|年)\d{1,2}(?:(?:[-/.\s]+|月)\d{1,4}日?)?$/.test(answer)
    || /^(?:\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+|[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?),?\s+\d{4}$/i.test(answer);
}

function dateReplyText(text: string): string {
  return text.trim().replace(/^(?:the\s+(?:(?:valuation|price|nav)\s+)?date\s*(?:is|was|:)?|日期\s*(?:是|为|[:：]))\s*/i, "").trim();
}

export function importDateFollowUpEdit(request: ImportDateFollowUp, date: string): ImportDraftEdit {
  return request.field === "valuation-date"
    ? { type: "update-as-of", value: date }
    : { type: "update-holding", index: request.holdingIndex, field: "priceAsOf", value: date };
}
