import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode, type ReactElement } from "react";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next;
    }];
  },
}));

import { PortfolioMemorySettings } from "@/components/portfolio-memory-settings";
import { ReviewDialog } from "@/components/ui/review-dialog";

type Props = { children?: ReactNode; title?: string; open?: boolean; value?: string; onClick?: () => void };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function render() { hooks.cursor = 0; return elements(PortfolioMemorySettings()); }
function button(nodes: ReactElement<Props>[], label: string) {
  const node = nodes.find((item) => item.type === "button" && item.props.children === label);
  if (!node?.props.onClick) throw new Error(`Missing action: ${label}`);
  return node.props.onClick;
}
function initialize() {
  hooks.slots = [[{ id: "demo", content: "Keep answers brief", source: "settings", updatedAt: "2026-10-09T12:00:00Z" }], false, "", false, undefined, undefined, false, ""];
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("memory editing state transitions", () => {
  it("saves an edit with one confirmed request and closes after success", async () => {
    initialize();
    button(render(), "Edit")();
    hooks.slots[2] = "Use separate paragraphs";
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ memory: {
      id: "demo", content: "Use separate paragraphs", source: "settings", updatedAt: "2026-10-09T13:00:00Z",
    } })));
    vi.stubGlobal("fetch", fetch);
    button(render(), "Save memory")();
    await vi.waitFor(() => expect(hooks.slots[6]).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ id: "demo", content: "Use separate paragraphs", source: "settings", confirm: true });
    expect(hooks.slots[3]).toBe(false);
    expect(hooks.slots[0]).toEqual([expect.objectContaining({ content: "Use separate paragraphs" })]);
  });
  it("retains the editor and text on failure, and deletion waits for confirmation", async () => {
    initialize();
    button(render(), "Edit")();
    hooks.slots[2] = "Use separate paragraphs";
    const fetch = vi.fn().mockRejectedValue(new Error("Synthetic network failure"));
    vi.stubGlobal("fetch", fetch);
    button(render(), "Save memory")();
    await vi.waitFor(() => expect(hooks.slots[6]).toBe(false));
    expect(hooks.slots[2]).toBe("Use separate paragraphs");
    expect(hooks.slots[3]).toBe(true);
    expect(hooks.slots[7]).toBe("Synthetic network failure");
    hooks.slots[3] = false;
    button(render(), "Delete")();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(render().find((node) => node.type === ReviewDialog && node.props.title === "Delete memory?")?.props.open).toBe(true);
  });
});
