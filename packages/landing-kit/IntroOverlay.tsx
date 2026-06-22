// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Cinematic welcome — "The Seal": a ribboned door that unties and parts to
 * reveal the page underneath (already mounted, just hidden). Plays once per
 * browser session across every sales page (apex + /sale/:slug) — gated by
 * sessionStorage so repeat navigation within the same session is silent.
 */

const DEFAULT_SESSION_KEY = "pgh-intro-seen";
const EASE = [0.76, 0, 0.24, 1] as const;

const BRAND_WORDMARK: Record<string, string> = {
  pixiegirl: "Pixie Girl",
  faitlynhair: "Faitlyn Hair",
};

type Phase = "hidden" | "seal" | "open";

export function IntroOverlay({
  brand,
  campaignName,
  sessionKey,
}: {
  brand?: string | null;
  campaignName?: string | null;
  /** Override the sessionStorage key — pass per-slug for the campaign before
   *  page so each sale plays its own intro the first time. Defaults to the
   *  global "pgh-intro-seen" used by the live/ended states. */
  sessionKey?: string;
}) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const reduceMotion = useReducedMotion();
  const storageKey = sessionKey || DEFAULT_SESSION_KEY;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, "1");

    if (reduceMotion) return; // skip the spectacle, never block the page

    setPhase("seal");
    const untie = setTimeout(() => setPhase("open"), 900);
    const done = setTimeout(() => setPhase("hidden"), 2600);
    return () => {
      clearTimeout(untie);
      clearTimeout(done);
    };
  }, [reduceMotion, storageKey]);

  if (phase === "hidden") return null;

  const wordmark = BRAND_WORDMARK[brand || ""] || "Pixie Girl";
  const headline = campaignName ? `Welcome to ${campaignName}` : "Welcome.";
  const open = phase === "open";

  return (
    <div className="fixed inset-0 z-[999] overflow-hidden" aria-hidden="true">
      {/* Door panels */}
      <motion.div
        initial={{ x: 0 }}
        animate={{ x: open ? "-100%" : 0 }}
        transition={{ duration: 1.5, ease: EASE }}
        className="absolute inset-y-0 left-0 w-1/2"
        style={{ background: "linear-gradient(135deg, rgb(var(--accent-deep)), rgb(var(--bg)) 85%)" }}
      />
      <motion.div
        initial={{ x: 0 }}
        animate={{ x: open ? "100%" : 0 }}
        transition={{ duration: 1.5, ease: EASE }}
        className="absolute inset-y-0 right-0 w-1/2"
        style={{ background: "linear-gradient(225deg, rgb(var(--accent-deep)), rgb(var(--bg)) 85%)" }}
      />

      {/* Seam glow — widens as the doors part */}
      <motion.div
        initial={{ opacity: 0.7, scaleX: 1 }}
        animate={{ opacity: open ? 0 : 0.85, scaleX: open ? 8 : 1 }}
        transition={{ duration: 1.3, ease: "easeOut" }}
        className="absolute inset-y-0 left-1/2 w-[6px] -translate-x-1/2"
        style={{
          background: "rgb(var(--accent-glow))",
          filter: "blur(6px)",
          boxShadow: "0 0 70px 12px rgb(var(--accent-glow) / 0.55)",
        }}
      />

      {/* Brand wordmark — subtle fade at the top */}
      <motion.p
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: open ? 0 : 0.85, y: 0 }}
        transition={{ duration: 0.8 }}
        className="micro absolute inset-x-0 top-[9%] text-center"
        style={{ letterSpacing: "0.32em" }}
      >
        {wordmark}
      </motion.p>

      {/* Ribbon seal — unties just before the doors part */}
      <motion.svg
        width="46"
        height="46"
        viewBox="0 0 44 44"
        initial={{ opacity: 1, scale: 1, rotate: 0 }}
        animate={open ? { opacity: 0, scale: 0.4, rotate: 35 } : { opacity: 1, scale: 1, rotate: 0 }}
        transition={{ duration: 0.55, ease: "easeIn" }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <path d="M22 22 C10 10, 2 14, 4 22 C2 30, 10 34, 22 22 Z" fill="rgb(var(--accent-glow))" />
        <path d="M22 22 C34 10, 42 14, 40 22 C42 30, 34 34, 22 22 Z" fill="rgb(var(--accent-glow))" />
        <circle cx="22" cy="22" r="4" fill="rgb(var(--text))" />
      </motion.svg>

      {/* Headline — cinematic face, glows in the seam light */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: open ? 0 : 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="absolute inset-x-0 top-1/2 px-6 text-center"
        style={{
          transform: "translateY(64px)",
          fontFamily: "var(--font-cinematic)",
          fontSize: "clamp(28px, 5vw, 52px)",
          color: "rgb(var(--text))",
          textShadow: "0 0 28px rgb(var(--accent-glow) / 0.55)",
        }}
      >
        {headline}
      </motion.p>
    </div>
  );
}
