import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
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
import { Section, ProductCardLink } from "@/components/parts";
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
  | { id: string; role: "praxis"; kind: "text"; text: string }
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
  "Hi, I'm Praxis — your personal shade stylist. Share a clear photo of yourself in natural light and I'll read your undertone and depth, find the shade family made for you, and pull the exact styles that carry it. You can also just chat to me about what you're after.";

const SESSION_KEY = "sf_session";

// ── Page ────────────────────────────────────────────────────

function ShadeFinderPage() {
  const [phase, setPhase] = useState<"boot" | "ready" | "error">("boot");
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
          const restored: ChatItem[] = [
            { id: cid(), role: "praxis", kind: "text", text: WELCOME },
            ...state.history.map(
              (h): ChatItem =>
                h.role === "user"
                  ? { id: cid(), role: "user", kind: "text", text: h.content }
                  : { id: cid(), role: "praxis", kind: "text", text: h.content },
            ),
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
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

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
        : { id: cid(), role: "praxis", kind: "text", text: r.message },
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

  const sendText = async () => {
    const message = input.trim();
    if (!session || !message || busy) return;
    if (pendingFile) return void sendPhoto();
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

  if (phase === "boot") return <BootSkeleton />;
  if (phase === "error")
    return (
      <Section>
        <div className="py-24 text-center">
          <p className="text-body text-destructive">
            Praxis couldn't come to the phone — please try again.
          </p>
          <button
            onClick={() => void boot()}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-body-sm hover:bg-secondary"
          >
            <RefreshCcw className="h-4 w-4" /> Retry
          </button>
        </div>
      </Section>
    );
  if (ended)
    return (
      <Section>
        <div className="mx-auto max-w-xl py-24 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-champagne" />
          <h1 className="mt-4 text-h2 font-couture">All cleared away</h1>
          <p className="mt-3 text-body text-muted-foreground">
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
      </Section>
    );

  const exhausted = (quota?.remaining ?? 1) <= 0;

  return (
    <Section className="max-w-3xl">
      {/* Header */}
      <div className="text-center">
        <p className="text-caption uppercase tracking-[0.2em] text-muted-foreground">
          Praxis · AI stylist
        </p>
        <h1 className="mt-2 text-h1 font-couture">Find your shade</h1>
        <p className="mx-auto mt-3 max-w-xl text-body text-muted-foreground">
          One photo. Your undertone, your depth, your shade family — and the
          exact styles that carry it.
        </p>
      </div>

      {/* Chat card */}
      <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Bar */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 md:px-5">
          <div className="flex items-center gap-2.5">
            <PraxisAvatar />
            <div>
              <p className="text-body-sm font-medium">Praxis</p>
              <p className="text-caption text-muted-foreground">Shade stylist</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {quota ? (
              <span
                className={`rounded-full border px-3 py-1 text-caption ${
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
              <Trash2 className="h-3.5 w-3.5" /> End &amp; delete
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="max-h-[60vh] min-h-[320px] overflow-y-auto px-4 py-6 md:px-6">
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
                  <PraxisBubble text={item.text} />
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {busy ? <ThinkingBubble stage={stage} /> : null}
          <div ref={bottomRef} />
        </div>

        {/* Pending photo tray */}
        {pendingUrl ? (
          <div className="flex items-center gap-4 border-t border-border bg-secondary/50 px-4 py-3 md:px-5">
            <img
              src={pendingUrl}
              alt="Your photo, ready to analyse"
              className="h-16 w-16 rounded-md object-cover"
            />
            <div className="min-w-0 flex-1">
              <label className="flex cursor-pointer items-start gap-2 text-caption text-muted-foreground">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 accent-current"
                />
                <span>
                  I'm happy for Praxis to analyse this photo. It's never saved —
                  discarded the moment the analysis ends.
                </span>
              </label>
            </div>
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

        {/* Composer */}
        <div className="border-t border-border px-4 py-3 md:px-5">
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
                className="rounded-full border border-border p-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
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
                    void sendText();
                  }
                }}
                placeholder={
                  pendingFile
                    ? "Add a note with your photo (optional)…"
                    : "Ask Praxis anything — “something warmer?”, “under ₦200k?”…"
                }
                disabled={busy}
                className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-body-sm outline-none placeholder:text-muted-foreground/70 focus:border-ring"
              />
              <button
                onClick={() => void sendText()}
                disabled={busy || (!input.trim() && !pendingFile)}
                aria-label="Send"
                className="rounded-full bg-primary p-2.5 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Send className="h-4.5 w-4.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Privacy line */}
      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-caption text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        Photos are analysed in memory and never saved — everything is deleted
        when your session ends.
      </p>
    </Section>
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

function PraxisBubble({ text }: { text: string }) {
  return (
    <div className="flex max-w-[85%] items-end gap-2.5">
      <div className="hidden shrink-0 md:block">
        <PraxisAvatar />
      </div>
      <div className="rounded-2xl rounded-bl-md bg-secondary px-4 py-3 text-body-sm leading-relaxed">
        {text}
      </div>
    </div>
  );
}

function UserBubble({ item }: { item: Extract<ChatItem, { role: "user" }> }) {
  if (item.kind === "photo") {
    return (
      <div className="max-w-[70%]">
        <img
          src={item.photoUrl}
          alt="The photo you shared"
          className="max-h-56 rounded-2xl rounded-br-md object-cover"
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
                  className="h-28 w-24 shrink-0 object-cover transition-transform duration-500 group-hover:scale-105 md:h-32 md:w-32"
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

          {/* Product picks */}
          {result.products.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {result.products.map((p) => (
                <ProductCardLink key={p.styled_id} p={p} currency={currency} />
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
        </div>
      </div>
    </div>
  );
}

function BootSkeleton() {
  return (
    <Section className="max-w-3xl">
      <div className="animate-pulse text-center">
        <div className="mx-auto h-3 w-32 rounded bg-secondary" />
        <div className="mx-auto mt-4 h-10 w-64 rounded bg-secondary" />
        <div className="mx-auto mt-4 h-4 w-80 rounded bg-secondary" />
      </div>
      <div className="mt-10 animate-pulse rounded-xl border border-border">
        <div className="border-b border-border px-5 py-4">
          <div className="h-9 w-40 rounded-full bg-secondary" />
        </div>
        <div className="space-y-4 px-6 py-8">
          <div className="h-16 w-3/4 rounded-2xl bg-secondary" />
          <div className="ml-auto h-10 w-1/2 rounded-2xl bg-secondary" />
          <div className="h-16 w-2/3 rounded-2xl bg-secondary" />
        </div>
        <div className="border-t border-border px-5 py-4">
          <div className="h-10 w-full rounded-full bg-secondary" />
        </div>
      </div>
    </Section>
  );
}
