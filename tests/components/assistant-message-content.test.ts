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

it("keeps holding names readable without following internal model links", () => {
  const markup = renderToStaticMarkup(createElement(AssistantMessageContent, {
    text: "查看 [Synthetic holding](/accounts/synthetic?holding=test) 和 [section](#holdings)。",
  }));
  expect(markup).toContain("Synthetic holding");
  expect(markup).toContain("section");
  expect(markup).not.toContain("href=");
});

describe("internal evidence citation display", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(AssistantMessageContent, { text }));

  it("hides inline and standalone tool evidence identifiers while keeping the answer", () => {
    const markup = render("## Current assets\n\nSynthetic total **EUR 100**. [call1.overview.overview.summary]\n[call1.account1.account.holdings.summary]\n\n## Allocation\n\nFunds 80%. [call1.overview.overview.category.1] [call1.overview.overview.currency.1]\n\n- Synthetic holding: EUR 80 [call1.account1.account.holding.1]");
    expect(markup).not.toContain("call1.");
    expect(markup).toContain("Synthetic total");
    expect(markup).toContain("<strong>EUR 100</strong>");
    expect(markup).toContain("Funds 80%.");
    expect(markup).toContain("Synthetic holding: EUR 80");
  });

  it("hides a grouped evidence citation without removing surrounding data", () => {
    const markup = render("EUR 100 [call1.overview.summary, call2.account.holding.1] remains saved.");
    expect(markup).not.toContain("call1.");
    expect(markup).not.toContain("call2.");
    expect(markup).toContain("EUR 100");
    expect(markup).toContain("remains saved.");
  });

  it("does not flash incomplete evidence identifiers during streaming", () => {
    for (const suffix of ["[call1.", "[call1.overview", "[call1.overview.summary", "[call1.overview.summary, call2."]) {
      const markup = render(`Synthetic total EUR 100. ${suffix}`);
      expect(markup).not.toContain("call1.");
      expect(markup).toContain("Synthetic total EUR 100.");
    }
  });

  it("preserves ordinary brackets, source links, and literal code examples", () => {
    const markup = render("[Important] Keep [2026] and [calligraphy].\n\n[call1.overview.summary](https://example.com/source)\n\n`[call1.overview.summary]`\n\n```text\n[call1.overview.summary]\n```");
    expect(markup).toContain("[Important]");
    expect(markup).toContain("[2026]");
    expect(markup).toContain("[calligraphy]");
    expect(markup).toContain('href="https://example.com/source"');
    expect(markup).toContain("<code>[call1.overview.summary]</code>");
    expect(markup).toContain('<code class="language-text">[call1.overview.summary]');
  });
});

it("renders Chinese emphasis ending with punctuation without exposing delimiters", () => {
  const markup = renderToStaticMarkup(createElement(AssistantMessageContent, { text: '已生成。**草稿待确认，来源尚未启用。**请在右侧确认。\n\n`**保留原样。**请`' }));
  expect(markup).toContain('<strong>草稿待确认，来源尚未启用</strong>。请');
  expect(markup).toContain('<code>**保留原样。**请</code>');
});

it("hides Chinese-bracket internal evidence and tool markers while preserving normal text and code", () => {
  const markup = renderToStaticMarkup(createElement(AssistantMessageContent, { text: '请确认。【call1.account2.account.holding.1】【call1.account2.account.holdings.summary】【discover_price_source】\n\n【重要】保留。`【discover_price_source】`' }));
  expect(markup).not.toContain('call1.account2');
  expect(markup).not.toContain('请确认。【discover_price_source】');
  expect(markup).toContain('【重要】保留');
  expect(markup).toContain('<code>【discover_price_source】</code>');
});


it("hides internal model citation envelopes, including streamed prefixes, without deleting external references", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(AssistantMessageContent, { text }));
  const markup = render("试读成功。citecall2.account1.account.holding.1call1.account.1\n\n`citecall1.account.1`\n\n外部引用：citeexternal-source");
  expect(markup).not.toContain("试读成功。cite");
  expect(markup).toContain("<code>citecall1.account.1</code>");
  expect(markup).toContain("external-source");
  expect(render("试读成功。citecall2.account1")).not.toContain("call2.account1");
});
