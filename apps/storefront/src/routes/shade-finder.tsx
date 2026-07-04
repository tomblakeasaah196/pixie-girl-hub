import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  ImagePlus,
  Loader2,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { priceFor } from "@/lib/storefront";
import { useCurrency } from "@/lib/useStore";
import {
  analyzePhoto,
  connectShadeSocket,
  endShadeSession,
  getShadeSession,
  isQuotaError,
  isSessionExpired,
  sendChat,
  startShadeSession,
  type ShadeQuota,
  type ShadeRef,
  type ShadeReference,
  type ShadeResult,
  type ShadeSession,
  type ShadeStage,
} from "@/lib/shade-finder";
import type { Socket } from "socket.io-client";

export const Route = createFileRoute("/shade-finder")({
  component: ShadeFinderPage,
});

/**
 * Praxis Shade Finder — conversational "photo → your shade → the exact
 * styles" experience. Open to everyone (no account). The photo is analysed
 * in memory server-side and never stored; the session self-destructs.
 */

// ── Chat model ──────────────────────────────────────────────

type ChatItem =
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "user"; kind: "photo"; photoUrl: string; caption?: string }
  | {
      id: string;
      role: "praxis";
      kind: "text";
      text: string;
      references?: ShadeReference[];
    }
  | {
      id: string;
      role: "praxis";
      kind: "result";
      result: Omit<ShadeResult, "quota" | "privacy">;
    };

let seq = 0;
const cid = () => `c${Date.now()}_${seq++}`;

const STAGE_COPY: Record<string, string> = {
  reading_photo: "Praxis is looking at your photo…",
  matching_shades: "Matching you against our shades…",
  picking_styles: "Picking the styles that will love you back…",
  thinking: "Praxis is thinking…",
};
// Local fallback when the socket isn't connected — same story, timed.
const FALLBACK_STAGES: ShadeStage[] = [
  "reading_photo",
  "matching_shades",
  "picking_styles",
];

const WELCOME =
  "Hi, I'm Praxis — your personal stylist and concierge. Share a clear photo in natural light and I'll read your undertone, find your shade, and pull the exact styles that carry it. Or just talk to me — the occasion you're dressing for, wig care, our salon services, delivery, anything about the brand.";

const SESSION_KEY = "sf_session";

// Tap-to-start prompts (Gemini/Claude-style) — cut typing and aimless
// scrolling by handing the visitor a clear first move. Spans the full
// consultant range, not just shade tweaks.
const SUGGESTIONS = [
  "Something warmer",
  "Deep & rich",
  "Under ₦200k",
  "How do I care for my wig?",
  "Delivery & returns",
];

// ── Page ────────────────────────────────────────────────────

