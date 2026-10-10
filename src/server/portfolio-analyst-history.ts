import { createPortfolioAnalystHistory, type PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { createLocalPortfolioAnalystImageStore, type PortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";

/** Build the full multimodal transcript. Image bytes stay local until this model request. */
export async function portfolioAnalystHistory(conversation: PortfolioAnalystConversation,
  images: Pick<PortfolioAnalystImageStore, "read"> = createLocalPortfolioAnalystImageStore(), excludeTurnId?: string) {
  const history = createPortfolioAnalystHistory({ ...conversation,
    turns: conversation.turns.filter((turn) => turn.id !== excludeTurnId) });
  let imageNumber = 0;
  for (const message of history) {
    if (message.role !== "user" || !message.attachments?.length) continue;
    message.images = [];
    const labels: string[] = [];
    for (const attachment of message.attachments) {
      imageNumber += 1;
      const bytes = await images.read(attachment);
      if (!bytes) throw new Error(`Saved image ${imageNumber} is unavailable. Please attach it again.`);
      labels.push(`Image ${imageNumber}: ${attachment.id}`);
      message.images.push({ id: attachment.id, mimeType: attachment.mimeType, data: Buffer.from(bytes).toString("base64") });
    }
    message.text += `\n[Attached images; sourceTurnId=${message.sourceTurnId}; ${labels.join("; ")}]`;
  }
  return history;
}
