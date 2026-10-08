import { expect, it } from "vitest";
import { holdingTabForKey } from "@/components/holding-detail-navigation";

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
