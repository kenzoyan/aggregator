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

describe("Markdown answer safety and incremental text", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(AssistantMessageContent, { text }));

  it("turns Markdown blocks into readable content without losing heading or table data", () => {
    const markup = render("## Portfolio summary\n\n> Current snapshot\n\n| Asset | Value |\n| --- | --- |\n| Synthetic fund | EUR 100 |\n\n`EUR` and **total**");
    expect(markup).toContain("<h3>Portfolio summary</h3>");
    expect(markup).toContain("<blockquote>");
    expect(markup).toContain("<td>Synthetic fund</td>");
    expect(markup).toContain("<td>EUR 100</td>");
    expect(markup).toContain("<code>EUR</code>");
    expect(markup).not.toContain("## Portfolio summary");
  });

  it("rejects executable links and raw markup, and does not fetch remote model images", () => {
    const markup = render('[unsafe](javascript:alert%281%29)\n\n![private image](https://example.com/tracker.png)\n\n<img src=x onerror="alert(1)">');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain('src="https://example.com/tracker.png"');
    expect(markup).toContain("unsafe");
    expect(markup).toContain("private image");
    expect(markup).toContain("&lt;img");
  });

  it("keeps links safe and tolerates incomplete streamed Markdown until it is finished", () => {
    const prefixes = ["## Summary\n\n**Par", "## Summary\n\n**Partial**\n\n```text\nEUR", "## Summary\n\n**Partial**\n\n```text\nEUR\n```"];
    for (const prefix of prefixes) {
      expect(() => render(prefix)).not.toThrow();
      expect(render(prefix)).toContain("Summary");
    }
    const markup = render("[Source](https://example.com/source)");
    expect(markup).toContain('href="https://example.com/source"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });
});

it("recovers a heading attached to the salutation without making the entire answer a heading", () => {
  const markup = renderToStaticMarkup(createElement(AssistantMessageContent, {
    text: "Master,## 今天的数据 是的——这是合成数据。\n\n- **状态：**已更新",
  }));
  expect(markup).toContain("<h3>今天的数据</h3>");
  expect(markup).toContain("<p>是的——这是合成数据。</p>");
  expect(markup).not.toContain("## 今天的数据");
});
