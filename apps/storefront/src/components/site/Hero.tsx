import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { SmartLink } from "@/components/site/SmartLink";
import {
  DEFAULT_HOME,
  heroVideo,
  type HeroContent,
  type HeroVideo,
} from "@/lib/home-content";

/**
 * The hero's GIF-style looping clip. Layered ON TOP of the poster image so
 * the page paints instantly, then fades in only once the browser can actually
 * play it — a viewer on a poor connection simply keeps the poster and never
 * sees a black box or a stalled player.
 *
 * - mounts client-side only (src picked after hydration → SSR-safe)
 * - silent + `playsInline` + `muted` = autoplays everywhere, loops like a GIF
 * - picks the SD rendition when the connection says it's constrained
 *   (Save-Data or 2g/3g effective type)
 * - honours prefers-reduced-motion by never starting playback
 */
function HeroLoop({ video }: { video: HeroVideo }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
    setSrc(constrained && video.sd_url ? video.sd_url : video.url);
  }, [video.url, video.sd_url]);

  // Some browsers won't honour the autoPlay attribute on a late-mounted
  // element — nudge playback explicitly and ignore a refusal (poster stays).
  useEffect(() => {
    if (src) ref.current?.play().catch(() => {});
  }, [src]);

  if (!src) return null;
  return (
    <video
      ref={ref}
      src={src}
      poster={video.poster_url}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden
      onCanPlay={() => setReady(true)}
      className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-1000 ${
        ready ? "opacity-80" : "opacity-0"
      }`}
    />
  );
}

export function Hero({ content = DEFAULT_HOME.hero }: { content?: HeroContent }) {
  const video = heroVideo(content.video);
  // With a clip configured, the base layer is its poster frame so the video
  // takeover is seamless; otherwise the classic hero still.
  const baseImage = (video && video.poster_url) || content.imageUrl;
  return (
    <section className="relative min-h-[100dvh] overflow-hidden bg-ink">
      {/* Background image + optional looping clip */}
      <motion.div
        initial={{ scale: 1.15, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        className="absolute inset-0"
      >
        <img src={baseImage} alt="Faitlyn signature pixie" className="w-full h-full object-cover object-center opacity-80" />
        {video ? <HeroLoop video={video} /> : null}
        <div className="absolute inset-0 bg-ink/45" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/90 via-ink/55 to-ink" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/20 to-transparent" />
      </motion.div>

      {/* Copy */}
      <div className="relative z-10 mx-auto max-w-[1400px] px-6 lg:px-10 pt-40 md:pt-48 pb-24 min-h-[100dvh] flex flex-col justify-center">
        <motion.span
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6 }}
          className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe/90"
        >
          {content.eyebrow}
          {content.eyebrowAccent ? (
            <span className="font-couture italic normal-case tracking-normal text-taupe">{content.eyebrowAccent}</span>
          ) : null}
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 font-display text-[clamp(3rem,9vw,8rem)] leading-[0.95] tracking-[-0.02em] text-cream max-w-5xl text-balance"
        >
          {content.heading}
          {content.headingAccent ? <em className="gold-shimmer not-italic">{content.headingAccent}</em> : null}
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
          className="mt-8 max-w-md text-base md:text-lg text-cream/75 leading-relaxed"
        >
          {content.body}
          {content.bodyAccent ? <span className="font-couture italic text-taupe">{content.bodyAccent}</span> : null}
          {content.bodyAfter}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 1.3 }}
          className="mt-10 flex flex-wrap gap-4"
        >
          <SmartLink to={content.cta1Href} className="group relative overflow-hidden px-9 py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase font-medium hover:bg-cream transition-colors">
            {content.cta1Label}
          </SmartLink>
          <SmartLink to={content.cta2Href} className="px-9 py-4 border border-taupe/40 text-taupe text-[0.7rem] tracking-[0.4em] uppercase hover:bg-taupe/10 transition-colors">
            {content.cta2Label}
          </SmartLink>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          className="absolute bottom-10 left-6 lg:left-10 flex items-center gap-4 text-[0.6rem] tracking-[0.4em] uppercase text-taupe/70"
        >
          <span className="w-12 h-px bg-taupe/50" /> Scroll
        </motion.div>
      </div>
    </section>
  );
}
