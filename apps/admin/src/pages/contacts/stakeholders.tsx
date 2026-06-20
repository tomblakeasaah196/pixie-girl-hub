// ──────────────────────────────────────────────────────────────────────────
// Stakeholder model — single source of truth for the Contacts module.
//
// Pixie Girl Hub serves several *kinds* of person/organisation from one
// `shared.contacts` table (contact_type is a TEXT[]). Each kind feels unique:
// it shows in its own Directory tab, opens to its own set of profile tabs, and
// is created through its own flow. Ambassadors are an OVERLAY (the
// `is_ambassador` flag) — a client (or anyone) can also be an ambassador, so
// they keep a badge wherever they appear AND surface in the Ambassadors tab.
//
// Phase 1 (this PR) wires Clients · Employees · Suppliers · Subscribers.
// Phase 2 adds the Stylist-Partner programme and the Ambassador overlay — the
// defs live here already so Phase 2 is purely additive.
// ──────────────────────────────────────────────────────────────────────────
import {
  User,
  Briefcase,
  Truck,
  Bell,
  Scissors,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ContactType } from "./types";
import type { Tone } from "@/components/ui/primitives";

/** Profile tab keys. Universal tabs show for everyone; the rest are gated. */
export type ProfileTabKey =
  | "overview"
  | "timeline"
  | "tasks"
  | "calendar"
  | "notes"
  | "documents"
  | "addresses"
  | "audit"
  // client-only
  | "deals"
  | "invoices"
  | "concierge"
  | "preferences"
  | "loyalty"
  // employee-only
  | "employment"
  // supplier-only
  | "purchasing"
  // subscriber-only
  | "subscription"
  // phase 2
  | "programme"
  | "ambassador";

/** How a stakeholder of this kind is created. */
export type CreateMode =
  | "modal" // quick add + full form modal
  | "onboarding" // dedicated full-page wizard (employees)
  | "promote" // overlay applied to an existing contact (ambassadors)
  | "external"; // set up in another module (stylist programme)

export interface StakeholderDef {
  /** Stable key. For most this equals the contact_type; ambassador is special. */
  key: ContactType | "ambassador";
  /** The contact_type[] membership this maps to, or null for the overlay. */
  contactType: ContactType | null;
  label: string; // singular, e.g. "Client"
  plural: string; // tab label, e.g. "Clients"
  icon: LucideIcon;
  tone: Tone; // Pill tone
  ring: string; // hex used for avatar ring / dot
  blurb: string; // empty-state / header copy
  /** Can be created from the lightweight Quick Add modal? */
  quickAdd: boolean;
  createMode: CreateMode;
  /** Type-specific profile tabs, appended to the universal set. */
  profileTabs: ProfileTabKey[];
  /** Shipped & wired in Phase 1? (false → Directory tab deferred to Phase 2) */
  phase1: boolean;
}

/** Universal tabs every contact gets, in order, before the type-specific ones. */
export const UNIVERSAL_TABS: ProfileTabKey[] = [
  "overview",
  "timeline",
  "tasks",
  "calendar",
];
/** Universal tabs that come AFTER the type-specific ones. */
export const UNIVERSAL_TABS_TAIL: ProfileTabKey[] = [
  "notes",
  "documents",
  "addresses",
  "audit",
];

