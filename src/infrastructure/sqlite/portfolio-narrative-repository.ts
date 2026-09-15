import type { DatabaseSync } from "node:sqlite";

import type { PortfolioNarrativeReport } from "@/application/portfolio-narrative";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";

type PortfolioNarrativeRepository = Pick<
  PortfolioDatabase,
  "savePortfolioNarrative" | "readLatestPortfolioNarrative"
>;

export function createPortfolioNarrativeRepository(
  database: DatabaseSync,
): PortfolioNarrativeRepository {
  const insertNarrative = database.prepare(`
    INSERT INTO portfolio_narratives (
      id, provider, model, language, generated_at, portfolio_as_of,
      facts_fingerprint, content_json, provenance_json, disclaimer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectLatestNarrative = database.prepare(`
    SELECT id, provider, model, language, generated_at, portfolio_as_of,
      facts_fingerprint, content_json, provenance_json, disclaimer
    FROM portfolio_narratives
    ORDER BY generated_at DESC, rowid DESC
    LIMIT 1
  `);

  return {
    savePortfolioNarrative(report) {
      insertNarrative.run(
        report.id,
        report.provider,
        report.model,
        report.language,
        report.generatedAt,
        report.portfolioAsOf,
        report.factsFingerprint,
        JSON.stringify({
          headline: report.headline,
          overview: report.overview,
          observations: report.observations,
          dataQuality: report.dataQuality,
        }),
        JSON.stringify(report.provenance),
        report.disclaimer,
      );
    },

    readLatestPortfolioNarrative() {
      const row = selectLatestNarrative.get() as {
        id: string;
        provider: PortfolioNarrativeReport["provider"];
        model: string;
        language: PortfolioNarrativeReport["language"];
        generated_at: string;
        portfolio_as_of: string;
        facts_fingerprint: string;
        content_json: string;
        provenance_json: string;
        disclaimer: string;
      } | undefined;
      if (!row) return undefined;
      const content = JSON.parse(row.content_json) as Pick<
        PortfolioNarrativeReport,
        "headline" | "overview" | "observations" | "dataQuality"
      >;
      return {
        id: row.id,
        provider: row.provider,
        model: row.model,
        language: row.language,
        generatedAt: row.generated_at,
        portfolioAsOf: row.portfolio_as_of,
        factsFingerprint: row.facts_fingerprint,
        provenance: JSON.parse(row.provenance_json) as PortfolioNarrativeReport["provenance"],
        disclaimer: row.disclaimer,
        ...content,
      };
    },
  };
}
