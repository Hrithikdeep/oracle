// Shared ResearchSession.status classification — reused by the Home page's
// stat cards and the Projects list page's filter tabs so "active" means the
// exact same thing in both places, never redefined twice.

import type { Materiality } from "./types";

// HIGH-to-LOW ordering, reused wherever a "worst materiality across several
// rows" needs computing (Risk page's heatmap, Monitoring's per-company risk
// pill) instead of every page redefining its own severity ranking.
export const MATERIALITY_ORDER: Materiality[] = ["HIGH", "MEDIUM", "LOW"];

// Every non-terminal status — everything else (COMPLETED,
// COMPLETED_WITH_LIMITATIONS, FAILED, CANCELLED) is a finished session.
export const ACTIVE_STATUSES = new Set([
  "CREATED",
  "PLANNING",
  "RESEARCHING",
  "ANALYZING",
  "VERIFYING",
  "ASSESSING",
  "SYNTHESIZING",
]);

// FAILED and CANCELLED are terminal but deliberately NOT "completed" —
// they show up under "All" but not under either the Active or Completed tab.
export const COMPLETED_STATUSES = new Set(["COMPLETED", "COMPLETED_WITH_LIMITATIONS"]);

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isCompletedStatus(status: string): boolean {
  return COMPLETED_STATUSES.has(status);
}

export function statusDotColor(status: string): string {
  if (status === "COMPLETED") return "bg-emerald-500";
  if (status === "COMPLETED_WITH_LIMITATIONS") return "bg-amber-500";
  if (status === "FAILED" || status === "CANCELLED") return "bg-red-500";
  return "bg-blue-500"; // any active/in-progress status
}

export function formatStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Tailwind classes for a materiality pill (HIGH/MEDIUM/LOW). Shared between
 * the Home page's Risk Watch sidebar and the Project Detail page's Risk tab. */
export function materialityClasses(materiality: string): string {
  if (materiality === "HIGH") return "bg-red-500/10 text-red-400";
  if (materiality === "MEDIUM") return "bg-amber-500/10 text-amber-400";
  return "bg-emerald-500/10 text-emerald-400";
}
