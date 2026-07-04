/**
 * Starter prompts for the Praxis welcome state (drawer + full page).
 *
 * These seed the empty conversation with a first move — the Claude/Gemini
 * "suggestion chip" pattern. Kept read-leaning and safe: every one is a query
 * or a draft, so tapping a suggestion never proposes a write without the
 * confirm gate. Ordered most-broadly-useful first; the drawer shows the top
 * few, the page shows more.
 */

import type { LucideIcon } from "lucide-react";
import {
  FileWarning,
  MessageCircle,
  PackageSearch,
  ReceiptText,
  TrendingUp,
  Users,
} from "lucide-react";

export interface PraxisPrompt {
  /** Short chip label. */
  label: string;
  /** The full message sent when the suggestion is tapped. */
  prompt: string;
  icon: LucideIcon;
}

export const PRAXIS_PROMPTS: PraxisPrompt[] = [
  {
    label: "Best sellers this week",
    prompt: "What sold best this week, and how does it compare to last week?",
    icon: TrendingUp,
  },
  {
    label: "Low stock",
    prompt: "Which products are running low on stock right now?",
    icon: PackageSearch,
  },
  {
    label: "Today at a glance",
    prompt: "Summarise today's orders, payments and anything that needs me.",
    icon: ReceiptText,
  },
  {
    label: "Draft a broadcast",
    prompt:
      "Draft a warm WhatsApp broadcast announcing our new arrivals to VIP customers.",
    icon: MessageCircle,
  },
  {
    label: "Top customers",
    prompt: "Who are my top customers this month by spend?",
    icon: Users,
  },
  {
    label: "Overdue invoices",
    prompt: "Show me overdue invoices and who I should chase first.",
    icon: FileWarning,
  },
];
