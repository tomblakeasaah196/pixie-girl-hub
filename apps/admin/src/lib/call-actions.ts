/**
 * Imperative call actions, published by CallLayer for any surface to use.
 *
 * The answer flow is not a pure state transition — it needs the microphone,
 * an atomic claim, a WebRTC negotiation and a settle path, all of which live in
 * CallLayer (mounted once, owns the single RTCPeerConnection for the tab).
 * But the ring has to be answerable from wherever the agent happens to be
 * looking: the corner toast, the conversation itself, a notification tap.
 *
 * Rather than duplicating that flow per surface — or lifting a WebRTC session
 * into React state where a re-render could drop it — CallLayer registers its
 * handlers here on mount and every other surface calls them. Everything a
 * surface needs to *render* (the ring list, who's being answered, whether the
 * ringtone is blocked) lives in the call store instead; this module is only
 * for the verbs.
 *
 * Calls before CallLayer mounts (or after it unmounts on sign-out) are no-ops
 * rather than crashes: an Answer button that quietly does nothing on a
 * half-torn-down app beats a white screen.
 */

import type { CallRing } from "@/lib/calls-api";

export interface CallActions {
  answer: (ring: CallRing) => void | Promise<void>;
  decline: (ring: CallRing) => void | Promise<void>;
  toggleMute: () => void;
  hangup: () => void | Promise<void>;
  /** Unlock the AudioContext after the browser blocked the ringtone. */
  enableSound: () => void;
}

const NOOP: CallActions = {
  answer: () => {},
  decline: () => {},
  toggleMute: () => {},
  hangup: () => {},
  enableSound: () => {},
};

let current: CallActions | null = null;

export function registerCallActions(actions: CallActions): () => void {
  current = actions;
  return () => {
    if (current === actions) current = null;
  };
}

export function callActions(): CallActions {
  return current ?? NOOP;
}
