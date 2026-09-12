import type {
  AnalystEvidenceFact,
  FactualUpdate,
  PortfolioAnalystLanguage,
} from "@/application/portfolio-analyst-context";

const eur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function signedEur(value: number): string {
  return `${value >= 0 ? "+" : "−"}${eur.format(Math.abs(value))}`;
}

const periodNames = {
  en: { today: "Today", week: "Week", month: "Month" },
  "zh-CN": { today: "今日", week: "本周", month: "本月" },
} as const;

export function portfolioAnalystActionLabel(
  action: FactualUpdate,
  language: PortfolioAnalystLanguage,
): string {
  switch (action.kind) {
    case "refresh-fx":
      return language === "zh-CN"
        ? `刷新 ${action.currency} 汇率`
        : `Refresh ${action.currency} FX rate`;
    case "record-dated-market-data":
      return language === "zh-CN" ? "补充带日期的市场数据" : "Record dated market data";
    case "configure-danske-route":
      return language === "zh-CN" ? "配置 Danske 数据路线" : "Configure the Danske data route";
    case "retry-market-data-refresh":
      return language === "zh-CN" ? "重试市场数据刷新" : "Retry market data refresh";
  }
}

export function portfolioAnalystLimitationLabel(
  code: "period-unavailable" | "partial-period-coverage" | "portfolio-activity-cause-unknown",
  language: PortfolioAnalystLanguage,
): string {
  const labels = language === "zh-CN" ? {
    "period-unavailable": "所选期间缺少可比较的历史估值。",
    "partial-period-coverage": "所选期间仅有部分持仓具备完整数据。",
    "portfolio-activity-cause-unknown": "系统检测到估算的资产活动，但无法从现有事实确定原因。",
  } : {
    "period-unavailable": "The selected period has no comparable historical valuation.",
    "partial-period-coverage": "Only part of the portfolio has complete data for the selected period.",
    "portfolio-activity-cause-unknown": "Estimated portfolio activity was detected, but its cause is not present in the available facts.",
  };
  return labels[code];
}

export function portfolioAnalystEvidenceValue(
  fact: AnalystEvidenceFact,
  language: PortfolioAnalystLanguage,
): string {
  switch (fact.kind) {
    case "portfolio-total":
      return eur.format(fact.valueEur);
    case "period-performance": {
      const period = periodNames[language][fact.period];
      return [
        period,
        signedEur(fact.changeEur),
        `${fact.percent.toFixed(2)}%`,
        `price ${signedEur(fact.priceEffectEur)}`,
        `FX ${signedEur(fact.fxEffectEur)}`,
        fact.coverage,
        fact.baselineAsOf ? `baseline ${fact.baselineAsOf}` : undefined,
        fact.currentAsOf ? `current ${fact.currentAsOf}` : undefined,
        fact.estimatedPortfolioActivityEur === undefined
          ? undefined
          : `estimated activity ${signedEur(fact.estimatedPortfolioActivityEur)}`,
      ].filter(Boolean).join(" · ");
    }
    case "holding-driver":
      return [
        fact.name ?? (language === "zh-CN" ? "未发送持仓名称" : "Holding name withheld"),
        `current ${eur.format(fact.currentValueEur)}`,
        `contribution ${signedEur(fact.contributionEur)}`,
        `return ${fact.percent.toFixed(2)}%`,
        `${fact.portfolioSharePercent.toFixed(1)}% of portfolio`,
        fact.freshness,
        fact.baselineAsOf ? `baseline ${fact.baselineAsOf}` : undefined,
        fact.currentAsOf ? `current date ${fact.currentAsOf}` : undefined,
      ].filter(Boolean).join(" · ");
    case "quality-summary":
      return `${fact.valuedHoldingCount} valued · ${fact.freshCount} fresh · ${fact.manualCount} manual · ${fact.staleCount} stale · ${fact.awaitingNavCount} awaiting NAV · ${fact.missingInputCount} missing inputs · available periods ${fact.availablePerformancePeriods.join(", ") || "none"}`;
    case "data-gap":
      return [
        fact.category,
        fact.impact,
        fact.name,
        fact.currentValueEur === undefined ? undefined : eur.format(fact.currentValueEur),
        fact.currency,
        fact.period,
        fact.asOf,
      ]
        .filter(Boolean)
        .join(" · ");
    case "refresh-result":
      return `${fact.provider} · ${fact.mode} · completed ${fact.completedAt} · ${fact.updated} updated · ${fact.unchanged} unchanged · ${fact.failed} failed${fact.failureCategories.length ? ` · ${fact.failureCategories.join(", ")}` : ""}`;
    case "portfolio-overview-summary":
      return [
        eur.format(fact.totalValueEur),
        `${fact.investmentPositionCount} ${language === "zh-CN" ? "项持仓" : "positions"}`,
        `${fact.sourceAccountCount} ${language === "zh-CN" ? "个账户" : "accounts"}`,
        fact.topHoldingValueEur === undefined
          ? undefined
          : `${fact.topHoldingName ?? (language === "zh-CN" ? "最大持仓" : "Largest holding")} ${eur.format(fact.topHoldingValueEur)} (${fact.topHoldingSharePercent?.toFixed(1)}%)`,
        `${language === "zh-CN" ? "前三大占比" : "Top three share"} ${fact.topThreeSharePercent.toFixed(1)}%`,
      ].filter(Boolean).join(" · ");
    case "portfolio-allocation": {
      const dimension = language === "zh-CN"
        ? { "holding-currency": "持仓币种", "asset-category": "资产类别", "source-account": "来源账户" }[fact.dimension]
        : { "holding-currency": "Holding currency", "asset-category": "Asset category", "source-account": "Source account" }[fact.dimension];
      const group = fact.group ?? `${language === "zh-CN" ? "第" : "#"}${fact.rank}${language === "zh-CN" ? "大账户" : " account"}`;
      return `${dimension} · ${group} · ${eur.format(fact.valueEur)} · ${fact.sharePercent.toFixed(1)}% · ${fact.holdingCount} ${language === "zh-CN" ? "项" : "holdings"}`;
    }
    case "portfolio-mover":
      return [
        fact.direction === "strongest"
          ? (language === "zh-CN" ? "今日最强" : "Strongest today")
          : (language === "zh-CN" ? "今日最弱" : "Weakest today"),
        fact.name ?? (language === "zh-CN" ? "未发送持仓名称" : "Holding name withheld"),
        signedEur(fact.changeEur),
        `${fact.percent.toFixed(2)}%`,
      ].join(" · ");
  }
}
