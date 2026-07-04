import { io, type Socket } from "socket.io-client";
import { clientBrand } from "./brand";
import type { ProductCard } from "./storefront";

/**
 * Shade Finder (Praxis Shade Match) client.
 *
 * Public — no account. A guest session token (returned by POST /session)
 * authenticates the follow-up calls AND the /public Socket.io namespace,
 * which streams "Praxis is thinking…" stages. The HTTP response always
 * carries the full result, so a dead socket only costs the live animation.
 *
 * The photo goes up as multipart and is analysed in memory server-side —
 * never stored. That promise (`privacy`) is surfaced verbatim in the UI.
 */

// ── Types (mirror shade-finder.service.js shapes) ───────────

export interface ShadeSwatch {
  name: string;
  hex?: string | null;
}

export interface ShadeRef {
  shade_id: string;
  name: string;
  slug: string;
  short_description?: string | null;
  cover_image_url?: string | null;
  product_count?: number;
  swatches: ShadeSwatch[];
  deeplink: string;
}

export interface ShadeProduct extends ProductCard {
  colours?: ShadeSwatch[];
  deeplink: string;
}

export interface ShadeQuota {
  used: number;
  limit: number;
  remaining: number;
  resets_in_seconds: number;
}

/** A validated brand reference — always a real storefront route. */
export interface ShadeReference {
  key: string;
  label: string;
  href: string;
  kind: string;
}

export interface ShadeResult {
  message: string;
  confidence: "low" | "medium" | "high";
  followup_question: string | null;
  shade: ShadeRef | null;
  alternates: ShadeRef[];
  products: ShadeProduct[];
  references?: ShadeReference[];
  perceived?: { undertone: string; depth: number; lighting: string };
  quota: ShadeQuota;
  privacy: string;
}

export interface ShadeSession {
  session_id: string;
  guest_token: string;
  expires_in_seconds: number;
  privacy: string;
  quota: ShadeQuota;
  shades: ShadeRef[];
}

export interface ShadeSessionState {
  history: { role: "user" | "assistant"; content: string }[];
  last_result: Omit<ShadeResult, "quota" | "privacy"> | null;
  has_photo_analysis: boolean;
  quota: ShadeQuota;
  privacy: string;
}

export type ShadeStage =
  | "reading_photo"
  | "matching_shades"
  | "picking_styles"
  | "thinking"
  | "done"
  | "error"
  | "ended";

// ── Device id (anonymous quota key; not tracking) ───────────

const DEVICE_KEY = "sf_device_id";
export function deviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// ── Raw fetch (multipart needs its own path; api.ts is JSON-only) ──

class ShadeApiError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
export function isQuotaError(e: unknown): boolean {
  return e instanceof ShadeApiError && e.code === "QUOTA_EXCEEDED";
}
export function isSessionExpired(e: unknown): boolean {
  return (
    e instanceof ShadeApiError &&
    (e.code === "SESSION_EXPIRED" || e.code === "GUEST_AUTH_REQUIRED")
  );
}

async function sfFetch<T>(
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Brand-Context": clientBrand() ?? "pixiegirl",
    "X-Device-Id": deviceId(),
  };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`/api/public/shade-finder${path}`, {
      method,
      headers,
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
    });
  } catch {
    throw new ShadeApiError("NETWORK", 0, "We couldn't reach Praxis. Check your connection and retry.");
  }
  let json: { data?: T; error?: { code?: string; userMessage?: string; message?: string } } | null = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new ShadeApiError(
      json?.error?.code ?? `HTTP_${res.status}`,
      res.status,
      json?.error?.userMessage ?? json?.error?.message ?? "Something went wrong — please try again.",
    );
  }
  return (json?.data ?? json) as T;
}

// ── API surface ─────────────────────────────────────────────

export const startShadeSession = () => sfFetch<ShadeSession>("POST", "/session");

export const getShadeSession = (sid: string, token: string) =>
  sfFetch<ShadeSessionState>("GET", `/session/${sid}`, { token });

export const endShadeSession = (sid: string, token: string) =>
  sfFetch<{ deleted: boolean; message: string }>("DELETE", `/session/${sid}`, { token });

export function analyzePhoto(
  sid: string,
  token: string,
  photo: File,
  message?: string,
): Promise<ShadeResult> {
  const form = new FormData();
  form.append("photo", photo);
  form.append("consent", "true");
  if (message) form.append("message", message);
  return sfFetch<ShadeResult>("POST", `/session/${sid}/analyze`, { token, form });
}

export const sendChat = (sid: string, token: string, message: string) =>
  sfFetch<ShadeResult>("POST", `/session/${sid}/chat`, { token, json: { message } });

// ── Live socket (progressive enhancement) ───────────────────

export function connectShadeSocket(
  guestToken: string,
  handlers: {
    onStage?: (stage: ShadeStage) => void;
    onReply?: (result: Omit<ShadeResult, "quota" | "privacy">) => void;
  },
): Socket {
  const socket = io("/public", {
    auth: { token: guestToken },
    transports: ["websocket", "polling"],
    reconnectionAttempts: 3,
  });
  socket.on("shade:stage", (p: { stage: ShadeStage }) => handlers.onStage?.(p.stage));
  socket.on(
    "shade:reply",
    (p: { result: Omit<ShadeResult, "quota" | "privacy"> }) => handlers.onReply?.(p.result),
  );
  return socket;
}
