import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { useBusinessStore } from "@/stores/business";
import { useCallStore } from "@/stores/call";
import { useChatDockStore } from "@/stores/chat-dock";
import { getSocket, joinRoom, rooms } from "@/lib/socket";
import { callsApi, ApiErrorLike, type CallOutcome, type CallRing } from "@/lib/calls-api";
import {
  answerCall,
  getActiveWebRtcCall,
  getMicrophone,
  teardownActiveCall,
} from "@/lib/webrtc-call";
import { startRingtone, stopRingtone } from "@/lib/notif-sound";
import { useToast } from "@/lib/toast";
import { IncomingCallToast } from "./IncomingCallToast";
import { ActiveCallBar } from "./ActiveCallBar";
import { OutcomeDialog } from "./OutcomeDialog";

/**
 * Global calling layer (canon §3.4-adjacent floating element) — mounted
 * once in AppShell so calls ring wherever the agent is in the Hub, not
 * only on the Messaging screen.
 *
 * Responsibilities:
 *   - join brand:{brand}:calls + user:{id}:calls (rejoined on reconnect
 *     and brand switch; entity scope per non-negotiable #1 — only the
 *     active brand's calls ring this tab)
 *   - surface ringing calls (glass toasts + looped ringtone)
 *   - answer flow: mic → claim (atomic) → WebRTC answer → accept
 *   - active-call HUD (mute / open chat / hang up)
 *   - mandatory outcome dialog after every completed call
 *
 * Permission-aware: renders nothing without smartcomm access; the API
 * enforces regardless (claim additionally requires per-platform reply).
 */
export function CallLayer() {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const activeBrand = useBusinessStore((s) => s.activeKey);
  const {
    incoming,
    active,
    pendingOutcome,
    addIncoming,
    removeIncoming,
    setActive,
    patchActive,
    setPendingOutcome,
  } = useCallStore();
  const openDock = useChatDockStore((s) => s.openDock);
  const toast = useToast("Messaging → Calls");
  const qc = useQueryClient();
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [savingOutcome, setSavingOutcome] = useState(false);

  const permitted = !!user && (user.isCeo || can("smartcomm", "view"));

  // Refs so socket handlers registered once always see current state.
  const activeRef = useRef(active);
  activeRef.current = active;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  // ── Rooms: join on mount / brand switch / reconnect ─────────
  useEffect(() => {
    if (!permitted || !user) return;
    const socket = getSocket();
    const join = () => {
      joinRoom(rooms.brandCalls(activeBrand));
      joinRoom(rooms.userCalls(user.id));
    };
    join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
    };
  }, [permitted, user, activeBrand]);

  // ── Ring / stop-ring socket events ──────────────────────────
  useEffect(() => {
    if (!permitted) return;

    const onRinging = (e: Event) => {
      const ring = (e as CustomEvent<CallRing>).detail;
      if (!ring?.call_id) return;
      // Entity scope: only the active brand's calls ring this tab.
      if (ring.brand && ring.brand !== activeBrand) return;
      // Already on a call — don't stack a second ring on this agent;
      // colleagues' tabs still ring.
      if (activeRef.current) return;
      addIncoming(ring);
    };
    const onClaimed = (e: Event) => {
      const p = (e as CustomEvent<{ call_id: string }>).detail;
      if (p?.call_id) removeIncoming(p.call_id);
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
      removeIncoming(p.call_id);
      // Remote hangup of MY live call → teardown + outcome dialog.
      const mine = activeRef.current;
      if (mine && mine.call_id === p.call_id) {
        teardownActiveCall();
        setActive(null);
        if (p.status === "completed") {
          setPendingOutcome({
            call_id: p.call_id,
            caller_name: p.caller_name ?? mine.caller_name,
            duration_seconds:
              p.duration_seconds ??
              Math.round((Date.now() - mine.answered_at) / 1000),
          });
        }
      }
      qc.invalidateQueries({ queryKey: ["calls"] });
    };

    window.addEventListener("pgh:call:ringing", onRinging);
    window.addEventListener("pgh:call:claimed", onClaimed);
    window.addEventListener("pgh:call:ended", onEnded);
    return () => {
      window.removeEventListener("pgh:call:ringing", onRinging);
      window.removeEventListener("pgh:call:claimed", onClaimed);
      window.removeEventListener("pgh:call:ended", onEnded);
    };
  }, [permitted, activeBrand, addIncoming, removeIncoming, setActive, setPendingOutcome, qc]);

  // ── Ringtone follows the incoming stack ─────────────────────
  useEffect(() => {
    if (incoming.length > 0 && !active) startRingtone();
    else stopRingtone();
    return () => stopRingtone();
  }, [incoming.length, active]);

  // ── Answer flow: mic → claim → WebRTC answer → accept ───────
  const answer = useCallback(
    async (ring: CallRing) => {
      if (answeringId) return;
      setAnsweringId(ring.call_id);
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

        const claimed = await callsApi.claim(ring.call_id);
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
          caller_name: ring.caller_name,
          from_number: ring.from_number,
          contact_id: ring.contact_id,
          channel_id: ring.channel_id,
          answered_at: Date.now(),
          muted: false,
          phase: "connecting",
        });
        removeIncoming(ring.call_id);

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
          await callsApi.accept(ring.call_id, sdpAnswer);
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
        removeIncoming(ring.call_id);
      } finally {
        if (mic) for (const t of mic.getTracks()) t.stop();
        setAnsweringId(null);
      }
    },
    [answeringId, removeIncoming, setActive, toast],
  );

  const decline = useCallback(
    async (ring: CallRing) => {
      removeIncoming(ring.call_id);
      try {
        await callsApi.reject(ring.call_id);
      } catch {
        // Someone else settled it first — nothing to do.
      }
    },
    [removeIncoming],
  );

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
    teardownActiveCall();
    setActive(null);
    try {
      await callsApi.hangup(cur.call_id);
    } catch {
      // Terminate webhook (customer hung up first) already settled it.
    }
    setPendingOutcome({
      call_id: cur.call_id,
      caller_name: cur.caller_name,
      duration_seconds: Math.round((Date.now() - cur.answered_at) / 1000),
    });
    qc.invalidateQueries({ queryKey: ["calls"] });
  }, [setActive, setPendingOutcome, qc]);

  const submitOutcome = useCallback(
    async (outcome: CallOutcome, notes?: string) => {
      const pending = useCallStore.getState().pendingOutcome;
      if (!pending) return;
      setSavingOutcome(true);
      try {
        await callsApi.recordOutcome(pending.call_id, outcome, notes);
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

  // Never leave a live mic behind if the layer unmounts (sign-out).
  useEffect(() => () => teardownActiveCall(), []);

  if (!permitted) return null;

  return (
    <>
      {incoming.length > 0 && !active && (
        <div className="fixed top-[70px] right-4 max-md:left-1/2 max-md:right-auto max-md:-translate-x-1/2 z-[90] flex flex-col gap-2 pointer-events-none">
          {incoming.map((ring) => (
            <IncomingCallToast
              key={ring.call_id}
              ring={ring}
              answering={answeringId === ring.call_id}
              onAnswer={() => answer(ring)}
              onDecline={() => decline(ring)}
            />
          ))}
        </div>
      )}
      {active && (
        <ActiveCallBar
          call={active}
          onToggleMute={toggleMute}
          onOpenChat={() => active.channel_id && openDock(active.channel_id)}
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
    </>
  );
}
