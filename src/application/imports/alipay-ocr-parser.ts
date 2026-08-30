import type { ScreenshotExtraction } from "@/application/imports/vision-extractor";

type ParsedField =
  | "displayName"
  | "instrumentCode"
  | "quantity"
  | "marketValue"
  | "costBasis"
  | "reportedPriorReturn"
  | "reportedPriorReturnPercent"
  | "averageCost"
  | "observedPrice"
  | "priceAsOf";

interface ParsedHolding {
  displayName?: string;
  instrumentCode?: string;
  quantity?: string;
  marketValue?: string;
  costBasis?: string;
  reportedPriorReturn?: string;
  reportedPriorReturnPercent?: string;
  averageCost?: string;
  observedPrice?: string;
  priceAsOf?: string;
}

const fieldLabels: Record<ParsedField, readonly string[]> = {
  displayName: ["基金名称", "产品名称", "基金名", "名称"],
  instrumentCode: ["基金代码", "产品代码", "代码"],
  reportedPriorReturnPercent: [
    "持有收益率",
    "持仓收益率",
    "累计收益率",
    "收益率",
  ],
  reportedPriorReturn: [
    "持有收益",
    "持仓收益",
    "累计收益",
    "累计盈亏",
    "持有盈亏",
  ],
  marketValue: ["持有金额", "持仓金额", "当前市值", "持仓市值", "基金市值"],
  quantity: ["持有份额", "持仓份额", "基金份额", "份额"],
  costBasis: ["历史成本", "持有成本金额", "持仓成本金额", "成本金额", "总成本"],
  averageCost: ["持仓成本价", "持有成本价", "平均成本", "成本净值"],
  observedPrice: ["单位净值", "最新净值", "基金净值", "净值"],
  priceAsOf: ["净值日期", "净值更新日期", "净值更新时间"],
};

const fieldLabelEntries = Object.entries(fieldLabels) as Array<
  [ParsedField, readonly string[]]
>;

const globalDatePattern = /(?:更新日期|数据日期|截至日期|统计日期)/;
const globalTotalPattern = /^(?:总资产|基金总资产|持有总金额|持仓总金额)$/;

export class AlipayOcrParseError extends Error {
  constructor() {
    super("No Alipay fund holdings could be identified in the OCR result.");
    this.name = "AlipayOcrParseError";
  }
}

function cleanText(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`#]/g, "")
    .trim();
}

function normalizeLabel(value: string): string {
  return cleanText(value)
    .replace(/\s/g, "")
    .replace(/[（(][^）)]*[）)]/g, "");
}

function markdownCells(line: string): string[] {
  if (!line.includes("|")) return [];
  return line
    .split("|")
    .map(cleanText)
    .filter(Boolean)
    .filter((cell) => !/^:?-{3,}:?$/.test(cell));
}

function labelledValue(line: string): [string, string] | undefined {
  const cells = markdownCells(line);
  if (cells.length >= 2) return [cells[0]!, cells.slice(1).join(" ")];
  const cleaned = cleanText(line);
  const colon = cleaned.match(/^(.+?)[：:]\s*(.+)$/);
  if (colon) return [colon[1]!.trim(), colon[2]!.trim()];
  const compact = cleaned.replace(/\s/g, "");
  const aliases = fieldLabelEntries
    .flatMap(([, labels]) => labels)
    .toSorted((left, right) => right.length - left.length);
  for (const alias of aliases) {
    if (!compact.startsWith(alias) || compact.length === alias.length) continue;
    const value = compact
      .slice(alias.length)
      .replace(/^[（(][^）)]*[）)]/, "");
    if (value) return [alias, value];
  }
  const globalPrefix = cleaned.match(
    /^(更新日期|数据日期|截至日期|统计日期|总资产|基金总资产|持有总金额|持仓总金额)\s+(.+)$/,
  );
  return globalPrefix ? [globalPrefix[1]!, globalPrefix[2]!.trim()] : undefined;
}

function fieldForLabel(label: string): ParsedField | undefined {
  const normalized = normalizeLabel(label);
  return fieldLabelEntries.find(([, labels]) =>
    labels.includes(normalized)
  )?.[0];
}

function decimalValue(value: string): string | undefined {
  const normalized = value
    .replace(/[¥￥€$,%％\s]/g, "")
    .replace(/,/g, "")
    .replace(/[−—]/g, "-");
  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  return match?.[0]?.replace(/^\+/, "");
}

function isoDate(value: string): string | undefined {
  const match = value.match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}T00:00:00.000Z`;
}

