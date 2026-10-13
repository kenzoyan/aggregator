import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/accounts" }));

import { AppShell } from "@/components/app-shell";

describe("application shell", () => {
  it("keeps the complete navigation around a routed page and marks it current", () => {
    const markup = renderToStaticMarkup(createElement(
      AppShell,
      null,
      createElement("main", null, "Account content"),
    ));

    expect(markup).toContain('class="app-route-content"');
    const currentLink = markup.match(/<a\b[^>]*class="nav-item active"[^>]*>/)?.[0];
    expect(currentLink).toBeDefined();
    expect(currentLink).toContain('aria-current="page"');
    expect(currentLink).toContain('href="/accounts"');
    expect(markup).toContain('href="/#holdings"');
    expect(markup).toContain("Account content");
    // Icon navigation must remain accessible and interactive while the labels are collapsed.
    const navigation = markup.match(/<aside\b[^>]*id="app-navigation"[^>]*>/)?.[0];
    expect(navigation).toBeDefined();
    expect(navigation).not.toContain("inert");
    expect(navigation).not.toContain('aria-hidden="true"');
  });
});
