import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { useBusinessStore, useBusinesses } from "@/stores/business";
import { useCallStore } from "@/stores/call";
import { useChatDockStore } from "@/stores/chat-dock";
import { getSocket, joinRoom, leaveRoom, rooms } from "@/lib/socket";
import { callsApi, ApiErrorLike, type CallOutcome, type CallRing } from "@/lib/calls-api";
import {
  answerCall,
  getActiveWebRtcCall,
  getMicrophone,
  teardownActiveCall,
} from "@/lib/webrtc-call";
import { isAudioBlocked, startRingtone, tapFeedback, unlockAudio } from "@/lib/notif-sound";
import {
  alertingCallId,
  closeCallNotification,
  startCallAlert,
  stopCallAlert,
} from "@/lib/call-alert";
import { registerCallActions } from "@/lib/call-actions";
import { clearCallIntent, takeCallIntent } from "@/lib/call-intent";
import { useToast } from "@/lib/toast";
import { IncomingCallToast } from "./IncomingCallToast";
import { ActiveCallBar } from "./ActiveCallBar";
import { OutcomeDialog } from "./OutcomeDialog";
import { CallPushGate } from "./CallPushGate";

/**
 * Global calling layer (canon §3.4-adjacent floating element) — mounted
 * once in AppShell so calls ring wherever the agent is in the Hub, not
 * only on the Messaging screen.
 *
 * Responsibilities:
 *   - join user:{id}:calls + brand:{brand}:calls for EVERY brand the agent
 *     covers (see the entity-scope note below), rejoined on reconnect
 *   - surface ringing calls (glass toasts, ringtone, vibration, tab-title
 *     flash, and an OS notification when the tab is hidden)
 *   - reconcile against the server whenever this tab could have missed an
 *     event — reconnect, wake, regaining focus, cold start from a push
 *   - answer flow: mic → claim (atomic) → WebRTC answer → accept
 *   - active-call HUD (mute / open chat / hang up)
 *   - mandatory outcome dialog after every completed call
 *
 * ENTITY SCOPE (non-negotiable #1) — a ring is not brand data, it is an alert
 * about a brand the agent is already authorised for, and the API re-checks
 * permission on every claim. Filtering rings to the tab's *active* brand
 * silently dropped calls for agents who cover both, which is a lost sale, not
 * an isolation win. Rings therefore span the agent's own brands (each card
 * names its brand) — the same rule the notification bell already applies for
 * multi-brand users. Answering carries the calling brand explicitly, so
 * nothing about the tab's brand context changes underneath the agent.
 *
 * Permission-aware: renders nothing without smartcomm access; the API
 * enforces regardless (claim additionally requires per-platform reply).
 */

/**
 * How long a ring may live on this client without any settling event.
 *
 * The ring is a fire-and-forget socket message: if the connection drops
 * between `call:ringing` and `call:claimed`/`call:ended`, nothing would ever
 * clear the toast and the agent would be left staring at a phantom call — and
 * a ringtone that never stops. Meta rings for ~30 s and the server's stale
 * sweep settles at 120 s, so 75 s is comfortably past any real ring while
 * still bounded.
 */
const RING_MAX_MS = 75_000;

/** How often to re-check ring ages. */
const RING_TICK_MS = 1_000;

/** A reconciliation read only prunes rings older than this, so a ring that
 *  arrived microseconds ago isn't deleted by an in-flight response. */
const RECONCILE_GRACE_MS = 4_000;

/**
 * Silence the alert for ONE call. Only cuts the ringtone if that call is the
 * one currently ringing — with two calls stacked, acting on the second must
 * not leave the first ringing silently in the corner.
 */
function silenceRing(callId: string) {
  if (alertingCallId() === callId) stopCallAlert(callId);
  else void closeCallNotification(callId);
}

