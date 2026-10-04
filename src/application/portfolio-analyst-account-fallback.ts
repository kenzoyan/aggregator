import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type {
  AccountHoldingFact,
  AccountHoldingsSummaryFact,
  PortfolioAnalystContextV1,
} from "@/application/portfolio-analyst-contract";

const euro = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
});

export function createAccountHoldingsFallback(
  context: PortfolioAnalystContextV1,
): PortfolioAnalystAnswer | undefined {
  const summary = context.facts.findLast(
    (fact): fact is AccountHoldingsSummaryFact => fact.kind === "account-holdings-summary",
  );
  if (!summary) return undefined;
  const prefix = summary.key.replace(/account\.holdings\.summary$/, "account.holding.");
  const holdings = context.facts.filter(
    (fact): fact is AccountHoldingFact =>
      fact.kind === "account-holding" && fact.key.startsWith(prefix),
  ).slice(0, 2);
  const chinese = context.language === "zh-CN";
  const name = summary.displayName ?? summary.accountType ?? summary.requestedAccount;
  const main = !summary.found
    ? (chinese ? `没有找到 ${name} 账户。请提供账户名称。` : `I could not find the ${name} account. Please provide its name.`)
    : summary.holdingCount === 0
      ? (chinese ? `${name} 目前没有已确认的资产。` : `${name} currently has no confirmed holdings.`)
      : (chinese
          ? `${name} 当前有 ${summary.holdingCount} 项资产，已记录估值合计 ${euro.format(summary.totalValueEur)}。`
          : `${name} has ${summary.holdingCount} current holdings with a recorded value of ${euro.format(summary.totalValueEur)}.`);
  const details = holdings.map((holding, index) => {
    const holdingName = holding.name ?? (chinese ? `资产 ${index + 1}` : `Holding ${index + 1}`);
    return chinese
      ? `${holdingName}：${holding.originalValue}（约 ${euro.format(holding.valueEur)}），${holding.unitPrice ? `已保存单价 ${holding.unitPrice} ${holding.currency}，价格日期 ${holding.priceAsOf ?? holding.asOf}，来源 ${holding.priceSource ?? "未注明"}；` : ""}估值日期 ${holding.asOf}。`
      : `${holdingName}: ${holding.originalValue} (about ${euro.format(holding.valueEur)}), ${holding.unitPrice ? `saved unit price ${holding.unitPrice} ${holding.currency} as of ${holding.priceAsOf ?? holding.asOf} from ${holding.priceSource ?? "unspecified source"}; ` : ""}valued ${holding.asOf}.`;
  });
  const more = summary.holdingCount > holdings.length
    ? (chinese ? "其余资产可在账户页面查看。" : "See the account page for the remaining holdings.")
    : "";
  return {
    factsAsOf: context.factsAsOf,
    answer: {
      text: [main, ...details, more].filter(Boolean).join(" "),
      classification: "fact",
      evidence: [summary.key, ...holdings.map((holding) => holding.key)],
    },
    claims: [],
    limitations: context.limitations,
    proposedUpdate: null,
  };
}
