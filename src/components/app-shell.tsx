"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownToLine,
  ChartNoAxesCombined,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { cn } from "@/lib/utils";

const sidebarPreferenceStorageKey = "invest-monitor.sidebar-expanded.v1";
const AppShellModalContext = createContext<Dispatch<SetStateAction<boolean>>>(() => undefined);

export function useAppShellModalState() {
  return useContext(AppShellModalContext);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [homeSection, setHomeSection] = useState<"overview" | "holdings">("overview");

  useEffect(() => {
    try {
      setSidebarExpanded(window.localStorage.getItem(sidebarPreferenceStorageKey) === "true");
    } catch {
      // The compact default remains available when storage is blocked.
    }
  }, []);

  useEffect(() => {
    if (pathname !== "/") return;
    function updateHomeSection() {
      const holdings = document.getElementById("holdings");
      setHomeSection(
        holdings && holdings.getBoundingClientRect().top <= window.innerHeight * 0.35
          ? "holdings"
          : "overview",
      );
    }
    updateHomeSection();
    window.addEventListener("scroll", updateHomeSection, { passive: true });
    window.addEventListener("resize", updateHomeSection);
    return () => {
      window.removeEventListener("scroll", updateHomeSection);
      window.removeEventListener("resize", updateHomeSection);
    };
  }, [pathname]);

  function toggleSidebar() {
    setSidebarExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(sidebarPreferenceStorageKey, String(next));
      } catch {
        // The current layout can still change without persistence.
      }
      return next;
    });
  }

  const overviewActive = pathname === "/" && homeSection === "overview";
  const holdingsActive = pathname === "/" && homeSection === "holdings";
  const items = [
    { href: "/#overview", label: "Overview", icon: LayoutDashboard, active: overviewActive, current: "location" as const },
    { href: "/#holdings", label: "Holdings", icon: ChartNoAxesCombined, active: holdingsActive, current: "location" as const },
    { href: "/accounts", label: "Accounts", icon: WalletCards, active: pathname === "/accounts", current: "page" as const },
    { href: "/imports", label: "Import", icon: ArrowDownToLine, active: pathname === "/imports", current: "page" as const },
    { href: "/settings", label: "Settings", icon: Settings, active: pathname === "/settings", current: "page" as const },
  ];

  return (
    <div className={cn("app-shell", sidebarExpanded ? "sidebar-expanded" : "sidebar-collapsed")}>
      <aside className="sidebar" aria-hidden={navigationBlocked || undefined} inert={navigationBlocked || undefined}>
        <Link className="brand" href="/" aria-label="Invest Monitor overview">
          <span className="brand-mark" aria-hidden="true">I</span>
          <span className="brand-copy"><strong>Invest</strong><small>Private monitor</small></span>
        </Link>
        <nav aria-label="Main navigation">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className={cn("nav-item", item.active && "active")}
                href={item.href}
                aria-current={item.active ? item.current : undefined}
                key={item.href}
              >
                <Icon aria-hidden="true" />{item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
            title={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
            onClick={toggleSidebar}
          >
            {sidebarExpanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
            <span>{sidebarExpanded ? "Collapse" : "Expand"}</span>
          </button>
          <div className="privacy-note"><ShieldCheck aria-hidden="true" /><span><strong>Private by design</strong><small>Confirmed records stay on this device</small></span></div>
        </div>
      </aside>

      <AppShellModalContext.Provider value={setNavigationBlocked}>
        <div className="app-route-content">{children}</div>
      </AppShellModalContext.Provider>

      <nav className="mobile-nav" aria-label="Mobile navigation" aria-hidden={navigationBlocked || undefined} inert={navigationBlocked || undefined}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link className={item.active ? "active" : undefined} href={item.href} aria-current={item.active ? item.current : undefined} key={item.href}>
              <Icon aria-hidden="true" />{item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
