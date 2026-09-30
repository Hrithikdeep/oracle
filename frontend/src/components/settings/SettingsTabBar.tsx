"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Only Profile and Organization are real pages — everything else here has no
// backend behind it at all (no Organization model, no multi-user/Members
// system, no roles, no auth). Rendered as visibly disabled, not as dead
// links or fabricated content.
const REAL_TABS = [
  { label: "Profile", href: "/app/profile" },
  { label: "Organization", href: "/app/organization" },
];

const DISABLED_TABS = [
  "Members",
  "Roles & Permissions",
  "Security",
  "Integrations",
  "Notifications",
  "Activity",
];

export function SettingsTabBar() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border">
      {REAL_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-text-primary text-text-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
      {DISABLED_TABS.map((label) => (
        <button
          key={label}
          type="button"
          disabled
          title="Coming soon — multi-user accounts aren't built yet."
          className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-text-muted opacity-50 disabled:cursor-not-allowed"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
