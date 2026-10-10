import { expect, it } from "vitest";
import { portfolioAnalystHistory } from "@/server/portfolio-analyst-history";
import { createPortfolioAnalystConversation, type PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";

function conversation(): PortfolioAnalystConversation {
  return { ...createPortfolioAnalystConversation({ id: "chat", provider: "openai", language: "en", includeHoldingNames: true, now: "2026-01-01" }),
    turns: Array.from({ length: 8 }, (_, i) => ({ id: `turn-${i}`, question: `Question ${i}`, createdAt: `2026-01-0${i + 1}`,
      ...(i < 2 ? { attachments: [{ id: `image-${i}`, mimeType: "image/png" as const, byteLength: 1 }] } : {}),
      chat: { assistantText: `Answer ${i}` } })) };
}

it("includes old original images, complete replies and stable image order on each request", async () => {
  const saved = conversation();
  const before = JSON.stringify(saved);
  const read = async (attachment: { id: string }) => new Uint8Array([attachment.id === "image-0" ? 1 : 2]);
  const first = await portfolioAnalystHistory(saved, { read });
  const second = await portfolioAnalystHistory(saved, { read });
  expect(second).toEqual(first);
  expect(first).toHaveLength(16);
  expect(first[0]).toMatchObject({ role: "user", images: [{ data: "AQ==", mimeType: "image/png", id: "image-0" }] });
  expect(first[2]).toMatchObject({ role: "user", images: [{ data: "Ag==", id: "image-1" }] });
  expect(first[2].text).toContain("Image 2: image-1");
  expect(first[1].text).toBe("Answer 0");
  expect(JSON.stringify(saved)).toBe(before);
});

it("keeps failed user input and original image but excludes synthetic failure replies", async () => {
  const saved = conversation();
  saved.turns[0] = { id: saved.turns[0].id, question: saved.turns[0].question,
    createdAt: saved.turns[0].createdAt, attachments: saved.turns[0].attachments,
    chat: { assistantText: "Synthetic error", failureCode: "provider-unavailable" } };
  const history = await portfolioAnalystHistory(saved, { read: async () => new Uint8Array([1]) }, "turn-7");
  expect(history[0]).toMatchObject({ role: "user", images: [{ data: "AQ==" }] });
  expect(history.some((message) => message.text === "Synthetic error")).toBe(false);
  expect(history.some((message) => message.text === "Question 7")).toBe(false);
});

it("reports an unavailable original image instead of silently substituting its old summary", async () => {
  await expect(portfolioAnalystHistory(conversation(), { read: async () => undefined })).rejects.toThrow("Saved image 1 is unavailable");
});