function ShadeFinderPage() {
  const [phase, setPhase] = useState<"boot" | "ready" | "error">("boot");
  const [bootError, setBootError] = useState<string | null>(null);
  const [session, setSession] = useState<ShadeSession | null>(null);
  const [quota, setQuota] = useState<ShadeQuota | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ShadeStage | null>(null);
  const [input, setInput] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [ended, setEnded] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const socketLive = useRef(false);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [currency] = useCurrency();

  // ── Boot: restore or start a session ──────────────────────
  const boot = useCallback(async () => {
    setPhase("boot");
    setEnded(false);
    try {
      const saved =
        typeof window !== "undefined"
          ? sessionStorage.getItem(SESSION_KEY)
          : null;
      if (saved) {
        const { sid, token } = JSON.parse(saved) as {
          sid: string;
          token: string;
        };
        try {
          const state = await getShadeSession(sid, token);
          const history = state.history.map(
            (h): ChatItem =>
              h.role === "user"
                ? { id: cid(), role: "user", kind: "text", text: h.content }
                : { id: cid(), role: "praxis", kind: "text", text: h.content },
          );
          // The result card carries its own message, so drop the trailing
          // assistant text bubble that would otherwise duplicate it on restore.
          if (state.last_result?.shade) {
            for (let i = history.length - 1; i >= 0; i--) {
              const h = history[i];
              if (h.role === "praxis") {
                if (h.kind === "text" && h.text === state.last_result.message) {
                  history.splice(i, 1);
                }
                break;
              }
            }
          }
          const restored: ChatItem[] = [
            { id: cid(), role: "praxis", kind: "text", text: WELCOME },
            ...history,
          ];
          if (state.last_result?.shade) {
            restored.push({
              id: cid(),
              role: "praxis",
              kind: "result",
              result: state.last_result,
            });
          }
          setItems(restored);
          setQuota(state.quota);
          setSession((s) =>
            s ?? {
              session_id: sid,
              guest_token: token,
              expires_in_seconds: 0,
              privacy: state.privacy,
              quota: state.quota,
              shades: [],
            },
          );
          setPhase("ready");
          return;
        } catch (e) {
          if (!isSessionExpired(e)) throw e;
          sessionStorage.removeItem(SESSION_KEY);
        }
      }
      const fresh = await startShadeSession();
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ sid: fresh.session_id, token: fresh.guest_token }),
      );
      setSession(fresh);
      setQuota(fresh.quota);
      setItems([{ id: cid(), role: "praxis", kind: "text", text: WELCOME }]);
      setPhase("ready");
    } catch (e) {
      setBootError(
        e instanceof Error && e.message ? e.message : null,
      );
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Immersive frame: the page owns the viewport, so lock the body scroll
  // while it's mounted — no rubber-band page scroll fighting the thread.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ── Live socket (stages only; HTTP carries the answer) ────
  useEffect(() => {
    if (!session?.guest_token) return;
    const socket = connectShadeSocket(session.guest_token, {
      onStage: (s) => {
        socketLive.current = true;
        if (s !== "done" && s !== "error" && s !== "ended") setStage(s);
      },
    });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
      socketLive.current = false;
    };
  }, [session?.guest_token]);

  // Fallback stage story-teller when the socket isn't delivering.
  const startStages = useCallback((photo: boolean) => {
    setStage(photo ? "reading_photo" : "thinking");
    if (stageTimer.current) clearInterval(stageTimer.current);
    if (!photo) return;
    let i = 0;
    stageTimer.current = setInterval(() => {
      if (socketLive.current) return; // real stages are flowing
      i = Math.min(i + 1, FALLBACK_STAGES.length - 1);
      setStage(FALLBACK_STAGES[i]);
    }, 2600);
  }, []);
  const stopStages = useCallback(() => {
    if (stageTimer.current) clearInterval(stageTimer.current);
    stageTimer.current = null;
    setStage(null);
  }, []);
  useEffect(() => stopStages, [stopStages]);

  // Keep the newest bubble in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, stage, pendingUrl]);

  // ── Actions ───────────────────────────────────────────────

  const pickFile = (f: File | null) => {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    setPendingFile(f);
    setPendingUrl(f ? URL.createObjectURL(f) : null);
  };

  const handleFailure = (e: unknown) => {
    if (isSessionExpired(e)) {
      sessionStorage.removeItem(SESSION_KEY);
      toast("That session had expired — I've started you a fresh one.");
      void boot();
      return;
    }
    const msg =
      e instanceof Error ? e.message : "Something went wrong — please try again.";
    setItems((it) => [
      ...it,
      { id: cid(), role: "praxis", kind: "text", text: msg },
    ]);
    if (isQuotaError(e)) setQuota((q) => (q ? { ...q, remaining: 0 } : q));
  };

  const submitResult = (r: ShadeResult) => {
    setQuota(r.quota);
    setItems((it) => [
      ...it,
      r.shade
        ? { id: cid(), role: "praxis", kind: "result", result: r }
        : {
            id: cid(),
            role: "praxis",
            kind: "text",
            text: r.message,
            references: r.references,
          },
    ]);
  };

  const sendPhoto = async () => {
    if (!session || !pendingFile || busy) return;
    const caption = input.trim() || undefined;
    const url = pendingUrl!;
    setItems((it) => [
      ...it,
      { id: cid(), role: "user", kind: "photo", photoUrl: url, caption },
    ]);
    setPendingFile(null);
    setPendingUrl(null);
    setInput("");
    setBusy(true);
    startStages(true);
    try {
      const r = await analyzePhoto(
        session.session_id,
        session.guest_token,
        pendingFile,
        caption,
      );
      submitResult(r);
    } catch (e) {
      handleFailure(e);
    } finally {
      setBusy(false);
      stopStages();
    }
  };

  const ask = async (message: string) => {
    if (!session || !message.trim() || busy) return;
    setItems((it) => [...it, { id: cid(), role: "user", kind: "text", text: message }]);
    setInput("");
    setBusy(true);
    startStages(false);
    try {
      const r = await sendChat(session.session_id, session.guest_token, message);
      submitResult(r);
    } catch (e) {
      handleFailure(e);
    } finally {
      setBusy(false);
      stopStages();
    }
  };

  const sendText = () => {
    if (pendingFile) return void sendPhoto();
    void ask(input.trim());
  };

  const finish = async () => {
    if (!session) return;
    try {
      const r = await endShadeSession(session.session_id, session.guest_token);
      toast(r.message);
    } catch {
      /* deleting a dead session is still a success for the user */
    }
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setItems([]);
    setQuota(null);
    setEnded(true);
  };

  // ── Render ────────────────────────────────────────────────
  // Immersive, single-scroll app frame (Claude/Gemini-style): a quiet pinned
  // top bar, the conversation as the ONLY scroll region, and a composer welded
  // to the bottom. Site header/footer are suppressed for this route in
  // __root.tsx so nothing competes for the scroll.

  if (phase === "boot") return <BootSkeleton />;
  if (phase === "error")
    return (
      <FrameShell>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="max-w-md text-body text-destructive">
            {bootError || "Praxis couldn't come to the phone — please try again."}
          </p>
          <button
            onClick={() => void boot()}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-body-sm hover:bg-secondary"
          >
            <RefreshCcw className="h-4 w-4" /> Retry
          </button>
        </div>
      </FrameShell>
    );
  if (ended)
    return (
      <FrameShell>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <ShieldCheck className="h-8 w-8 text-champagne" />
          <h1 className="mt-4 text-h2 font-couture">All cleared away</h1>
          <p className="mt-3 max-w-md text-body text-muted-foreground">
            Your chat and colour notes are deleted. Photos were never stored in
            the first place.
          </p>
          <button
            onClick={() => void boot()}
            className="mt-8 rounded-full bg-primary px-6 py-2.5 text-body-sm text-primary-foreground hover:opacity-90"
          >
            Start a new session
          </button>
        </div>
      </FrameShell>
    );

  const exhausted = (quota?.remaining ?? 1) <= 0;
  const showSuggestions = items.length <= 1 && !busy && !exhausted && !pendingUrl;

  return (
    <FrameShell>
      {/* Pinned top bar */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur-md md:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            to="/shop"
            aria-label="Back to store"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </Link>
          <PraxisAvatar />
          <div className="min-w-0">
            <p className="truncate text-body-sm font-medium">Praxis</p>
            <p className="text-caption text-muted-foreground">
              Stylist &amp; concierge
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {quota ? (
            <span
              className={`hidden rounded-full border px-3 py-1 text-caption sm:inline ${
                exhausted
                  ? "border-destructive/40 text-destructive"
                  : "border-border text-muted-foreground"
              }`}
              title="Photo analyses reset at midnight"
            >
              {quota.remaining} of {quota.limit} looks left today
            </span>
          ) : null}
          <button
            onClick={() => void finish()}
            className="inline-flex items-center gap-1.5 text-caption text-muted-foreground transition-colors hover:text-destructive"
            title="End the session and delete everything now"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">End &amp; delete</span>
          </button>
        </div>
      </header>

      {/* The one scroll region — the conversation itself */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col px-4 pb-4 pt-6 md:px-6">
          {/* Title lives at the top of the thread, so it scrolls away and
              never permanently eats the viewport. */}
          <div className="pb-4 text-center">
            <p className="text-caption text-muted-foreground">Praxis · AI stylist</p>
            <h1 className="mt-2 text-h3 font-couture md:text-h2">Find your shade</h1>
            <p className="mx-auto mt-2 max-w-md text-body-sm text-muted-foreground">
              One photo finds your shade — and I'm here for everything else
              too: styles, care, services, delivery.
            </p>
          </div>

          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className={`mb-5 flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {item.role === "user" ? (
                  <UserBubble item={item} />
                ) : item.kind === "result" ? (
                  <ResultBubble result={item.result} currency={currency} />
                ) : (
                  <PraxisBubble text={item.text} references={item.references} />
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Tap-to-start prompts (only before the conversation gets going) */}
          {showSuggestions ? (
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3.5 py-2 text-body-sm text-foreground transition-colors hover:bg-secondary"
              >
                <Camera className="h-3.5 w-3.5" /> Share a photo
              </button>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  className="rounded-full border border-border bg-card/60 px-3.5 py-2 text-body-sm text-foreground transition-colors hover:bg-secondary"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          {busy ? <ThinkingBubble stage={stage} /> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Pending photo tray (pinned above the composer) */}
      {pendingUrl ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-secondary/50 px-4 py-3 md:px-6">
          <img
            src={pendingUrl}
            alt="Your photo, ready to analyse"
            className="h-14 w-14 rounded-md object-cover"
          />
          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-caption normal-case tracking-normal text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 accent-current"
            />
            <span className="text-[0.72rem] leading-snug">
              I'm happy for Praxis to analyse this photo. It's never saved —
              discarded the moment the analysis ends.
            </span>
          </label>
          <button
            onClick={() => pickFile(null)}
            aria-label="Remove photo"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            onClick={() => void sendPhoto()}
            disabled={!consent || busy || exhausted}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-body-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Analyse
          </button>
        </div>
      ) : null}

      {/* Pinned composer */}
      <div className="shrink-0 border-t border-border bg-background/85 px-4 pb-4 pt-3 backdrop-blur-md md:px-6">
        <div className="mx-auto max-w-2xl">
          {exhausted ? (
            <p className="py-1 text-center text-body-sm text-muted-foreground">
              You've used today's free looks — Praxis resets at midnight ✨ You
              can still browse{" "}
              <Link to="/shades" className="underline underline-offset-4">
                all shades
              </Link>
              .
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                aria-label="Add a photo"
                title="Add a photo"
                className="shrink-0 rounded-full border border-border p-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
              >
                {pendingFile ? (
                  <ImagePlus className="h-4.5 w-4.5" />
                ) : (
                  <Camera className="h-4.5 w-4.5" />
                )}
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendText();
                  }
                }}
                placeholder={
                  pendingFile
                    ? "Add a note with your photo (optional)…"
                    : "Ask Praxis anything — shades, care, delivery…"
                }
                disabled={busy}
                className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-body-sm outline-none placeholder:text-muted-foreground/70 focus:border-ring"
              />
              <button
                onClick={() => sendText()}
                disabled={busy || (!input.trim() && !pendingFile)}
                aria-label="Send"
                className="shrink-0 rounded-full bg-primary p-2.5 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Send className="h-4.5 w-4.5" />
              </button>
            </div>
          )}
          <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[0.68rem] text-muted-foreground">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            Photos are analysed in memory and never saved.
          </p>
        </div>
      </div>
    </FrameShell>
  );
}

/** Full-viewport column: pinned bars top & bottom, one scroll in between. */
function FrameShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {children}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────

function PraxisAvatar() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-champagne to-burgundy text-primary-foreground">
      <Sparkles className="h-4 w-4" />
    </div>
  );
}

function PraxisBubble({
  text,
  references,
}: {
  text: string;
  references?: ShadeReference[];
}) {
  return (
    <div className="flex max-w-[85%] items-end gap-2.5">
      <div className="hidden shrink-0 md:block">
        <PraxisAvatar />
      </div>
      <div className="rounded-2xl rounded-bl-md bg-secondary px-4 py-3 text-body-sm leading-relaxed">
        {text}
        <ReferenceChips references={references} />
      </div>
    </div>
  );
}

/**
 * Tappable brand references under a Praxis reply. Every href is validated
 * server-side against a closed registry of real storefront routes, so a
 * chip can never 404. Plain anchors: each destination leaves the chat frame.
 */
function ReferenceChips({ references }: { references?: ShadeReference[] }) {
  if (!references || references.length === 0) return null;
  return (
    <span className="mt-2.5 flex flex-wrap gap-2">
      {references.map((r) => (
        <a
          key={r.key}
          href={r.href}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-3 py-1 text-caption text-foreground transition-colors hover:bg-card"
        >
          {r.label}
          <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
        </a>
      ))}
    </span>
  );
}

function UserBubble({ item }: { item: Extract<ChatItem, { role: "user" }> }) {
  if (item.kind === "photo") {
    return (
      <div className="max-w-[60%]">
        <img
          src={item.photoUrl}
          alt="The photo you shared"
          className="max-h-40 max-w-[9rem] rounded-2xl rounded-br-md object-cover"
        />
        {item.caption ? (
          <p className="mt-1.5 text-right text-caption text-muted-foreground">
            {item.caption}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-body-sm leading-relaxed text-primary-foreground">
      {item.text}
    </div>
  );
}

function ThinkingBubble({ stage }: { stage: ShadeStage | null }) {
  const label = (stage && STAGE_COPY[stage]) || "Praxis is thinking…";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-2 flex items-end gap-2.5"
    >
      <div className="hidden shrink-0 md:block">
        <PraxisAvatar />
      </div>
      <div className="flex items-center gap-3 rounded-2xl rounded-bl-md bg-secondary px-4 py-3">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
            />
          ))}
        </span>
        <AnimatePresence mode="wait">
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="text-body-sm text-muted-foreground"
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function SwatchStrip({ shade }: { shade: ShadeRef }) {
  const hexes = (shade.swatches ?? [])
    .map((s) => s.hex)
    .filter((h): h is string => !!h)
    .slice(0, 8);
  if (hexes.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {hexes.map((h, i) => (
        <span
          key={`${h}${i}`}
          className="h-4 w-4 rounded-full border border-border"
          style={{ backgroundColor: h }}
        />
      ))}
    </div>
  );
}

function ResultBubble({
  result,
  currency,
}: {
  result: Omit<ShadeResult, "quota" | "privacy">;
  currency: ReturnType<typeof useCurrency>[0];
}) {
  const shade = result.shade!;
  return (
    <div className="w-full max-w-[95%] md:max-w-[88%]">
      <div className="flex items-end gap-2.5">
        <div className="hidden shrink-0 md:block">
          <PraxisAvatar />
        </div>
        <div className="w-full space-y-4 rounded-2xl rounded-bl-md bg-secondary p-4 md:p-5">
          <p className="text-body-sm leading-relaxed">{result.message}</p>

          {/* Shade reveal */}
          <Link
            to="/shades/$slug"
            params={{ slug: shade.slug }}
            className="group block overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className="flex items-stretch">
              {shade.cover_image_url ? (
                <img
                  src={shade.cover_image_url}
                  alt={shade.name}
                  className="h-20 w-16 shrink-0 object-cover transition-transform duration-500 group-hover:scale-105 md:h-24 md:w-20"
                />
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-4 py-3">
                <p className="text-caption uppercase tracking-[0.18em] text-muted-foreground">
                  Your shade
                </p>
                <p className="truncate text-body-lg font-couture">{shade.name}</p>
                <SwatchStrip shade={shade} />
                <p className="text-caption text-muted-foreground underline-offset-4 group-hover:underline">
                  Explore the {shade.name} edit
                  {typeof shade.product_count === "number"
                    ? ` · ${shade.product_count} styles`
                    : ""}
                </p>
              </div>
            </div>
          </Link>

          {/* Product picks — compact swipe rail, not a heavy grid */}
          {result.products.length > 0 ? (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {result.products.map((p) => (
                <PickCard key={p.styled_id} p={p} currency={currency} />
              ))}
            </div>
          ) : null}

          {/* Alternates */}
          {result.alternates.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-caption text-muted-foreground">
                Also worth a look:
              </span>
              {result.alternates.map((a) => (
                <Link
                  key={a.shade_id}
                  to="/shades/$slug"
                  params={{ slug: a.slug }}
                  className="rounded-full border border-border px-3 py-1 text-caption transition-colors hover:bg-card"
                >
                  {a.name}
                </Link>
              ))}
            </div>
          ) : null}

          {result.followup_question ? (
            <p className="text-body-sm italic text-muted-foreground">
              {result.followup_question}
            </p>
          ) : null}

          <ReferenceChips references={result.references} />
        </div>
      </div>
    </div>
  );
}

/** Compact product pick — a slim card for the result rail (not the big grid). */
function PickCard({
  p,
  currency,
}: {
  p: { styled_id: string; name: string; slug: string; cover_image_url?: string | null } & Parameters<typeof priceFor>[0];
  currency: ReturnType<typeof useCurrency>[0];
}) {
  return (
    <Link
      to="/product/$slug"
      params={{ slug: p.slug }}
      className="group block w-24 shrink-0"
    >
      <div className="aspect-[3/4] w-24 overflow-hidden rounded-lg bg-card">
        {p.cover_image_url ? (
          <img
            src={p.cover_image_url}
            alt={p.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[0.6rem] text-muted-foreground">
            No image
          </div>
        )}
      </div>
      <p className="mt-1.5 truncate text-[0.72rem] leading-tight">{p.name}</p>
      <p className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">
        {priceFor(p, currency)}
      </p>
    </Link>
  );
}

function BootSkeleton() {
  return (
    <FrameShell>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3 md:px-5">
        <div className="h-9 w-9 animate-pulse rounded-full bg-secondary" />
        <div className="h-8 w-28 animate-pulse rounded bg-secondary" />
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto max-w-2xl animate-pulse space-y-5 px-4 pt-10 md:px-6">
          <div className="mx-auto h-8 w-56 rounded bg-secondary" />
          <div className="mx-auto h-4 w-72 rounded bg-secondary" />
          <div className="mt-8 h-16 w-3/4 rounded-2xl bg-secondary" />
          <div className="ml-auto h-24 w-32 rounded-2xl bg-secondary" />
          <div className="h-16 w-2/3 rounded-2xl bg-secondary" />
        </div>
      </div>
      <div className="shrink-0 border-t border-border px-4 py-4 md:px-6">
        <div className="mx-auto h-11 w-full max-w-2xl animate-pulse rounded-full bg-secondary" />
      </div>
    </FrameShell>
  );
}
