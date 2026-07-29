/**
 * WhatsApp call store — the live-call state machine on the client.
 *
 *   incoming[]      ringing calls surfaced to THIS agent (brand + owner
 *                   rooms, push, and reconciliation reads — deduped by call_id)
 *   active          the one call this tab is on (claim → connecting → live)
 *   pendingOutcome  a completed call awaiting its mandatory disposition
 *   handled         calls this tab has already dealt with (answered, declined,
 *                   or watched end) — the guard that stops a reconciliation
 *                   read or a late push from resurrecting a ring the agent
 *                   just dismissed
 *   inlineChannels  channels whose thread is on screen right now; a ring for
 *                   one of them renders IN the conversation instead of as a
 *                   corner toast, so the two never double up
 *
 * The heavy lifting (rooms, WebRTC, API calls) lives in
 * components/calls/CallLayer.tsx — this store only holds state so any
 * surface (SmartComm, customer 360) can read call status.
 */

import { create } from "zustand";
import type { CallRing } from "@/lib/calls-api";

export type ActivePhase = "connecting" | "live";

export interface ActiveCall {
  call_id: string;
  /** Brand the call belongs to — NOT necessarily the tab's active brand. */
  brand: string;
  caller_name?: string | null;
  from_number?: string | null;
  contact_id?: string | null;
  channel_id?: string | null;
  /** epoch ms when we answered — drives the duration ticker. */
  answered_at: number;
  muted: boolean;
  phase: ActivePhase;
}

export interface PendingOutcome {
  call_id: string;
  brand: string;
  caller_name?: string | null;
  duration_seconds: number;
}

/** Cap on how many handled call ids we remember (plenty for one session). */
const HANDLED_LIMIT = 50;

interface CallState {
  incoming: CallRing[];
  active: ActiveCall | null;
  pendingOutcome: PendingOutcome | null;
  handled: string[];
  inlineChannels: string[];
  /** The ring currently mid-answer, so every surface can disable its buttons. */
  answeringId: string | null;
  /** True when the browser refused to play the ringtone (autoplay policy). */
  soundBlocked: boolean;
  setAnsweringId: (callId: string | null) => void;
  setSoundBlocked: (blocked: boolean) => void;
  addIncoming: (ring: CallRing) => void;
  removeIncoming: (callId: string) => void;
  /** Drop the ring AND remember it, so nothing re-adds it. */
  dismissIncoming: (callId: string) => void;
  isHandled: (callId: string) => boolean;
  setActive: (call: ActiveCall | null) => void;
  patchActive: (patch: Partial<ActiveCall>) => void;
  setPendingOutcome: (p: PendingOutcome | null) => void;
  registerInlineChannel: (channelId: string) => void;
  unregisterInlineChannel: (channelId: string) => void;
}

export const useCallStore = create<CallState>()((set, get) => ({
  incoming: [],
  active: null,
  pendingOutcome: null,
  handled: [],
  inlineChannels: [],
  answeringId: null,
  soundBlocked: false,
  setAnsweringId: (answeringId) => set({ answeringId }),
  setSoundBlocked: (soundBlocked) => set({ soundBlocked }),
  addIncoming: (ring) =>
    set((s) =>
      s.incoming.some((r) => r.call_id === ring.call_id) ||
      s.handled.includes(ring.call_id)
        ? s
        : { incoming: [...s.incoming, ring] },
    ),
  removeIncoming: (callId) =>
    set((s) => ({ incoming: s.incoming.filter((r) => r.call_id !== callId) })),
  dismissIncoming: (callId) =>
    set((s) => ({
      incoming: s.incoming.filter((r) => r.call_id !== callId),
      handled: s.handled.includes(callId)
        ? s.handled
        : [...s.handled, callId].slice(-HANDLED_LIMIT),
    })),
  isHandled: (callId) => get().handled.includes(callId),
  setActive: (active) => set({ active }),
  patchActive: (patch) =>
    set((s) => (s.active ? { active: { ...s.active, ...patch } } : s)),
  setPendingOutcome: (pendingOutcome) => set({ pendingOutcome }),
  registerInlineChannel: (channelId) =>
    set((s) =>
      s.inlineChannels.includes(channelId)
        ? s
        : { inlineChannels: [...s.inlineChannels, channelId] },
    ),
  unregisterInlineChannel: (channelId) =>
    set((s) => ({
      inlineChannels: s.inlineChannels.filter((c) => c !== channelId),
    })),
}));

/** Rings for a specific conversation — the in-thread banner's input. */
export function useRingsForChannel(channelId?: string | null): CallRing[] {
  return useCallStore((s) =>
    channelId ? s.incoming.filter((r) => r.channel_id === channelId) : [],
  );
}

/** The live call, but only when it belongs to this conversation. */
export function useActiveCallForChannel(
  channelId?: string | null,
): ActiveCall | null {
  return useCallStore((s) =>
    channelId && s.active?.channel_id === channelId ? s.active : null,
  );
}
