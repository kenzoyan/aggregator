const storageKey = "invest-monitor.agent-panel.v1";

// Resolve storage inside the guard: browsers can deny access to localStorage itself.
export function readAgentPanelCollapsed(storage: () => Pick<Storage, "getItem">): boolean {
  try {
    return storage().getItem(storageKey) === "collapsed";
  } catch {
    return false;
  }
}

export function saveAgentPanelCollapsed(storage: () => Pick<Storage, "setItem">, collapsed: boolean): void {
  try {
    storage().setItem(storageKey, collapsed ? "collapsed" : "expanded");
  } catch {
    // The panel can still be toggled when this browser cannot save preferences.
  }
}
