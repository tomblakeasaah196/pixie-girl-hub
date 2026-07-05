/**
 * Insight severity → display tokens (canon §2: semantic tones, never brand-red
 * for danger). Shared by the module slot and the Insights Center.
 */

import type { Tone } from "@/components/ui/primitives";
import type { InsightSeverity } from "@/lib/insights-api";

export const SEVERITY_TONE: Record<InsightSeverity, Tone> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "info",
};

export const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const RANK: Record<InsightSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Sort so the most urgent surfaces first. */
export function bySeverity<T extends { severity: InsightSeverity }>(
  a: T,
  b: T,
): number {
  return RANK[a.severity] - RANK[b.severity];
}

export function isUrgent(sev: InsightSeverity): boolean {
  return sev === "high" || sev === "critical";
}

/** Human relative time (e.g. "3h ago"). */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
