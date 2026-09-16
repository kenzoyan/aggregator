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
    expect(markup).toContain('class="nav-item active" aria-current="page" href="/accounts"');
    expect(markup).toContain('href="/#holdings"');
    expect(markup).toContain("Account content");
  });
});
