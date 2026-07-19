import { findSourceAccount } from "@/domain/source-accounts";

export interface Trading212ConnectionConfig {
  apiKey: string;
  apiSecret: string;
  environment: "demo" | "live";
}

export function trading212Environment(): "demo" | "live" {
  return process.env.TRADING212_ENVIRONMENT === "live" ? "live" : "demo";
}

export function getTrading212ConnectionConfig(
  sourceAccountId: string,
): Trading212ConnectionConfig | undefined {
  const account = findSourceAccount(sourceAccountId);
  if (account?.provider !== "trading212") return undefined;

  const apiKey = process.env.TRADING212_API_KEY;
  const apiSecret = process.env.TRADING212_API_SECRET;

  return apiKey && apiSecret
    ? { apiKey, apiSecret, environment: trading212Environment() }
    : undefined;
}
