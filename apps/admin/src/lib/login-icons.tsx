import {
  Award,
  Diamond,
  Gem,
  Globe2,
  HeartHandshake,
  type LucideIcon,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";

/**
 * Resolve a DB-stored (kebab-case) lucide icon name from login_config
 * standards to a component. Unknown names fall back to Sparkles so a
 * mistyped seed never crashes the login page.
 */
const MAP: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "heart-handshake": HeartHandshake,
  gem: Gem,
  "trending-up": TrendingUp,
  award: Award,
  "shield-check": ShieldCheck,
  star: Star,
  diamond: Diamond,
  globe: Globe2,
};

export function loginIcon(name: string | undefined): LucideIcon {
  if (!name) return Sparkles;
  return MAP[name.toLowerCase()] ?? Sparkles;
}
