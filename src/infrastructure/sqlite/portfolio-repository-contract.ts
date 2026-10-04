import type { MarketIntelligenceBrief } from "@/application/market-intelligence";
import type { PriceSourceBinding, PriceSourceRefreshStatus } from "@/application/price-source-discovery";
import type {
  PortfolioAnalystConversationStore,
} from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystMemoryStore } from "@/application/portfolio-analyst-memory";
import type { PortfolioNarrativeReport } from "@/application/portfolio-narrative";
import type {
  ConfirmedImportRecord,
  ImportDraftInput,
  ImportDraftReview,
  StoredImportDraft,
} from "@/domain/imports";
import type {
  FxRateObservation,
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import type {
  OpeningSnapshotInput,
  PortfolioEventInput,
  PortfolioState,
} from "@/domain/portfolio/types";
import type {
  CreateSourceAccountDefinitionInput,
  SourceAccountDefinition,
} from "@/domain/source-accounts";

export interface ConfirmedSnapshotRecord {
  snapshot: OpeningSnapshotInput;
  confirmedAt: string;
}

export interface PortfolioFacts {
  openingSnapshots: OpeningSnapshotInput[];
  events: PortfolioEventInput[];
  confirmedImports: ConfirmedImportRecord[];
  confirmedSnapshots: ConfirmedSnapshotRecord[];
  state: PortfolioState;
}

export interface MarketDataHistory {
  observations: MarketPriceObservation[];
  fxObservations: FxRateObservation[];
  latestMarketRefresh?: MarketRefreshRecord;
  marketRefreshHistory?: MarketRefreshRecord[];
}

export interface ConfirmImportCommand {
  draftId: string;
  confirmedImportId: string;
  confirmedAt: string;
  review: ImportDraftReview;
}

export interface PortfolioDatabase extends PortfolioAnalystConversationStore, PortfolioAnalystMemoryStore {
  saveImportDraft(draft: ImportDraftInput): void;
  getImportDraft(id: string): StoredImportDraft | undefined;
  discardImportDraft(id: string): boolean;
  saveImportDraftReview(id: string, review: ImportDraftReview): StoredImportDraft;
  confirmImport(command: ConfirmImportCommand): StoredImportDraft;
  readPortfolioFacts(): PortfolioFacts;
  readMarketData(): MarketDataHistory;
  readPriceSourceBindings(): PriceSourceBinding[];
  savePriceSourceBinding(binding: PriceSourceBinding): void;
  readSourceAccountLabels(): Record<string, string>;
  readSourceAccounts(): SourceAccountDefinition[];
  createSourceAccount(
    input: CreateSourceAccountDefinitionInput,
  ): SourceAccountDefinition;
  deleteSourceAccount(id: string): void;
  recordMarketData(input: {
    observations: readonly MarketPriceObservation[];
    fxObservations?: readonly FxRateObservation[];
    refresh?: MarketRefreshRecord;
    priceSourceStatuses?: readonly PriceSourceRefreshStatus[];
  }): void;
  renameSourceAccount(id: string, label: string): void;
  savePortfolioNarrative(report: PortfolioNarrativeReport): void;
  readLatestPortfolioNarrative(): PortfolioNarrativeReport | undefined;
  saveMarketIntelligenceBrief(brief: MarketIntelligenceBrief): void;
  readLatestMarketIntelligenceBrief(): MarketIntelligenceBrief | undefined;
  close(): void;
}