export function CallLayer() {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const activeBrand = useBusinessStore((s) => s.activeKey);
  const setActiveBrand = useBusinessStore((s) => s.setActive);
  const businesses = useBusinesses();
  const {
    incoming,
    active,
    pendingOutcome,
    inlineChannels,
    answeringId,
    soundBlocked,
    setAnsweringId,
    setSoundBlocked,
    addIncoming,
    removeIncoming,
    dismissIncoming,
    setActive,
    patchActive,
    setPendingOutcome,
  } = useCallStore();
  const openDock = useChatDockStore((s) => s.openDock);
  const toast = useToast("Messaging → Calls");
  const qc = useQueryClient();
  const [savingOutcome, setSavingOutcome] = useState(false);

  const permitted = !!user && (user.isCeo || can("smartcomm", "view"));

  /**
   * Every brand this agent may be rung for.
   *
   * Memoised on the KEYS, not on the arrays: useBusinesses() rebuilds its
   * array on every render, so depending on it directly would hand the rooms
   * effect below a new identity each pass and leave/rejoin every brand room in
   * a loop — the ring would spend more time out of its room than in it.
   */
  const brandKeys = businesses.map((b) => b.key).join(",");
  const availableKeys = (user?.availableBusinesses ?? []).join(",");
  const ringBrands = useMemo(() => {
    if (!user) return [] as string[];
    const all = brandKeys ? brandKeys.split(",") : [];
    if (user.isCeo) return all;
    const allowed = new Set(availableKeys ? availableKeys.split(",") : []);
    const mine = all.filter((k) => allowed.has(k));
    // A user with no explicit grants still rings for the brand they're on,
    // rather than going silent on a branding payload we couldn't read.
    return mine.length ? mine : [activeBrand];
  }, [brandKeys, availableKeys, user, activeBrand]);

  const brandLabel = (key?: string) =>
    businesses.find((b) => b.key === key)?.name ?? key ?? "";

  // Refs so socket handlers registered once always see current state.
  const activeRef = useRef(active);
  activeRef.current = active;
  const ringBrandsRef = useRef(ringBrands);
  ringBrandsRef.current = ringBrands;

  // ── Rooms: join on mount / brand access change ──────────────
  // joinRoom remembers the room, so socket.ts replays every join after a
  // reconnect — no per-connect handler needed here.
  useEffect(() => {
    if (!permitted || !user) return;
    joinRoom(rooms.userCalls(user.id));
    for (const b of ringBrands) joinRoom(rooms.brandCalls(b));
    return () => {
      // Only the brand rooms are released — the personal room follows the
      // session, not the brand list.
      for (const b of ringBrands) leaveRoom(rooms.brandCalls(b));
    };
  }, [permitted, user, ringBrands]);

  // ── Reconciliation: what should I be ringing for? ───────────
  // Runs whenever this tab could have missed a socket event. Adds rings it
  // never saw and prunes ones the server no longer considers live, which is
  // what makes a sleeping laptop, a dropped connection, or a cold start from a
  // push notification all converge on the truth instead of guessing.
  const reconcile = useCallback(async () => {
    if (!permitted) return;
    const brands = ringBrandsRef.current;
    const seen = new Set<string>();
    for (const brand of brands) {
      let live: CallRing[] = [];
      try {
        live = (await callsApi.ringing(brand)) ?? [];
      } catch {
        continue; // no permission on this brand, or offline — try the next
      }
      for (const ring of live) {
        seen.add(ring.call_id);
        addIncoming({ ...ring, brand: ring.brand || brand });
      }
    }
    // Prune stale local rings the server didn't list. Skipped for very fresh
    // rings so a socket event that landed mid-request survives.
    const now = Date.now();
    for (const ring of useCallStore.getState().incoming) {
      if (seen.has(ring.call_id)) continue;
      if (!brands.includes(ring.brand)) continue;
      const startedAt = ring.started_at ? Date.parse(ring.started_at) : now;
      if (now - startedAt < RECONCILE_GRACE_MS) continue;
      removeIncoming(ring.call_id);
      void closeCallNotification(ring.call_id);
    }
  }, [permitted, addIncoming, removeIncoming]);

  useEffect(() => {
    if (!permitted) return;
    void reconcile();
    const socket = getSocket();
    const onConnect = () => void reconcile();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    socket.on("connect", onConnect);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onConnect);
    window.addEventListener("focus", onVisible);
    return () => {
      socket.off("connect", onConnect);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onConnect);
      window.removeEventListener("focus", onVisible);
    };
  }, [permitted, reconcile]);

  // ── Ring / stop-ring events (socket AND service worker) ─────
  useEffect(() => {
    if (!permitted) return;

    const onRinging = (e: Event) => {
      const ring = (e as CustomEvent<CallRing>).detail;
      if (!ring?.call_id) return;
      // Entity scope: a brand this agent doesn't cover never rings here.
      if (ring.brand && !ringBrandsRef.current.includes(ring.brand)) return;
      // A second call arriving while this agent is already talking is kept in
      // the stack but never rings audibly (see topRing) — it shows as a
      // call-waiting chip on the call bar instead of shouting over live audio.
      addIncoming(ring);
    };
    const onClaimed = (e: Event) => {
      const p = (e as CustomEvent<{ call_id: string }>).detail;
      if (!p?.call_id) return;
      // A colleague won it — drop the ring, but do NOT mark it handled. If
      // their SDP accept fails the backend releases the claim and re-rings the
      // brand (`call.claim_released`), and a "handled" flag would make this tab
      // deaf to that second chance. Nothing can resurrect it wrongly either:
      // the call is `in_progress` now, so a reconciliation read won't list it.
      removeIncoming(p.call_id);
      void closeCallNotification(p.call_id);
    };
    const onEnded = (e: Event) => {
      const p = (
        e as CustomEvent<{
          call_id: string;
          status?: string;
          duration_seconds?: number;
          caller_name?: string | null;
        }>
      ).detail;
      if (!p?.call_id) return;
      dismissIncoming(p.call_id);
      void closeCallNotification(p.call_id);
      // Remote hangup of MY live call → teardown + outcome dialog.
      const mine = activeRef.current;
      if (mine && mine.call_id === p.call_id) {
        teardownActiveCall();
        setActive(null);
        if (p.status === "completed") {
          setPendingOutcome({
            call_id: p.call_id,
            brand: mine.brand,
            caller_name: p.caller_name ?? mine.caller_name,
            duration_seconds:
              p.duration_seconds ??
              Math.round((Date.now() - mine.answered_at) / 1000),
          });
        }
      }
      qc.invalidateQueries({ queryKey: ["calls"] });
    };
    // The service worker's cancel push — same meaning as call:ended, but it
    // arrives on the device that had no socket at all.
    const onPushCancel = (e: Event) => {
      const p = (e as CustomEvent<{ call_id?: string }>).detail;
      if (!p?.call_id) return;
      dismissIncoming(p.call_id);
      void closeCallNotification(p.call_id);
    };

    window.addEventListener("pgh:call:ringing", onRinging);
    window.addEventListener("pgh:call:claimed", onClaimed);
    window.addEventListener("pgh:call:ended", onEnded);
    window.addEventListener("pgh:call:push-cancel", onPushCancel);
    return () => {
      window.removeEventListener("pgh:call:ringing", onRinging);
      window.removeEventListener("pgh:call:claimed", onClaimed);
      window.removeEventListener("pgh:call:ended", onEnded);
      window.removeEventListener("pgh:call:push-cancel", onPushCancel);
    };
  }, [
    permitted,
    addIncoming,
    removeIncoming,
    dismissIncoming,
    setActive,
    setPendingOutcome,
    qc,
  ]);

  // ── Ring expiry: never leave a phantom ring (or ringtone) ───
  useEffect(() => {
    if (incoming.length === 0) return;
    const tick = () => {
      const now = Date.now();
      for (const ring of useCallStore.getState().incoming) {
        const startedAt = ring.started_at ? Date.parse(ring.started_at) : now;
        if (Number.isFinite(startedAt) && now - startedAt > RING_MAX_MS) {
          removeIncoming(ring.call_id);
          void closeCallNotification(ring.call_id);
        }
      }
    };
    tick();
    const t = setInterval(tick, RING_TICK_MS);
    return () => clearInterval(t);
  }, [incoming.length, removeIncoming]);

  // ── The alert: sound + vibration + tab flash + OS notice ────
  const topRing = incoming.length > 0 && !active ? incoming[0] : null;
  useEffect(() => {
    if (!topRing) {
      stopCallAlert();
      return;
    }
    startCallAlert(topRing, { hidden: document.visibilityState === "hidden" });
    // Report honestly when the browser refused to make a sound, so the ring
    // card can offer the one tap that fixes it for the rest of the session.
    // Checked a beat later: resume() is async, so reading the state in the same
    // tick would flag a context that is about to become running.
    const settle = setTimeout(() => setSoundBlocked(isAudioBlocked()), 300);

    // Tabbing away mid-ring escalates to an OS notification — the agent who
    // just switched to their inbox still gets pulled back.
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        startCallAlert(topRing, { hidden: true });
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearTimeout(settle);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [topRing, setSoundBlocked]);

  // Live audio must never have a ringtone underneath it.
  useEffect(() => {
    if (active) stopCallAlert();
  }, [active]);

  const enableSound = useCallback(() => {
    unlockAudio();
    startRingtone();
    setSoundBlocked(isAudioBlocked());
  }, [setSoundBlocked]);

  // ── Answer flow: mic → claim → WebRTC answer → accept ───────
  const answer = useCallback(
    async (ring: CallRing) => {
      if (answeringId) return;
      setAnsweringId(ring.call_id);
      tapFeedback();
      // Answering is a user gesture: take the chance to unlock audio for the
      // rest of the session even if this particular ring was silent.
      unlockAudio();
      silenceRing(ring.call_id);
      let mic: MediaStream | null = null;
      try {
        try {
          mic = await getMicrophone();
        } catch {
          toast.error(
            "Microphone blocked",
            "Allow microphone access in your browser to answer calls.",
          );
          return;
        }

        const claimed = await callsApi.claim(ring.call_id, ring.brand);
        if (!claimed.sdp_offer) {
          toast.error("Couldn't answer", "The call offer has expired.");
          return;
        }

        const { session, sdpAnswer } = await answerCall({
          sdpOffer: claimed.sdp_offer,
          iceServers: claimed.ice_servers,
          micStream: mic,
        });
        mic = null; // session owns the stream now

        setActive({
          call_id: ring.call_id,
          brand: ring.brand,
          caller_name: ring.caller_name,
          from_number: ring.from_number,
          contact_id: ring.contact_id,
          channel_id: ring.channel_id,
          answered_at: Date.now(),
          muted: false,
          phase: "connecting",
        });
        dismissIncoming(ring.call_id);

        session.pc.addEventListener("connectionstatechange", () => {
          const st = session.pc.connectionState;
          if (st === "connected") {
            const cur = useCallStore.getState().active;
            if (cur?.call_id === ring.call_id) {
              useCallStore.setState({
                active: { ...cur, phase: "live", answered_at: Date.now() },
              });
            }
          }
        });

        try {
          await callsApi.accept(ring.call_id, sdpAnswer, ring.brand);
        } catch (err) {
          // Backend released the claim — it will re-ring the brand.
          teardownActiveCall();
          setActive(null);
          throw err;
        }
      } catch (err) {
        const apiErr = err as ApiErrorLike;
        if (apiErr?.status === 409) {
          toast.error("Too late", "A colleague already answered this call.");
        } else {
          toast.error(
            "Couldn't answer the call",
            apiErr?.message || "Something went wrong.",
          );
        }
        dismissIncoming(ring.call_id);
      } finally {
        if (mic) for (const t of mic.getTracks()) t.stop();
        setAnsweringId(null);
      }
    },
    [answeringId, setAnsweringId, dismissIncoming, setActive, toast],
  );

  const decline = useCallback(
    async (ring: CallRing) => {
      tapFeedback();
      dismissIncoming(ring.call_id);
      silenceRing(ring.call_id);
      try {
        await callsApi.reject(ring.call_id, ring.brand);
      } catch {
        // Someone else settled it first — nothing to do.
      }
    },
    [dismissIncoming],
  );

  // ── Intents arriving from outside the app ───────────────────
  // Two routes carry "answer this call" into the page:
  //   - the service worker's postMessage, when a notification button is tapped
  //     on a tab that is already open (no navigation, so a live call survives)
  //   - the ?answer_call= / ?decline_call= deep link, which is what survives a
  //     cold start AND a login redirect — the signed-out case
  const actOnIntent = useCallback(
    async (callId: string, intent: "answer" | "decline") => {
      if (!callId || useCallStore.getState().isHandled(callId)) return;
      // Acting on it now — make sure the parked copy can't fire again later.
      clearCallIntent();
      let ring = useCallStore
        .getState()
        .incoming.find((r) => r.call_id === callId);
      if (!ring) {
        // Cold start: the store is empty, so ask the server what's live.
        await reconcile();
        ring = useCallStore.getState().incoming.find((r) => r.call_id === callId);
      }
      if (!ring) {
        toast.info("Call already ended", "The caller hung up or it was answered.");
        void closeCallNotification(callId);
        return;
      }
      if (intent === "decline") await decline(ring);
      else await answer(ring);
    },
    [reconcile, decline, answer, toast],
  );

  useEffect(() => {
    if (!permitted) return;
    const onAnswer = (e: Event) => {
      const p = (e as CustomEvent<{ call_id?: string }>).detail;
      if (p?.call_id) void actOnIntent(p.call_id, "answer");
    };
    const onDecline = (e: Event) => {
      const p = (e as CustomEvent<{ call_id?: string }>).detail;
      if (p?.call_id) void actOnIntent(p.call_id, "decline");
    };
    window.addEventListener("pgh:call:answer-intent", onAnswer);
    window.addEventListener("pgh:call:decline-intent", onDecline);
    return () => {
      window.removeEventListener("pgh:call:answer-intent", onAnswer);
      window.removeEventListener("pgh:call:decline-intent", onDecline);
    };
  }, [permitted, actOnIntent]);

  // The intent captured at boot from a tapped ring notification (see
  // lib/call-intent). Claimed as soon as this layer exists — which may be
  // straight away, or only after the agent has signed in and picked a brand.
  const claimedIntent = useRef(false);
  useEffect(() => {
    if (!permitted || claimedIntent.current) return;
    claimedIntent.current = true;
    const pending = takeCallIntent();
    if (pending) void actOnIntent(pending.call_id, pending.intent);
  }, [permitted, actOnIntent]);

  const toggleMute = useCallback(() => {
    const session = getActiveWebRtcCall();
    const cur = useCallStore.getState().active;
    if (!session || !cur) return;
    const muted = !cur.muted;
    session.setMuted(muted);
    patchActive({ muted });
  }, [patchActive]);

  const hangup = useCallback(async () => {
    const cur = useCallStore.getState().active;
    if (!cur) return;
    tapFeedback();
    teardownActiveCall();
    setActive(null);
    try {
      await callsApi.hangup(cur.call_id, cur.brand);
    } catch {
      // Terminate webhook (customer hung up first) already settled it.
    }
    setPendingOutcome({
      call_id: cur.call_id,
      brand: cur.brand,
      caller_name: cur.caller_name,
      duration_seconds: Math.round((Date.now() - cur.answered_at) / 1000),
    });
    qc.invalidateQueries({ queryKey: ["calls"] });
  }, [setActive, setPendingOutcome, qc]);

  /** Open the caller's thread — switching brand first if the call came in on
   *  the brand this tab isn't currently showing. */
  const openCallChat = useCallback(() => {
    const cur = useCallStore.getState().active;
    if (!cur?.channel_id) return;
    if (cur.brand && cur.brand !== activeBrand) setActiveBrand(cur.brand);
    openDock(cur.channel_id);
  }, [activeBrand, setActiveBrand, openDock]);

  const submitOutcome = useCallback(
    async (outcome: CallOutcome, notes?: string) => {
      const pending = useCallStore.getState().pendingOutcome;
      if (!pending) return;
      setSavingOutcome(true);
      try {
        await callsApi.recordOutcome(
          pending.call_id,
          outcome,
          notes,
          pending.brand,
        );
        setPendingOutcome(null);
        toast.success("Call outcome saved");
        qc.invalidateQueries({ queryKey: ["calls"] });
        qc.invalidateQueries({ queryKey: ["smartcomm"] });
      } catch (err) {
        const apiErr = err as ApiErrorLike;
        if (apiErr?.status === 409 || apiErr?.status === 404) {
          // Call settled some other way (e.g. it never completed) —
          // don't trap the agent in an unsaveable dialog.
          setPendingOutcome(null);
        } else {
          toast.error(
            "Couldn't save the outcome",
            apiErr?.message || "Try again.",
          );
        }
      } finally {
        setSavingOutcome(false);
      }
    },
    [setPendingOutcome, toast, qc],
  );

  // Publish the verbs so the in-thread banner (and anything else that shows a
  // ring) drives this one answer flow rather than duplicating it.
  useEffect(
    () =>
      registerCallActions({
        answer,
        decline,
        toggleMute,
        hangup,
        enableSound,
      }),
    [answer, decline, toggleMute, hangup, enableSound],
  );

  // Never leave a live mic — or a ringing tab — behind if the layer unmounts
  // (sign-out, route teardown).
  useEffect(
    () => () => {
      teardownActiveCall();
      stopCallAlert();
    },
    [],
  );

  if (!permitted) return null;

  // Rings whose conversation is open on screen ring INSIDE the thread
  // (InThreadCallBanner) — showing a corner toast for the same call as well
  // would be two Answer buttons for one caller.
  const cornerRings = incoming.filter(
    (r) => !r.channel_id || !inlineChannels.includes(r.channel_id),
  );
  /** Calls ringing while this agent is already talking — call waiting. */
  const waiting = active ? incoming : [];

  return (
    <>
      {!active && cornerRings.length > 0 && (
        <div className="fixed top-[70px] right-4 max-md:left-1/2 max-md:right-auto max-md:-translate-x-1/2 z-[90] flex flex-col gap-2 pointer-events-none">
          {cornerRings.map((ring) => (
            <IncomingCallToast
              key={ring.call_id}
              ring={ring}
              answering={answeringId === ring.call_id}
              brandLabel={ringBrands.length > 1 ? brandLabel(ring.brand) : null}
              soundBlocked={soundBlocked && ring.call_id === topRing?.call_id}
              onEnableSound={enableSound}
              onAnswer={() => answer(ring)}
              onDecline={() => decline(ring)}
            />
          ))}
        </div>
      )}
      {active && (
        <ActiveCallBar
          call={active}
          brandLabel={ringBrands.length > 1 ? brandLabel(active.brand) : null}
          waitingCount={waiting.length}
          onToggleMute={toggleMute}
          onOpenChat={openCallChat}
          onHangup={hangup}
        />
      )}
      {pendingOutcome && (
        <OutcomeDialog
          pending={pendingOutcome}
          saving={savingOutcome}
          onSubmit={submitOutcome}
        />
      )}
      <CallPushGate />
    </>
  );
}
