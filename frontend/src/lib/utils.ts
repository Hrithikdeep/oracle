export { cn } from "cn"

const RELATIVE_TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Formats an ISO 8601 timestamp as "updated 5 minutes ago" style relative
 * time. Falls back to "just now" for anything under a minute. */
export function formatRelativeTime(iso: string): string {
  const diffSeconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) return "just now";

  for (const [unit, secondsInUnit] of RELATIVE_TIME_UNITS) {
    if (absSeconds >= secondsInUnit) {
      return relativeTimeFormatter.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return "just now";
}

// Values seen for real in the backend's company_name field that don't
// actually identify a company — "undefined" is a bug artifact from earlier
// test data (a real, non-null string sitting in the DB, so `?? fallback`
// never catches it), "unknown"/"n/a" are genuine placeholder values the
// backend itself returns when company resolution failed. All three read as
// noise next to real company names, so they're normalized the same as null.
const NON_COMPANY_NAMES = new Set(["undefined", "unknown", "n/a", "null", ""]);

/** Normalizes a company_name value — null, empty, or one of a few known
 * non-meaningful placeholder strings — into a single consistent fallback
 * for display. Returns the trimmed original string for any real name. */
export function formatCompanyName(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (NON_COMPANY_NAMES.has(trimmed.toLowerCase())) return "No company";
  return trimmed;
}

/** Builds the /app/chat URL that hands off a company/entity with no
 * existing research data to Chat, pre-filled with a sensible question —
 * the shared "there's no real create action, only start research" escape
 * hatch used by Monitoring's "Add monitor" and Dashboards' "Create
 * dashboard" modals (both back onto the same real capability: starting a
 * new research session). */
export function newResearchChatUrl(entity: string): string {
  return `/app/chat?q=${encodeURIComponent(`Analyze ${entity}'s recent performance`)}`;
}
