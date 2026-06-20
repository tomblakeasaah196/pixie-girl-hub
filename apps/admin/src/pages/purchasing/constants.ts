import type { Tone } from "@/components/ui/primitives";
import type { PoStatus } from "./types";

export const PO_STATUS_META: Record<
  PoStatus,
  { label: string; tone: Tone; isFactory: boolean }
> = {
  draft: { label: "Draft", tone: "neutral", isFactory: false },
  submitted: { label: "Submitted", tone: "warn", isFactory: false },
  approved: { label: "Approved", tone: "info", isFactory: false },
  in_production: { label: "In Production", tone: "accent", isFactory: true },
  quality_check: { label: "Quality Check", tone: "warn", isFactory: true },
  ready_to_ship: { label: "Ready to Ship", tone: "info", isFactory: true },
  in_transit: { label: "In Transit", tone: "info", isFactory: true },
  arrived_lagos: { label: "Arrived Lagos", tone: "warn", isFactory: true },
  cleared_customs: { label: "Cleared Customs", tone: "warn", isFactory: true },
  partially_received: {
    label: "Partially Received",
    tone: "info",
    isFactory: true,
  },
  received: { label: "Received", tone: "success", isFactory: false },
  closed: { label: "Closed", tone: "success", isFactory: false },
  cancelled: { label: "Cancelled", tone: "neutral", isFactory: false },
};

// State machine — what statuses can we go to from each state?
export const PO_NEXT_STATES: Partial<Record<PoStatus, PoStatus[]>> = {
  approved: ["in_production", "ready_to_ship", "in_transit", "cancelled"],
  in_production: ["quality_check", "ready_to_ship", "cancelled"],
  quality_check: ["ready_to_ship", "in_production", "cancelled"],
  ready_to_ship: ["in_transit", "cancelled"],
  in_transit: ["arrived_lagos", "cancelled"],
  arrived_lagos: ["cleared_customs"],
  cleared_customs: ["partially_received", "received"],
  partially_received: ["partially_received", "received", "closed"],
  received: ["closed"],
};

export const FACTORY_TRACKING_STEPS: PoStatus[] = [
  "approved",
  "in_production",
  "quality_check",
  "ready_to_ship",
  "in_transit",
  "arrived_lagos",
  "cleared_customs",
  "received",
];

export const CURRENCIES = [
  { value: "CNY", label: "CNY ¥ — Chinese Yuan" },
  { value: "NGN", label: "NGN ₦ — Naira" },
  { value: "USD", label: "USD $ — US Dollar" },
  { value: "GBP", label: "GBP £ — Pound Sterling" },
];

export const MANUFACTURING_LOCATIONS = [
  { value: "China", label: "China" },
  { value: "North Korea", label: "North Korea" },
  { value: "Vietnam", label: "Vietnam" },
  { value: "India", label: "India" },
  { value: "Other", label: "Other" },
];

export const LACE_TYPES = [
  { value: "13x4", label: "13×4 Lace Front" },
  { value: "13x6", label: "13×6 Lace Front" },
  { value: "4x4", label: "4×4 Lace Closure" },
  { value: "5x5", label: "5×5 Lace Closure" },
  { value: "360", label: "360 Full Lace" },
  { value: "full_lace", label: "Full Lace" },
  { value: "none", label: "No Lace / Machine-made" },
];

export const HAIR_TEXTURES = [
  { value: "straight", label: "Straight" },
  { value: "body_wave", label: "Body Wave" },
  { value: "deep_wave", label: "Deep Wave" },
  { value: "kinky_curly", label: "Kinky Curly" },
  { value: "water_wave", label: "Water Wave" },
  { value: "loose_wave", label: "Loose Wave" },
  { value: "jerry_curl", label: "Jerry Curl" },
];

export const DENSITIES = [
  { value: "130", label: "130%" },
  { value: "150", label: "150%" },
  { value: "180", label: "180%" },
  { value: "200", label: "200%" },
  { value: "250", label: "250%" },
];

export const CAP_SIZES = [
  { value: "S", label: "Small" },
  { value: "M", label: "Medium" },
  { value: "L", label: "Large" },
  { value: "XL", label: "X-Large" },
];
