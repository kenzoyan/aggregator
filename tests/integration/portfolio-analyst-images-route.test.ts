import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { createPortfolioAnalystImageHandlers } from "@/app/api/portfolio/analyst/images/handler";
import type {
  PortfolioAnalystConversation,
  PortfolioAnalystConversationStore,
  PortfolioAnalystImageAttachment,
} from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";
import type { PortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";

function fixtures() {
  let conversation: PortfolioAnalystConversation = {
    version: "portfolio-analyst-conversation.v1",
    id: "conversation-1", provider: "openai", language: "en",
    includeHoldingNames: true, createdAt: "2026-09-09T10:00:00.000Z",
    updatedAt: "2026-09-09T10:00:00.000Z", importActivities: [],
    turns: [{
      id: "turn-1", question: "Analyze this screenshot",
      createdAt: "2026-09-09T10:00:00.000Z", report: {} as PortfolioAnalystReport,
    }],
  };
  const bytes = new Map<string, Uint8Array>();
  const conversations: PortfolioAnalystConversationStore = {
    readLatestPortfolioAnalystConversation: () => conversation,
    readPortfolioAnalystConversation: (id) => id === conversation.id ? conversation : undefined,
    savePortfolioAnalystConversation: (next) => { conversation = next; },
    deletePortfolioAnalystConversation: () => undefined,
  };
  const images: PortfolioAnalystImageStore = {
    save: async (attachment, contents) => { bytes.set(attachment.id, contents); },
    read: async (attachment) => bytes.get(attachment.id),
    delete: async (attachment) => { bytes.delete(attachment.id); },
  };
  return { conversations, images, bytes, current: () => conversation };
}

async function imageRequest(type = "image/png") {
  const png = await sharp({ create: {
    width: 2, height: 2, channels: 3, background: "red",
  } }).png().toBuffer();
  const form = new FormData();
  form.set("conversationId", "conversation-1");
  form.set("turnId", "turn-1");
  form.set("userText", "Please check this holding");
  form.append("images", new File([png], "synthetic.png", { type }));
  return new Request("http://localhost/api/portfolio/analyst/images", {
    method: "POST", body: form,
  });
}

describe("Portfolio Agent images", () => {
  it("saves a visible image message before analysis and fills in the answer later", async () => {
    const fixture = fixtures();
    let receivedQuestion = "";
    let receivedBytes = 0;
    const handlers = createPortfolioAnalystImageHandlers({
      ...fixture,
      imageModel: "synthetic-vision-model",
      imageQuestion: async (input) => {
        receivedQuestion = input.question;
        receivedBytes = input.images[0]?.bytes.byteLength ?? 0;
        return { answer: "The image shows a synthetic balance.", uncertainties: [] };
      },
    });
    const request = await imageRequest();
    const form = await request.formData();
    form.delete("turnId");
    form.set("language", "en");
    form.set("includeHoldingNames", "true");
    const response = await handlers.ASK(new Request(request.url, { method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect(receivedQuestion).toBe("");
    expect(fixture.current().turns.at(-1)).toMatchObject({
      userText: "Please check this holding",
      attachments: [{ mimeType: "image/png" }],
      imageAnswer: { status: "pending", text: "" },
    });
    const turnId = fixture.current().turns.at(-1)!.id;
    const completion = await handlers.COMPLETE(turnId, new Request("http://localhost/complete", { method: "POST" }));
    expect(completion.status).toBe(200);
    expect(receivedQuestion).toBe("Please check this holding");
    expect(receivedBytes).toBeGreaterThan(0);
    expect(fixture.current().turns.at(-1)).toMatchObject({
      userText: "Please check this holding",
      attachments: [{ mimeType: "image/png" }],
      imageAnswer: { status: "complete", text: "The image shows a synthetic balance." },
    });
  });

  it("keeps the sent image and allows retry when analysis fails", async () => {
    const fixture = fixtures();
    let attempts = 0;
    const handlers = createPortfolioAnalystImageHandlers({
      ...fixture,
      imageModel: "synthetic-vision-model",
      imageQuestion: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("Synthetic provider error");
        return { answer: "Recovered answer.", uncertainties: [] };
      },
    });
    const request = await imageRequest();
    const form = await request.formData();
    form.set("language", "en");
    form.set("includeHoldingNames", "true");
    const response = await handlers.ASK(new Request(request.url, { method: "POST", body: form }));
    expect(response.status).toBe(200);
    const turnId = fixture.current().turns.at(-1)!.id;
    const failed = await handlers.COMPLETE(turnId, new Request("http://localhost/complete", { method: "POST" }));
    expect(failed.status).toBe(200);
    expect(fixture.current().turns.at(-1)?.imageAnswer?.status).toBe("failed");
    expect(fixture.bytes.size).toBe(1);
    await handlers.COMPLETE(turnId, new Request("http://localhost/complete", { method: "POST" }));
    expect(fixture.current().turns.at(-1)?.imageAnswer?.text).toBe("Recovered answer.");
  });

  it("persists a separate image message and preserves the earlier assistant reply", async () => {
    const fixture = fixtures();
    const handlers = createPortfolioAnalystImageHandlers({
      ...fixture, createId: () => "11111111-1111-4111-8111-111111111111",
    });
    const upload = await handlers.POST(await imageRequest());
    expect(upload.status).toBe(200);
    expect(fixture.current().turns[0]).toMatchObject({
      id: "turn-1", question: "Analyze this screenshot", report: {},
    });
    expect(fixture.current().turns[0]?.attachments).toBeUndefined();
    expect(fixture.current().turns[1]).toMatchObject({
      userText: "Please check this holding",
      importImage: { sourceTurnId: "turn-1" },
      attachments: [{ id: "11111111-1111-4111-8111-111111111111", mimeType: "image/png" }],
    });
    const loaded = await handlers.GET("11111111-1111-4111-8111-111111111111");
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get("content-type")).toBe("image/png");
    expect((await loaded.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await handlers.GET("22222222-2222-4222-8222-222222222222")).status).toBe(404);
    expect((await handlers.POST(await imageRequest())).status).toBe(409);
  });

  it("rejects a file whose declared type disagrees with its bytes", async () => {
    const fixture = fixtures();
    const handlers = createPortfolioAnalystImageHandlers(fixture);
    expect((await handlers.POST(await imageRequest("image/jpeg"))).status).toBe(415);
    expect(fixture.current().turns).toHaveLength(1);
    expect(fixture.bytes.size).toBe(0);
  });

  it("removes already written images when another write fails", async () => {
    const fixture = fixtures();
    let writes = 0;
    const originalSave = fixture.images.save;
    fixture.images.save = async (attachment: PortfolioAnalystImageAttachment, bytes: Uint8Array) => {
      writes += 1;
      if (writes === 2) throw new Error("Synthetic disk error");
      await originalSave(attachment, bytes);
    };
    const request = await imageRequest();
    const form = await request.formData();
    const original = form.get("images") as File;
    form.append("images", original);
    const handlers = createPortfolioAnalystImageHandlers({
      ...fixture, createId: () => writes === 0
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
    });
    const response = await handlers.POST(new Request(request.url, { method: "POST", body: form }));
    expect(response.status).toBe(500);
    expect(fixture.bytes.size).toBe(0);
    expect(fixture.current().turns).toHaveLength(1);
  });
});
