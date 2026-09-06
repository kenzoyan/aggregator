import Decimal from "decimal.js";

import type { HoldingReadModel } from "@/application/portfolio-read-model";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";
import { sourceAccountDashboardLabel } from "@/domain/source-accounts";

export const demoPortfolioStorageKey = "invest-assets-monitor.demo-portfolio.v1";

export interface DemoPortfolioRecord {
  version: 1;
  confirmedAt: string;
  snapshot: OpeningSnapshotInput;
}

const demoEurRates: Readonly<Record<string, string>> = {
  EUR: "1",
  CNY: "0.126",
  USD: "0.92",
  GBP: "1.16",
  DKK: "0.134",
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOpeningSnapshot(value: unknown): value is OpeningSnapshotInput {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (!isString(snapshot.id) || !isString(snapshot.sourceAccountId) || !isString(snapshot.asOf)) return false;
  if (!Array.isArray(snapshot.positions)) return false;
  const positionsAreValid = snapshot.positions.every((position) => {
    if (!position || typeof position !== "object") return false;
    const candidate = position as Record<string, unknown>;
    return isString(candidate.instrumentId)
      && isString(candidate.quantity)
      && isString(candidate.currency)
      && isString(candidate.costBasis)
      && (candidate.reportedPriorReturn === undefined || isString(candidate.reportedPriorReturn));
  });
  if (!positionsAreValid) return false;
  if (snapshot.portfolioCash === undefined) return true;
  if (!snapshot.portfolioCash || typeof snapshot.portfolioCash !== "object") return false;
  const cash = snapshot.portfolioCash as Record<string, unknown>;
  return isString(cash.amount) && isString(cash.currency);
}

export function createDemoPortfolioRecord(input: {
  confirmedAt: string;
  snapshot: OpeningSnapshotInput;
}): DemoPortfolioRecord {
  return { version: 1, ...input };
}

export function parseDemoPortfolioRecord(value: string | null): DemoPortfolioRecord | undefined {
  if (!value) return undefined;
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    if (record.version !== 1 || !isString(record.confirmedAt) || !isOpeningSnapshot(record.snapshot)) {
      return undefined;
    }
    return record as unknown as DemoPortfolioRecord;
  } catch {
    return undefined;
  }
}

function inferCategory(name: string): HoldingReadModel["category"] {
  const normalized = name.toLowerCase();
  if (normalized.includes("bond") || normalized.includes("债")) return "Bond";
  if (normalized.includes("stock") || normalized.includes("equity") || normalized.includes("share")) return "Stock";
  return "Fund";
}

function originalValue(costBasis: string, priorReturn = "0"): Decimal {
  try {
    return new Decimal(costBasis).plus(priorReturn);
  } catch {
    return new Decimal(0);
  }
}

function toEur(value: Decimal, currency: string): number {
  const rate = demoEurRates[currency.toUpperCase()] ?? "1";
  return value.mul(rate).toDecimalPlaces(2).toNumber();
}

function formatMoney(value: Decimal, currency: string): string {
  try {
    return new Intl.NumberFormat("en-FI", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(value.toNumber());
  } catch {
    return `${value.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function toDemoDashboardHoldings(record: DemoPortfolioRecord): HoldingReadModel[] {
  const { snapshot } = record;
  const source = sourceAccountDashboardLabel(snapshot.sourceAccountId);
  const reviewedAt = `Demo review · ${snapshot.asOf.slice(0, 10)}`;
  const positions = snapshot.positions.map((position, index): HoldingReadModel => {
    const value = originalValue(position.costBasis, position.reportedPriorReturn);
    return {
      id: `${snapshot.id}-position-${index}`,
      sourceAccountId: snapshot.sourceAccountId,
      name: position.instrumentId,
      symbol: `DEMO ${index + 1}`,
      source,
      category: inferCategory(position.instrumentId),
      currency: position.currency.toUpperCase(),
      originalValue: formatMoney(value, position.currency),
      eurValue: toEur(value, position.currency),
      changeEur: 0,
      changePercent: 0,
      freshness: "manual",
      asOf: reviewedAt,
    };
  });

  if (snapshot.portfolioCash) {
    const cash = new Decimal(snapshot.portfolioCash.amount);
    positions.push({
      id: `${snapshot.id}-cash`,
      sourceAccountId: snapshot.sourceAccountId,
      name: "Portfolio Cash",
      symbol: "CASH",
      source,
      category: "Portfolio cash",
      currency: snapshot.portfolioCash.currency.toUpperCase(),
      originalValue: formatMoney(cash, snapshot.portfolioCash.currency),
      eurValue: toEur(cash, snapshot.portfolioCash.currency),
      changeEur: 0,
      changePercent: 0,
      freshness: "manual",
      asOf: reviewedAt,
    });
  }

  return positions;
}
