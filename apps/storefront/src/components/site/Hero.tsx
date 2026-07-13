import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { SmartLink } from "@/components/site/SmartLink";
import {
  DEFAULT_HOME,
  heroVideo,
  type HeroContent,
  type HeroVideo,
} from "@/lib/home-content";

/**
 * HERO — ratio-aware, mobile-first, one component for both maisons.
 *
 * The studio publishes each hero film with its real `width`/`height`
 * (see src/services/video-clip.service.js), so we can pick the right stage
 * deterministically at SSR — no layout guessing, no hydration flip:
 *
 *   • PORTRAIT  (r < 0.92, e.g. 1080×1920) → the Vitrine.
 *       Mobile  : the film IS the screen — full-bleed, ~uncropped, copy in the
 *                 thumb zone, ending short of the fold so the next section peeks.
 *       Desktop : the whole 9:16 frame stands uncropped in an arched atelier
 *                 window beside the couture headline, over an ambient "room"
 *                 blurred from the film's own poster.
 *   • SQUARE    (0.92–1.1) → the Medallion (a rounded square vitrine).
 *   • LANDSCAPE (r > 1.1) or NO VIDEO → the Cinema (classic full-bleed).
 *
 * One <video> element per hero — it is full-bleed on mobile and re-flows into
 * the vitrine box on desktop purely via CSS, so the film is never loaded twice.
 * Mobile caps the loop at MOBILE_LOOP_SECONDS; desktop plays the full clip.
 */

/** Mobile trims the loop to keep the first impression tight on mobile data. */
const MOBILE_LOOP_SECONDS = 12;

type Stance = "portrait" | "square" | "cinema";

function stanceFor(video: HeroVideo | null): Stance {
  if (!video || !video.width || !video.height) return "cinema";
  const r = video.width / video.height;
  if (r < 0.92) return "portrait";
  if (r > 1.1) return "cinema";
  return "square";
}

/* ────────────────────────────────────────────────────────────────
 * FilmStage — the poster → video "living image".
 *
 * The poster <img> is server-rendered so the page paints instantly. The
 * <video> mounts client-side, buffers behind the poster, then cross-dissolves
 * in only once it is genuinely playing — a viewer on a poor connection simply
 * keeps the poster and never sees a black box or a stall. Honours Save-Data,
 * slow effective types, and prefers-reduced-motion. On mobile the loop is
 * trimmed to MOBILE_LOOP_SECONDS; desktop plays the whole clip.
 * ──────────────────────────────────────────────────────────────── */
