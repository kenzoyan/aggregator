import { bindingMatchesPosition, discoverPriceSourceCandidates } from "@/application/price-source-discovery";
import { currentPriceSourcePosition, type PriceSourceDatabase, type createPriceSourceService } from "@/application/price-source-service";
import type { WebResearchResult } from "@/application/portfolio-web-research";
import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";

export interface PriceSourceResearch {
  search(input: { isin: string; name: string; currency: string; language: PortfolioAnalystLanguage; signal?: AbortSignal }): Promise<WebResearchResult>;
}
export interface AgentPriceSourceReview {
  status: "pending" | "saved" | "cancelled";
  state: "verified" | "adapter-required" | "identity-unmatched" | "unavailable" | "already-confirmed";
  sourceAccountId: string;
  instrumentId: string;
  instrumentCode: string;
  instrumentName: string;
  currency: string;
  retrievedAt: string;
  candidates: Awaited<ReturnType<ReturnType<typeof createPriceSourceService>["lookup"]>>["candidates"];
  sources: WebResearchResult["findings"];
  researchStatus?: WebResearchResult["status"];
  binding?: import("@/application/price-source-discovery").PriceSourceBinding;
  confirmationReplyTurnId?: string;
  coverage: "bounded-history" | "latest-only";
}

export function createAgentPriceSourceDiscovery(input: {
  database: PriceSourceDatabase;
  service: ReturnType<typeof createPriceSourceService>;
  research: PriceSourceResearch;
  now?: () => string;
}) {
  return async (args: { sourceAccountId: string; instrumentId: string; language: PortfolioAnalystLanguage; signal?: AbortSignal }): Promise<AgentPriceSourceReview> => {
    const current = currentPriceSourcePosition(input.database, args.sourceAccountId, args.instrumentId);
    if (!current) throw new Error("Holding was not found. Read the current holdings before selecting a source.");
    const position = current.position;
    const base = { sourceAccountId: position.sourceAccountId, instrumentId: position.instrumentId,
      instrumentCode: position.instrumentCode ?? "", instrumentName: position.displayName ?? "", currency: position.currency,
      retrievedAt: input.now?.() ?? new Date().toISOString(), candidates: [], sources: [],
      coverage: discoverPriceSourceCandidates(position, current.provider)[0]?.coverage ?? "bounded-history" as const };
    const binding = input.database.readPriceSourceBindings().find((item) => bindingMatchesPosition(item, position));
    if (binding) return { ...base, state: "already-confirmed", status: "saved", binding };
    if (position.assetType !== "fund" || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(base.instrumentCode)) {
      return { ...base, state: "identity-unmatched", status: "cancelled" };
    }
    let research: WebResearchResult;
    try {
      research = await input.research.search({ isin: base.instrumentCode, name: base.instrumentName,
        currency: base.currency, language: args.language, signal: args.signal });
    } catch (error) {
      if (args.signal?.aborted) throw error;
      research = { status: "unavailable", findings: [], retrievedAt: base.retrievedAt };
    }
    if (args.signal?.aborted) throw new Error("Discovery was cancelled");
    const assertUnchanged = () => {
      const latest = currentPriceSourcePosition(input.database, args.sourceAccountId, args.instrumentId)?.position;
      if (!latest || latest.instrumentCode !== position.instrumentCode || latest.currency !== position.currency || latest.displayName !== position.displayName || latest.assetType !== position.assetType) {
        throw new Error("The holding changed during source discovery. Read it again.");
      }
    };
    assertUnchanged();
    const lookup = await input.service.lookup(args);
    if (args.signal?.aborted) throw new Error("Discovery was cancelled");
    assertUnchanged();
    if (lookup.binding) return { ...base, state: "already-confirmed", status: "saved", binding: lookup.binding };
    const state = lookup.candidates.some((candidate) => candidate.quoteAvailable) ? "verified"
      : lookup.candidates.length || research.status === "unavailable" ? "unavailable"
      : research.findings.length ? "adapter-required" : "identity-unmatched";
    return { ...base, state, status: state === "verified" || state === "adapter-required" ? "pending" : "cancelled",
      candidates: lookup.candidates, sources: research.findings, researchStatus: research.status, retrievedAt: research.retrievedAt };
  };
}
