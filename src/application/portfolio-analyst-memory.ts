export const MAX_PORTFOLIO_ANALYST_MEMORIES = 5;
export const MAX_PORTFOLIO_ANALYST_MEMORY_CHARS = 200;

export interface PortfolioAnalystMemory {
  id: string;
  content: string;
  source: "chat" | "settings";
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioAnalystMemoryStore {
  listPortfolioAnalystMemories(): PortfolioAnalystMemory[];
  readPortfolioAnalystMemory(id: string): PortfolioAnalystMemory | undefined;
  savePortfolioAnalystMemory(memory: PortfolioAnalystMemory): void;
  deletePortfolioAnalystMemory(id: string): void;
}

export function validMemoryContent(content: string): boolean {
  return content.length > 0 && content.length <= MAX_PORTFOLIO_ANALYST_MEMORY_CHARS &&
    !/[\r\n]/.test(content) &&
    !/(password|passcode|api.?key|secret|token|密码|密钥|验证码|口令)/i.test(content) &&
    !/\b\d{6,}\b/.test(content);
}
