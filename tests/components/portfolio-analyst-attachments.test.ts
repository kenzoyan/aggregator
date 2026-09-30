import { describe, expect, it } from "vitest";

import {
  createAgentComposerSubmission,
  readTextOnlyAgentQuestion,
} from "../../src/components/agent-composer-submission";

interface TestScreenshot {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  bytes: Uint8Array;
}

function screenshot(name: string): TestScreenshot {
  return {
    name,
    size: 3,
    type: "image/png",
    lastModified: 1,
    bytes: new Uint8Array([1, 2, 3]),
  };
}

describe("Agent composer submission boundary", () => {
  it("rejects an empty message with no screenshots", () => {
    expect(createAgentComposerSubmission({ text: "  ", screenshots: [] })).toBeUndefined();
  });

  it("accepts screenshot-only and mixed submissions without copying image bytes", () => {
    const image = screenshot("wechat.png");

    const screenshotOnly = createAgentComposerSubmission({ text: "  ", screenshots: [image] });
    const mixed = createAgentComposerSubmission({ text: " update this ", screenshots: [image] });

    expect(screenshotOnly).toEqual({ text: "", screenshots: [image] });
    expect(screenshotOnly?.screenshots[0]).toBe(image);
    expect(mixed).toEqual({ text: "update this", screenshots: [image] });
  });

  it("allows only screenshot-free submissions through the existing JSON question path", () => {
    const textOnly = createAgentComposerSubmission({ text: " update WeChat ", screenshots: [] });
    const withScreenshot = createAgentComposerSubmission({
      text: "update WeChat",
      screenshots: [screenshot("wechat.png")],
    });

    expect(readTextOnlyAgentQuestion(textOnly)).toBe("update WeChat");
    expect(readTextOnlyAgentQuestion(withScreenshot)).toBeUndefined();
  });
});