export const STAKEHOLDERS: Record<string, StakeholderDef> = {
  customer: {
    key: "customer",
    contactType: "customer",
    label: "Client",
    plural: "Clients",
    icon: User,
    tone: "accent",
    ring: "#690909",
    blurb: "The people you sell to — their orders, preferences and loyalty.",
    quickAdd: true,
    createMode: "modal",
    profileTabs: ["deals", "invoices", "concierge", "preferences", "loyalty"],
    phase1: true,
  },
  staff: {
    key: "staff",
    contactType: "staff",
    label: "Employee",
    plural: "Employees",
    icon: Briefcase,
    tone: "info",
    ring: "#7a8fa8",
    blurb: "Your team — onboarded with role, schedule and pay in HR.",
    quickAdd: false, // employees go through full onboarding, never quick add
    createMode: "onboarding",
    profileTabs: ["employment"],
    phase1: true,
  },
  supplier: {
    key: "supplier",
    contactType: "supplier",
    label: "Supplier",
    plural: "Suppliers",
    icon: Truck,
    tone: "success",
    ring: "#8b9d77",
    blurb: "Vendors you buy from — POs and bills live in Procurement.",
    quickAdd: true,
    createMode: "modal",
    profileTabs: ["purchasing"],
    phase1: true,
  },
  subscriber: {
    key: "subscriber",
    contactType: "subscriber",
    label: "Subscriber",
    plural: "Subscribers",
    icon: Bell,
    tone: "neutral",
    ring: "#60a5fa",
    blurb: "Everyone who signed up to the newsletter lands here.",
    quickAdd: true,
    createMode: "modal",
    profileTabs: ["subscription"],
    phase1: true,
  },
  // ── Phase 2 ──────────────────────────────────────────────────────────────
  stylist_partner: {
    key: "stylist_partner",
    contactType: "stylist_partner",
    label: "Stylist Partner",
    plural: "Stylist Partners",
    icon: Scissors,
    tone: "warn",
    ring: "#b76e79",
    blurb: "Partners under the stylist programme — tiers, payouts, assignments.",
    quickAdd: false,
    createMode: "external",
    profileTabs: ["programme"],
    phase1: true,
  },
  ambassador: {
    key: "ambassador",
    contactType: null, // overlay — driven by the is_ambassador flag
    label: "Ambassador",
    plural: "Ambassadors",
    icon: Sparkles,
    tone: "accent",
    ring: "#c9a86c",
    blurb: "Clients and fans who promote us — commission and attribution.",
    quickAdd: false,
    createMode: "promote",
    profileTabs: ["ambassador"],
    phase1: true,
  },
};

/** Directory tab order. "all" is synthesised in the UI. */
export const DIRECTORY_ORDER: (keyof typeof STAKEHOLDERS)[] = [
  "customer",
  "staff",
  "supplier",
  "subscriber",
  "stylist_partner",
  "ambassador",
];

/** Tabs shown in the Directory for the current phase. */
export function directoryTabs(includePhase2 = false): StakeholderDef[] {
  return DIRECTORY_ORDER.map((k) => STAKEHOLDERS[k]).filter(
    (d) => includePhase2 || d.phase1,
  );
}

/** Look up the def for a contact_type value (label/icon/tone for badges). */
export function stakeholderForType(t: ContactType): StakeholderDef | undefined {
  return STAKEHOLDERS[t];
}

/**
 * Compute the ordered, de-duplicated profile tabs for a contact given the set
 * of types it holds, plus the two overlays (ambassador flag, stylist record).
 * This is what makes the profile "dynamic" — a Client sees
 * Deals/Preferences/Loyalty, an Employee sees Employment, a Supplier sees
 * Purchasing, and a Client-who-is-also-Ambassador sees both their client tabs
 * and the Ambassador tab. The stylist Programme tab shows whenever the contact
 * is enrolled as a stylist partner, even if their contact_type isn't tagged.
 */
export function profileTabsFor(
  types: ContactType[],
  overlays: { isAmbassador?: boolean; isStylist?: boolean } = {},
): ProfileTabKey[] {
  const out: ProfileTabKey[] = [...UNIVERSAL_TABS];
  const seen = new Set<ProfileTabKey>(out);
  const push = (k: ProfileTabKey) => {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  for (const t of types) {
    const def = STAKEHOLDERS[t];
    if (def) def.profileTabs.forEach(push);
  }
  if (overlays.isStylist) STAKEHOLDERS.stylist_partner.profileTabs.forEach(push);
  if (overlays.isAmbassador) STAKEHOLDERS.ambassador.profileTabs.forEach(push);
  UNIVERSAL_TABS_TAIL.forEach(push);
  return out;
}

export const PROFILE_TAB_LABELS: Record<ProfileTabKey, string> = {
  overview: "Overview",
  timeline: "Activity",
  tasks: "Tasks",
  calendar: "Calendar",
  notes: "Notes",
  documents: "Documents",
  addresses: "Addresses & tags",
  audit: "Audit",
  deals: "Deals",
  invoices: "Invoices",
  concierge: "Concierge",
  preferences: "Preferences",
  loyalty: "Loyalty",
  employment: "Employment",
  purchasing: "Purchasing",
  subscription: "Subscription",
  programme: "Programme",
  ambassador: "Ambassador",
};