function FilmStage({
  video,
  poster,
  className,
  mediaClassName,
  onReady,
  children,
}: {
  video: HeroVideo;
  poster: string;
  /** wrapper — carries position/shape (full-bleed on mobile, arch on desktop). */
  className: string;
  /** applied to BOTH the poster and the video so they register exactly. */
  mediaClassName: string;
  /** fired once, when the film first starts playing (drives the desktop light-up). */
  onReady?: () => void;
  /** overlays clipped to the stage shape (e.g. the desktop arch vignette). */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const capRef = useRef<number | undefined>(undefined);

  // Pick the source after mount (SSR-safe) — SD rendition when the connection
  // says it's constrained; skip playback entirely under reduced-motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const conn = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    const constrained =
      Boolean(conn?.saveData) ||
      /(^|\b)(slow-2g|2g|3g)\b/.test(conn?.effectiveType || "");
    capRef.current = window.matchMedia("(max-width: 767px)").matches
      ? MOBILE_LOOP_SECONDS
      : undefined;
    setSrc(constrained && video.sd_url ? video.sd_url : video.url);
  }, [video.url, video.sd_url]);

  // Some browsers won't honour autoPlay on a late-mounted element — nudge it.
  useEffect(() => {
    if (src) ref.current?.play().catch(() => {});
  }, [src]);

  const onPlaying = () => {
    if (!ready) {
      setReady(true);
      onReady?.();
    }
  };

  // Mobile: trim the loop by seeking home a touch before the cap so the wrap is
  // seamless. `loop` still handles clips shorter than the cap.
  const onTimeUpdate = () => {
    const el = ref.current;
    const cap = capRef.current;
    if (el && cap && el.currentTime >= cap) el.currentTime = 0;
  };

  return (
    <div className={className}>
      <img src={poster} alt="" aria-hidden className={mediaClassName} />
      {src ? (
        <video
          ref={ref}
          src={src}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden
          onPlaying={onPlaying}
          onCanPlay={() => ref.current?.play().catch(() => {})}
          onTimeUpdate={onTimeUpdate}
          className={`${mediaClassName} transition-opacity duration-[1100ms] ease-out ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * HeroCopy — the eyebrow / headline / body / CTAs. Shared by every stance so
 * the words and their entrance choreography are defined exactly once.
 * ──────────────────────────────────────────────────────────────── */
function HeroCopy({
  content,
  className = "",
  headingClassName,
}: {
  content: HeroContent;
  className?: string;
  headingClassName: string;
}) {
  return (
    <div className={className}>
      <motion.span
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.6 }}
        className="block text-[0.7rem] tracking-[0.5em] uppercase text-taupe/90"
      >
        {content.eyebrow}
        {content.eyebrowAccent ? (
          <span className="font-couture italic normal-case tracking-normal text-taupe">
            {content.eyebrowAccent}
          </span>
        ) : null}
      </motion.span>

      <motion.h1
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.1, delay: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className={headingClassName}
      >
        {content.heading}
        {content.headingAccent ? (
          <em className="gold-shimmer not-italic">{content.headingAccent}</em>
        ) : null}
        {content.headingAfter ? (
          <>
            <br />
            {content.headingAfter.trim()}
          </>
        ) : null}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 1.1 }}
        className="mt-6 max-w-md text-sm md:text-base lg:text-lg text-cream/80 leading-relaxed"
      >
        {content.body}
        {content.bodyAccent ? (
          <span className="font-couture italic text-taupe">{content.bodyAccent}</span>
        ) : null}
        {content.bodyAfter}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 1.3 }}
        className="mt-8 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-4"
      >
        <SmartLink
          to={content.cta1Href}
          className="group relative overflow-hidden px-7 py-4 sm:px-9 text-center bg-taupe text-ink text-[0.68rem] tracking-[0.35em] sm:tracking-[0.4em] uppercase font-medium hover:bg-cream transition-colors rounded-lg"
        >
          {content.cta1Label}
        </SmartLink>
        <SmartLink
          to={content.cta2Href}
          className="px-7 py-4 sm:px-9 text-center border border-taupe/40 text-taupe text-[0.68rem] tracking-[0.35em] sm:tracking-[0.4em] uppercase hover:bg-taupe/10 transition-colors rounded-lg"
        >
          {content.cta2Label}
        </SmartLink>
      </motion.div>
    </div>
  );
}

/** The small "Scroll" cue, bottom-left, desktop-only (mobile uses the peek). */
function ScrollCue() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 2, duration: 1 }}
      className="pointer-events-none absolute bottom-10 left-6 z-20 hidden items-center gap-4 text-[0.6rem] tracking-[0.4em] uppercase text-taupe/70 md:flex lg:left-10"
    >
      <span className="h-px w-12 bg-taupe/50" /> Scroll
    </motion.div>
  );
}

/**
 * Once-per-session, prefers-reduced-motion-safe flag that flips true the first
 * time the desktop film starts playing — drives the ambient "light-up".
 */
function useSessionLightUp(): [boolean, () => void] {
  const [lit, setLit] = useState(false);
  const trigger = () => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (sessionStorage.getItem("faitlyn:heroLit") === "1") return;
      sessionStorage.setItem("faitlyn:heroLit", "1");
    } catch {
      /* private mode — the effect is cosmetic, just play it */
    }
    setLit(true);
    window.setTimeout(() => setLit(false), 2800);
  };
  return [lit, trigger];
}

/* ════════════════════════════════════════════════════════════════
 * VITRINE — portrait (arch) and square (medallion).
 *
 * ONE <video>: full-bleed on mobile (`absolute inset-0`), re-flowed into the
 * grid's second column as a framed box on desktop (`md:relative`). The ambient
 * room and the arch chrome are desktop-only; the header/copy scrims are
 * mobile-only. Every ground is an --ink wash and every ink is --cream/--taupe,
 * so contrast holds automatically when the theme flips.
 * ════════════════════════════════════════════════════════════════ */
function VitrineHero({
  content,
  video,
  variant,
}: {
  content: HeroContent;
  video: HeroVideo;
  variant: "portrait" | "square";
}) {
  // Two distinct images on desktop: the FILM's own first frame drives the
  // in-vitrine poster (so the crossfade to the clip is seamless), while the
  // ambient ROOM behind it is the Studio "Background Image" (hero imageUrl)
  // when set — falling back to the film's poster so the room is never empty.
  const filmPoster = video.poster_url || content.imageUrl;
  const roomImage = content.imageUrl || video.poster_url;
  const [lit, lightUp] = useSessionLightUp();
  const isSquare = variant === "square";

  // Shape of the framed film on desktop.
  const boxShape = isSquare
    ? "md:aspect-square md:h-auto md:w-[min(42vw,560px)] md:rounded-[2rem]"
    : "md:aspect-[9/16] md:h-[80svh] md:max-h-[840px] md:w-auto md:rounded-t-[900px] md:rounded-b-[1.75rem]";

  return (
    <section className="relative isolate overflow-hidden bg-ink">
      {/* Ambient room — desktop only: the film's poster, blurred into a lit
          interior. Left stays ink (copy legibility), right glows (the arch). */}
      <div aria-hidden className="absolute inset-0 z-0 hidden md:block">
        <img
          src={roomImage}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
        />
        <div className="absolute inset-0 bg-ink/50" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/45 to-ink/15" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/50 via-transparent to-ink/65" />
        {/* Corner vignette — darkens the room's periphery so the arch
            reads as the natural focal point, not a pasted-on cutout. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(ellipse 70% 65% at 62% 50%, transparent 50%, color-mix(in oklab, var(--ink) 60%, transparent) 100%)",
          }}
        />
        {/* warm interior glow behind the vitrine, on the right */}
        <div
          className="absolute right-[8%] top-1/2 h-[75vh] w-[42vw] -translate-y-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in oklab, var(--champagne) 34%, transparent), transparent 72%)",
          }}
        />
        {lit ? (
          <div
            className="hero-lightup absolute right-[8%] top-1/2 h-[80vh] w-[46vw] -translate-y-1/2 rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(closest-side, color-mix(in oklab, var(--gold) 42%, transparent), transparent 70%)",
            }}
          />
        ) : null}
      </div>

      {/* Content wrapper: mobile = full-height flex, copy bottom-anchored;
          desktop = two-column grid centred in the site's content column. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        className={`relative z-10 mx-auto flex w-full max-w-[1500px] flex-col justify-end px-6 pb-14 pt-28 lg:px-16 ${
          isSquare
            ? "min-h-[82svh] md:min-h-[90svh]"
            : "min-h-[86svh] md:min-h-[100svh]"
        } md:grid md:items-center md:gap-8 md:px-10 md:pb-0 md:pt-24 lg:gap-14 ${
          isSquare
            ? "md:grid-cols-[1fr_auto]"
            : "md:grid-cols-[1.05fr_0.95fr]"
        }`}
      >
        {/* Vitrine column — `contents` on mobile so the film stays absolutely
            positioned relative to the section; a real box on desktop so the
            ring and glow can sit around the film without breaking the grid. */}
        <div className={`contents md:relative md:order-2 md:block md:mx-auto md:self-center md:justify-self-center md:z-10 ${boxShape}`}>
          {/* Animated arch ring — desktop only, sits behind the film */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-[3px] z-0 hidden md:block md:[border-radius:inherit] vitrine-ring"
          />

          {/* The film — single element, full-bleed on mobile, framed on desktop. */}
          <FilmStage
            video={video}
            poster={filmPoster}
            onReady={lightUp}
            className="absolute inset-x-0 top-14 bottom-0 z-0 overflow-hidden md:relative md:inset-auto md:top-auto md:z-[1] md:h-full md:w-full md:overflow-hidden md:border md:border-taupe/25 md:[border-radius:inherit] vitrine-glow"
            mediaClassName="absolute inset-0 h-full w-full object-cover object-center"
          >
            {/* Desktop-only vignette, clipped to the arch/medallion shape. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 hidden md:block"
              style={{
                background:
                  "radial-gradient(125% 90% at 50% 32%, transparent 55%, color-mix(in oklab, var(--ink) 55%, transparent) 100%)",
              }}
            />
          </FilmStage>
        </div>

        {/* Mobile scrims — header legibility (top, theme-adaptive) and copy
            legibility (bottom). The face-safe middle is never dimmed. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-[5] h-40 bg-gradient-to-b from-ink/65 via-ink/25 to-transparent md:hidden"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 z-[5] h-[66%] bg-gradient-to-t from-ink from-[8%] via-ink/60 via-[46%] to-transparent md:hidden"
        />

        {/* Copy — bottom-anchored on mobile, first column on desktop. */}
        <HeroCopy
          content={content}
          className="relative z-20 max-w-xl md:z-10 md:order-1"
          headingClassName="mt-5 font-display text-[clamp(2.4rem,6.4vw,5.25rem)] leading-[0.96] tracking-[-0.02em] text-cream text-balance"
        />

        <ScrollCue />
      </motion.div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
 * CINEMA — landscape films and the still-image fallback. Classic full-bleed
 * with disciplined, theme-adaptive scrims (no triple-stacked wash on the face).
 * ════════════════════════════════════════════════════════════════ */
function CinemaHero({
  content,
  video,
}: {
  content: HeroContent;
  video: HeroVideo | null;
}) {
  const poster = (video && video.poster_url) || content.imageUrl;

  return (
    <section className="relative min-h-[100svh] overflow-hidden bg-ink">
      <motion.div
        initial={{ scale: 1.12, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        className="absolute inset-0"
      >
        {video ? (
          <FilmStage
            video={video}
            poster={poster}
            className="absolute inset-0"
            mediaClassName="absolute inset-0 h-full w-full object-cover object-center"
          />
        ) : (
          <img
            src={poster}
            alt=""
            aria-hidden
            className="h-full w-full object-cover object-center"
          />
        )}
        {/* Disciplined scrims: darken the bottom-left where the copy lives,
            leave the top-right (the face) alone. All --ink → theme-adaptive. */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-ink/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/65 via-ink/10 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink/50 to-transparent md:from-ink/35" />
      </motion.div>

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[1400px] flex-col justify-end px-6 pb-24 pt-40 md:justify-center md:pb-24 md:pt-48 lg:px-10">
        <HeroCopy
          content={content}
          className="max-w-3xl"
          headingClassName="mt-6 font-display text-[clamp(3rem,9vw,8rem)] leading-[0.95] tracking-[-0.02em] text-cream max-w-5xl text-balance"
        />
        <ScrollCue />
      </div>
    </section>
  );
}

export function Hero({ content = DEFAULT_HOME.hero }: { content?: HeroContent }) {
  const video = heroVideo(content.video);
  const stance = stanceFor(video);

  if (video && stance === "portrait")
    return <VitrineHero content={content} video={video} variant="portrait" />;
  if (video && stance === "square")
    return <VitrineHero content={content} video={video} variant="square" />;
  return <CinemaHero content={content} video={video} />;
}
