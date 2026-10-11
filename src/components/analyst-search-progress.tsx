import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";
import { researchWebsites } from "./analyst-search-progress-model";

export function ResearchWebsiteLinks({ urls, language }: { urls: readonly string[]; language: PortfolioAnalystLanguage }) {
  const sites = researchWebsites(urls);
  if (!sites.length) return null;
  return <ul className="analyst-research-websites" aria-label={language === "zh-CN" ? "搜索来源网址" : "Research websites"}>
    {sites.map((site) => <li key={site.label}><a href={site.url} target="_blank" rel="noopener noreferrer" title={site.url}>{site.label}<span aria-hidden="true"> ↗</span></a></li>)}
  </ul>;
}