function instrumentCodeMatch(
  value: string,
): { code: string; raw: string } | undefined {
  const direct = value.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
  if (direct) return { code: direct, raw: direct };
  const spaced = value.match(/(?<!\d)(?:\d\s+){5}\d(?!\d)/)?.[0];
  if (!spaced) return undefined;
  return {
    code: spaced.replace(/\s/g, ""),
    raw: spaced,
  };
}

function normalizedFieldValue(
  field: ParsedField,
  value: string,
): string | undefined {
  if (field === "displayName") return cleanText(value);
  if (field === "instrumentCode") {
    return instrumentCodeMatch(value)?.code;
  }
  if (field === "priceAsOf") return isoDate(value);
  return decimalValue(value);
}

function candidateFromInlineFund(line: string): ParsedHolding | undefined {
  const cleaned = cleanText(line);
  const codeMatch = instrumentCodeMatch(cleaned);
  if (!codeMatch) return undefined;
  const name = cleaned
    .replace(/基金代码|产品代码|代码/g, "")
    .replace(codeMatch.raw, "")
    .replace(/[：:|\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    instrumentCode: codeMatch.code,
    ...(name && /[\p{L}]/u.test(name) ? { displayName: name } : {}),
  };
}

function holdingConfidence(
  holding: ParsedHolding,
): "medium" | "high" {
  return holding.displayName &&
    holding.instrumentCode &&
    holding.marketValue &&
    (holding.costBasis || holding.reportedPriorReturn)
    ? "high"
    : "medium";
}

export function parseAlipayHoldingsMarkdown(
  markdown: string,
  options: { sourceAccountHint?: string } = {},
): ScreenshotExtraction {
  const holdings: ParsedHolding[] = [];
  let current: ParsedHolding | undefined;
  let globalAsOf: string | undefined;
  let totalValue: string | undefined;
  let totalReturn: string | undefined;
  let tableHeaders: Array<ParsedField | undefined> | undefined;
  let pendingHeading: string | undefined;
  let pendingField: ParsedField | undefined;

  const flush = () => {
    if (!current) return;
    if (current.displayName || current.instrumentCode) holdings.push(current);
    current = undefined;
  };

  const applyFieldValue = (field: ParsedField, rawValue: string): boolean => {
    const value = normalizedFieldValue(field, rawValue);
    if (!value) return false;
    if (field === "displayName") {
      flush();
      current = { displayName: value };
      pendingHeading = undefined;
      return true;
    }
    if (
      field === "instrumentCode" &&
      current?.instrumentCode &&
      current.instrumentCode !== value
    ) {
      flush();
    }
    current ??= pendingHeading ? { displayName: pendingHeading } : {};
    pendingHeading = undefined;
    current[field] = value;
    return true;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const cells = markdownCells(line);
    if (cells.length > 2) {
      const possibleHeaders = cells.map(fieldForLabel);
      if (
        possibleHeaders.includes("displayName") &&
        possibleHeaders.includes("instrumentCode")
      ) {
        tableHeaders = possibleHeaders;
        continue;
      }
      if (tableHeaders && tableHeaders.length === cells.length) {
        flush();
        current = {};
        tableHeaders.forEach((field, index) => {
          if (!field) return;
          const value = normalizedFieldValue(field, cells[index]!);
          if (value) current![field] = value;
        });
        flush();
        continue;
      }
    }

    const standalone = cleanText(line);
    if (!standalone) continue;
    if (pendingField) {
      const field = pendingField;
      pendingField = undefined;
      if (applyFieldValue(field, standalone)) continue;
    }

    const pair = labelledValue(line);
    if (pair) {
      const [label, rawValue] = pair;
      const normalizedLabel = normalizeLabel(label);
      if (globalDatePattern.test(normalizedLabel)) {
        globalAsOf = isoDate(rawValue) ?? globalAsOf;
        continue;
      }
      if (globalTotalPattern.test(normalizedLabel) && !current) {
        totalValue = decimalValue(rawValue) ?? totalValue;
        continue;
      }
      const field = fieldForLabel(normalizedLabel);
      if (field && applyFieldValue(field, rawValue)) continue;
    }

    const standaloneField = fieldForLabel(standalone);
    if (standaloneField) {
      pendingField = standaloneField;
      continue;
    }

    const inline = candidateFromInlineFund(line);
    if (inline) {
      if (current?.instrumentCode && current.instrumentCode !== inline.instrumentCode) {
        flush();
      }
      current = {
        ...current,
        ...(!inline.displayName && pendingHeading
          ? { displayName: pendingHeading }
          : {}),
        ...inline,
      };
      pendingHeading = undefined;
      continue;
    }

    if (
      standalone.length >= 4 &&
      /[\p{L}]/u.test(standalone) &&
      !/^(?:支付宝基金|我的基金|基金持仓|资产明细|持仓明细)$/.test(standalone)
    ) {
      pendingHeading = standalone;
    }
  }
  flush();

  if (holdings.length === 0) throw new AlipayOcrParseError();

  const warnings = [
    "MinerU OCR output was parsed with Alipay label rules. Verify all values before confirmation.",
  ];
  for (const holding of holdings) {
    const identity = holding.displayName ?? holding.instrumentCode ?? "Holding";
    if (!holding.instrumentCode) warnings.push(`${identity}: fund code was not detected.`);
    if (!holding.quantity) warnings.push(`${identity}: holding units were not detected.`);
    if (!holding.marketValue) warnings.push(`${identity}: current value was not detected.`);
    if (!holding.costBasis && !holding.reportedPriorReturn) {
      warnings.push(`${identity}: cost basis and cumulative return were not detected.`);
    }
  }

  const positions = holdings.map((holding) => ({
    displayName:
      holding.displayName ??
      `Fund ${holding.instrumentCode ?? holdings.indexOf(holding) + 1}`,
    instrumentCode: holding.instrumentCode ?? null,
    quantity: holding.quantity ?? null,
    currency: "CNY",
    marketValue: holding.marketValue ?? null,
    costBasis: holding.costBasis ?? null,
    reportedPriorReturn: holding.reportedPriorReturn ?? null,
    reportedPriorReturnPercent: holding.reportedPriorReturnPercent ?? null,
    averageCost: holding.averageCost ?? null,
    observedPrice: holding.observedPrice ?? null,
    priceAsOf: holding.priceAsOf ?? null,
    confidence: holdingConfidence(holding),
  }));
  const positionDates = positions
    .map((position) => position.priceAsOf)
    .filter((date): date is string => Boolean(date))
    .sort();
  globalAsOf ??= positionDates.at(-1);
  if (!totalReturn && holdings.length === 1) {
    totalReturn = holdings[0]?.reportedPriorReturn;
  }

  return {
    accountName: options.sourceAccountHint ?? "Alipay",
    asOf: globalAsOf ?? null,
    currency: "CNY",
    totalValue: totalValue ?? null,
    reportedPriorReturn: totalReturn ?? null,
    confidence: positions.every((position) => position.confidence === "high")
      ? "high"
      : "medium",
    warnings,
    positions,
  };
}
