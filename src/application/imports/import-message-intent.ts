import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import { parseImportDateAnswer } from "@/application/imports/import-chat-follow-up";

export type ImportMessageDecision =
  | { intent: "confirm" }
  | { intent: "cancel" }
  | { intent: "other" }
  | { intent: "set-date"; field: "valuation-date" | "price-date"; value: string; holdingLineId?: string }
  | { intent: "set-code"; value: string; holdingLineId?: string }
  | { intent: "reply"; reply: string };

export interface ImportMessageInterpreter {
  interpret(input: {
    message: string;
    draft: ImportDraftReadModel;
    recentConversation: Array<{ role: "user" | "assistant"; text: string }>;
    language: "en" | "zh-CN";
    signal?: AbortSignal;
  }): Promise<ImportMessageDecision>;
}

export function resolveImportMessageDecision(
  decision: ImportMessageDecision,
  message: string,
  draft: ImportDraftReadModel,
  language: "en" | "zh-CN",
): ImportMessageDecision {
  const say = (english: string, chinese: string) => language === "zh-CN" ? chinese : english;
  if (decision.intent === "set-date") {
    const ambiguousYearLast = message.match(/\b(\d{1,2})[-/.\s]+(\d{1,2})[-/.\s]+\d{4}\b/);
    if (ambiguousYearLast) {
      const first = Number(ambiguousYearLast[1]);
      const second = Number(ambiguousYearLast[2]);
      if (first <= 12 && second <= 12 && first !== second) {
        return { intent: "reply", reply: say(
          "I can't tell which number is the month. Please write the date with the month name or as YYYY-MM-DD.",
          "我不能确定哪个数字是月份。请写出月份名称，或使用 YYYY-MM-DD。",
        ) };
      }
    }
    const value = parseImportDateAnswer(decision.value);
    if (!value || (decision.field === "price-date" &&
      !draft.portfolio.holdings.some((holding) => holding.lineId === decision.holdingLineId))) {
      return { intent: "reply", reply: say(
        "I couldn't identify a valid date and holding. Please clarify which date you want to change.",
        "我还无法确定有效日期和对应持仓。请说明要修改哪个日期。",
      ) };
    }
    return { ...decision, value };
  }
  if (decision.intent === "set-code") {
    const value = decision.value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(value)) {
      return { intent: "reply", reply: say("I couldn't identify a valid code. Please send the code again.", "我没能确认这个代码，请重新发送。") };
    }
    if (decision.holdingLineId && !draft.portfolio.holdings.some((holding) => holding.lineId === decision.holdingLineId)) {
      return { intent: "reply", reply: say(
        "I couldn't identify that holding in the draft. Which holding should receive the code?",
        "草稿中没有找到对应持仓。这个代码属于哪一项持仓？",
      ) };
    }
    return { ...decision, value };
  }
  return decision;
}
