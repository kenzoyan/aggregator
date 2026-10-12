import { expect, it } from "vitest";
import { accountDetailBackLink, accountDetailHref, holdingTabForKey } from "@/components/holding-detail-navigation";

it("returns to the entry page with a safe default for direct account links", () => {
  expect(accountDetailBackLink("holdings")).toEqual({ href: "/#holdings", label: "← Overview" });
  expect(accountDetailBackLink("overview")).toEqual({ href: "/#overview", label: "← Overview" });
  for (const from of [undefined, "accounts", "https://example.com", ["holdings", "overview"]]) {
    expect(accountDetailBackLink(from)).toEqual({ href: "/accounts", label: "← All accounts" });
  }
});

it("retains the homepage origin when selecting another holding and encodes identifiers", () => {
  const href = accountDetailHref("account/one", "holding & two", "holdings");
  const url = new URL(href, "https://local.test");
  expect(url.pathname).toBe("/accounts/account%2Fone");
  expect(url.searchParams.get("holding")).toBe("holding & two");
  expect(accountDetailBackLink(url.searchParams.get("from") ?? undefined).href).toBe("/#holdings");
  expect(accountDetailHref("a", undefined, "overview")).toBe("/accounts/a?from=overview");
  expect(accountDetailHref("a", "b")).toBe("/accounts/a?holding=b");
  expect(accountDetailHref("a", "b", "https://example.com")).toBe("/accounts/a?holding=b");
});

it("navigates holding sections with arrow keys, including wrapping at either end", () => {
  expect(holdingTabForKey("overview", "ArrowRight")).toBe("market");
  expect(holdingTabForKey("market", "ArrowRight")).toBe("overview");
  expect(holdingTabForKey("overview", "ArrowLeft")).toBe("market");
  expect(holdingTabForKey("market", "ArrowLeft")).toBe("overview");
});

it("supports Home and End without intercepting other keyboard actions", () => {
  expect(holdingTabForKey("market", "Home")).toBe("overview");
  expect(holdingTabForKey("overview", "End")).toBe("market");
  for (const key of ["Tab", "Enter", "ArrowDown", "Escape"]) expect(holdingTabForKey("overview", key)).toBeUndefined();
});
