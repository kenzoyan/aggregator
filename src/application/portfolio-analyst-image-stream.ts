import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";

export type PortfolioAnalystImageStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "completed"; conversation: PortfolioAnalystConversation; error?: string }
  | { type: "failed"; error: string };

export async function consumePortfolioAnalystImageStream(
  response: Response,
  onEvent: (event: PortfolioAnalystImageStreamEvent) => void,
): Promise<void> {
  if (!response.ok || !response.body) throw new Error("The image response could not be opened.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line) onEvent(JSON.parse(line) as PortfolioAnalystImageStreamEvent);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as PortfolioAnalystImageStreamEvent);
}
