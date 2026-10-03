import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssistantMessageContent } from "@/components/assistant-message-content";

describe("assistant message formatting", () => {
  it("renders model emphasis and lists as text content without exposing HTML", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMessageContent, {
      text: "This is **important**.\n\n- **NAV:** 1.3401\n- Date: 09-16\n\n<script>alert(1)</script>",
    }));
    expect(markup).toContain("<strong>important</strong>");
    expect(markup).toContain("<li><strong>NAV:</strong> 1.3401</li>");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
  });
});
