"use client";

import { MotionConfig } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownToLine,
  ChartNoAxesCombined,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  WalletCards,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { cn } from "@/lib/utils";

const AppShellModalContext = createContext<Dispatch<SetStateAction<boolean>>>(() => undefined);

export function useAppShellModalState() {
  return useContext(AppShellModalContext);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [homeSection, setHomeSection] = useState<"overview" | "holdings">("overview");

  useEffect(() => {
    if (!sidebarExpanded) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarExpanded(false);
        navigationToggle.current?.focus();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [sidebarExpanded]);

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
    setSidebarExpanded((current) => !current);
  }

  const overviewActive = pathname === "/" && homeSection === "overview";
  const holdingsActive = pathname === "/" && homeSection === "holdings";
  const items = [
    { href: "/#overview", label: "Overview", icon: LayoutDashboard, active: overviewActive, current: "location" as const },
    { href: "/#holdings", label: "Holdings", icon: ChartNoAxesCombined, active: holdingsActive, current: "location" as const },
    { href: "/accounts", label: "Accounts", icon: WalletCards, active: pathname === "/accounts" || pathname.startsWith("/accounts/"), current: "page" as const },
    { href: "/imports", label: "Import", icon: ArrowDownToLine, active: pathname === "/imports", current: "page" as const },
    { href: "/settings", label: "Settings", icon: Settings, active: pathname === "/settings", current: "page" as const },
  ];

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 380, damping: 34 }}>
    <div className={cn("app-shell", sidebarExpanded && !navigationBlocked ? "sidebar-expanded" : "sidebar-collapsed")}>
      <button ref={navigationToggle} type="button" className="navigation-launcher" aria-label={sidebarExpanded ? "Collapse navigation" : "Expand navigation"} title={sidebarExpanded ? "Collapse navigation" : "Expand navigation"} aria-expanded={sidebarExpanded && !navigationBlocked} aria-controls="app-navigation" disabled={navigationBlocked} onClick={toggleSidebar}>
        {sidebarExpanded ? <PanelLeftClose size={20} aria-hidden="true" /> : <PanelLeftOpen size={20} aria-hidden="true" />}
      </button>
      <aside id="app-navigation" className="sidebar" aria-hidden={navigationBlocked || undefined} inert={navigationBlocked || undefined}>
        <div className="brand">
          <Image className="brand-mark" src="/brand/aggrigator-icon-192.png" alt="" width={38} height={38} />
          <span className="brand-copy"><strong>Aggrigator</strong><small>All your investments, together</small></span>
        </div>
        <nav id="app-navigation-links" aria-label="Main navigation">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className={cn("nav-item", item.active && "active")}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                onClick={() => {
                  if (!sidebarExpanded) return;
                  setSidebarExpanded(false);
                  navigationToggle.current?.focus();
                }}
                aria-current={item.active ? item.current : undefined}
                key={item.href}
              >
                <Icon aria-hidden="true" /><span className="nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <AppShellModalContext.Provider value={setNavigationBlocked}>
        <div className="app-route-content"><div className="app-page-frame">{children}</div></div>
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
    </MotionConfig>
  );
}
