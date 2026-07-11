/**
 * WhatsApp call store — the live-call state machine on the client.
 *
 *   incoming[]      ringing calls surfaced to THIS agent (brand + owner
 *                   rooms, deduped by call_id)
 *   active          the one call this tab is on (claim → connecting → live)
 *   pendingOutcome  a completed call awaiting its mandatory disposition
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
  caller_name?: string | null;
  duration_seconds: number;
}

interface CallState {
  incoming: CallRing[];
  active: ActiveCall | null;
  pendingOutcome: PendingOutcome | null;
  addIncoming: (ring: CallRing) => void;
  removeIncoming: (callId: string) => void;
  setActive: (call: ActiveCall | null) => void;
  patchActive: (patch: Partial<ActiveCall>) => void;
  setPendingOutcome: (p: PendingOutcome | null) => void;
}

export const useCallStore = create<CallState>()((set) => ({
  incoming: [],
  active: null,
  pendingOutcome: null,
  addIncoming: (ring) =>
    set((s) =>
      s.incoming.some((r) => r.call_id === ring.call_id)
        ? s
        : { incoming: [...s.incoming, ring] },
    ),
  removeIncoming: (callId) =>
    set((s) => ({ incoming: s.incoming.filter((r) => r.call_id !== callId) })),
  setActive: (active) => set({ active }),
  patchActive: (patch) =>
    set((s) => (s.active ? { active: { ...s.active, ...patch } } : s)),
  setPendingOutcome: (pendingOutcome) => set({ pendingOutcome }),
}));
