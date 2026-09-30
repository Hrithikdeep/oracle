"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  MessageSquare,
  FolderKanban,
  FileText,
  Library,
  BarChart3,
  ShieldAlert,
  FileBarChart,
  LayoutDashboard,
  Activity,
  Building2,
  UserCircle,
  ChevronsLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/app", icon: Home },
  { label: "Chat", href: "/app/chat", icon: MessageSquare },
  { label: "Projects", href: "/app/projects", icon: FolderKanban },
  { label: "Documents", href: "/app/documents", icon: FileText },
  { label: "Knowledge", href: "/app/knowledge", icon: Library },
  { label: "Analysis", href: "/app/analysis", icon: BarChart3 },
  { label: "Risk", href: "/app/risk", icon: ShieldAlert },
  { label: "Reports", href: "/app/reports", icon: FileBarChart },
  { label: "Dashboards", href: "/app/dashboards", icon: LayoutDashboard },
  { label: "Monitoring", href: "/app/monitoring", icon: Activity },
];

const SETTINGS_ITEMS: NavItem[] = [
  { label: "Organization", href: "/app/organization", icon: Building2 },
  { label: "User profile", href: "/app/profile", icon: UserCircle },
];

function NavLink({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-border text-text-primary"
          : "text-text-muted hover:bg-border/50 hover:text-text-primary"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex-1 overflow-y-auto px-2 py-4">
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} active={pathname === item.href} />
          ))}
        </nav>

        <Separator className="my-4 bg-border" />

        <div>
          {!collapsed && <p className="font-mono-label px-3 pb-2">SETTINGS</p>}
          <nav className="flex flex-col gap-1">
            {SETTINGS_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} collapsed={collapsed} active={pathname === item.href} />
            ))}
          </nav>
        </div>
      </div>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-text-muted transition-colors hover:bg-border/50 hover:text-text-primary"
        >
          <ChevronsLeft className={cn("h-4 w-4 shrink-0 transition-transform", collapsed && "rotate-180")} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
