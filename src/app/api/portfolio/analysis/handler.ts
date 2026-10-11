import { createPortfolioPeriodAnalysis } from "@/application/portfolio-period-analysis";
import { effectiveSourceAccountLabels } from "@/domain/source-accounts";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createStoredPortfolioOverviewReadModel } from "@/server/stored-portfolio-overview";
import { getPortfolioDatabase } from "@/server/portfolio-db";

type AnalysisDatabase = Pick<PortfolioDatabase, "readPortfolioFacts" | "readMarketData" | "readSourceAccounts" | "readSourceAccountLabels">;

export function createPortfolioAnalysisHandler(input: { database: AnalysisDatabase; now?: () => string; logError?: (error: unknown) => void }) {
  return async (request: Request) => {
    const period = new URL(request.url).searchParams.get("period");
    if (period !== "today" && period !== "week" && period !== "month") {
      return Response.json({ error: "Choose today, week or month." }, { status: 400 });
    }
    try {
      const asOf = input.now?.() ?? new Date().toISOString();
      const portfolio = createStoredPortfolioOverviewReadModel({
        facts: input.database.readPortfolioFacts(), marketData: input.database.readMarketData(),
        accountLabels: effectiveSourceAccountLabels(input.database.readSourceAccounts(), input.database.readSourceAccountLabels()), asOf,
      });
      return Response.json({ analysis: createPortfolioPeriodAnalysis(portfolio, period, asOf) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      (input.logError ?? console.error)(error);
      return Response.json({ error: "Could not load the saved period analysis." }, { status: 500 });
    }
  };
}

export async function GET(request: Request) {
  return createPortfolioAnalysisHandler({ database: getPortfolioDatabase() })(request);
}
