"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Copy,
  Check,
  Camera,
  Image as ImageIcon,
  Star,
  Gift,
  Zap,
} from "lucide-react";
import type { LandingPayload } from "@/lib/types";

export function CreatorModal({
  open,
  onClose,
  payload,
}: {
  open: boolean;
  onClose: () => void;
  payload: LandingPayload;
}) {
  const [copied, setCopied] = useState(false);

  const rawHandle = payload.brand?.instagram_handle ?? null;
  const handle = rawHandle ? `@${rawHandle.replace(/^@/, "")}` : null;

  const copyHandle = useCallback(async () => {
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(handle);
    } catch {
      // Fallback for browsers without clipboard API
      const ta = document.createElement("textarea");
      ta.value = handle;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.select();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [handle]);

  function launchInstagram(mode: "new" | "existing") {
    void copyHandle();
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) {
      window.open(
        "https://www.instagram.com/",
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    try {
      // iOS gets camera deeplink for new posts; Android stays on home
      const scheme =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) && mode === "new"
          ? "instagram://camera"
          : "instagram://";
      const fallback = window.setTimeout(() => {
        window.open(
          "https://www.instagram.com/",
          "_blank",
          "noopener,noreferrer",
        );
      }, 1500);
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.hidden) clearTimeout(fallback);
        },
        { once: true },
      );
      window.location.assign(scheme);
    } catch {
      window.open(
        "https://www.instagram.com/",
        "_blank",
        "noopener,noreferrer",
      );
    }
  }

  const REWARDS = [
    { Icon: Star, label: "Get Featured", sub: "Page & stories" },
    { Icon: Gift, label: "Win Prizes", sub: "Weekly draws" },
    { Icon: Zap, label: "Earn Credits", sub: "Discounts & more" },
  ] as const;

  const NEW_STEPS = [
    "Handle copied ✓",
    "Open Instagram",
    "Create a new post",
    "Paste tag in caption",
  ];
  const EXISTING_STEPS = [
    "Handle copied ✓",
    "Open Instagram",
    "Find your wig post",
    "Edit caption → paste tag",
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] grid place-items-center p-4"
        >
          {/* Backdrop — warm ink scrim so the glass reads over a uniform dark
              field (keeps text contrast no matter what image sits behind). */}
          <div
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: "rgb(var(--brand-ink) / 0.68)" }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ y: 28, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 28, opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="dropglass relative w-full max-w-[460px] rounded-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Creator Collective"
          >
            {/* Accent gradient bar */}
            <div
              className="h-[3px] w-full"
              style={{
                background:
                  "linear-gradient(90deg, rgb(var(--brand-accent) / 0), rgb(var(--brand-accent) / 0.85), rgb(var(--brand-accent) / 0))",
              }}
            />

            <div className="p-6 md:p-8">
              {/* Close */}
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-5 grid h-8 w-8 place-items-center rounded-lg transition hover:bg-white/10"
                aria-label="Close"
                style={{ color: "rgb(var(--text-muted))" }}
              >
                <X className="h-4 w-4" />
              </button>

              {/* IG icon + heading */}
              <div className="flex flex-col items-center text-center mb-6">
                <div
                  className="mb-4 grid h-14 w-14 place-items-center rounded-2xl"
                  style={{
                    background: "rgb(var(--brand-accent) / 0.15)",
                    border: "1px solid rgb(var(--brand-accent) / 0.3)",
                  }}
                >
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="2"
                      y="2"
                      width="20"
                      height="20"
                      rx="5"
                      stroke="rgb(var(--brand-accent))"
                      strokeWidth="1.6"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="4"
                      stroke="rgb(var(--brand-accent))"
                      strokeWidth="1.6"
                    />
                    <circle
                      cx="17.5"
                      cy="6.5"
                      r="1.2"
                      fill="rgb(var(--brand-accent))"
                    />
                  </svg>
                </div>
                <h2
                  className="font-display text-[22px] leading-tight"
                  style={{ color: "rgb(var(--text))" }}
                >
                  Creator Collective
                </h2>
                <p
                  className="mt-1.5 max-w-[300px] text-[13px] leading-snug"
                  style={{ color: "rgb(var(--text-muted))" }}
                >
                  Tag us in your wig post — get featured, win prizes &amp; earn
                  rewards
                </p>
              </div>

              {/* Handle copy box */}
              {handle ? (
                <div className="mb-6">
                  <p
                    className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.22em]"
                    style={{ color: "rgb(var(--text-muted))" }}
                  >
                    Tag us with
                  </p>
                  <div
                    className="flex items-center gap-2 rounded-xl px-4 py-3"
                    style={{
                      background: "rgb(var(--text) / 0.06)",
                      border: "1px solid rgb(var(--brand-accent) / 0.12)",
                    }}
                  >
                    <span
                      className="flex-1 font-display text-[20px] font-semibold tracking-tight"
                      style={{ color: "rgb(var(--brand-accent))" }}
                    >
                      {handle}
                    </span>
                    <button
                      type="button"
                      onClick={copyHandle}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all"
                      style={{
                        background: copied
                          ? "rgb(var(--success) / 0.18)"
                          : "rgb(var(--brand-accent) / 0.2)",
                        color: copied
                          ? "rgb(var(--success))"
                          : "rgb(var(--brand-accent))",
                        border: `1px solid ${
                          copied
                            ? "rgb(var(--success) / 0.3)"
                            : "rgb(var(--brand-accent) / 0.35)"
                        }`,
                      }}
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="mb-6 rounded-xl p-3 text-[12px]"
                  style={{
                    background: "rgb(var(--warn) / 0.08)",
                    border: "1px solid rgb(var(--warn) / 0.2)",
                    color: "rgb(var(--warn))",
                  }}
                >
                  Instagram handle not configured — add it in Hub Settings →
                  Business Profile → Social.
                </div>
              )}

              {/* Reward strip */}
              <div className="mb-6 grid grid-cols-3 gap-2">
                {REWARDS.map(({ Icon, label, sub }) => (
                  <div
                    key={label}
                    className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center"
                    style={{
                      background: "rgb(var(--text) / 0.04)",
                      border: "1px solid rgb(var(--brand-accent) / 0.08)",
                    }}
                  >
                    <Icon
                      className="h-4 w-4"
                      style={{ color: "rgb(var(--brand-accent))" }}
                    />
                    <span
                      className="text-[11.5px] font-semibold"
                      style={{ color: "rgb(var(--text))" }}
                    >
                      {label}
                    </span>
                    <span
                      className="text-[10px] leading-tight"
                      style={{ color: "rgb(var(--text-muted))" }}
                    >
                      {sub}
                    </span>
                  </div>
                ))}
              </div>

              {/* Two action paths */}
              <p
                className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.2em]"
                style={{ color: "rgb(var(--text-muted))" }}
              >
                How to tag us
              </p>
              <div className="mb-5 grid grid-cols-2 gap-3">
                {(
                  [
                    {
                      mode: "new" as const,
                      Icon: Camera,
                      label: "New Post",
                      steps: NEW_STEPS,
                    },
                    {
                      mode: "existing" as const,
                      Icon: ImageIcon,
                      label: "Existing Post",
                      steps: EXISTING_STEPS,
                    },
                  ] as const
                ).map(({ mode, Icon, label, steps }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => launchInstagram(mode)}
                    className="flex flex-col items-center gap-2.5 rounded-xl p-4 transition-all hover:scale-[1.02] active:scale-[0.99]"
                    style={{
                      background: "rgb(var(--brand-accent) / 0.08)",
                      border: "2px solid rgb(var(--brand-accent) / 0.35)",
                      textAlign: "left",
                    }}
                  >
                    <Icon
                      className="h-7 w-7"
                      style={{ color: "rgb(var(--brand-accent))" }}
                    />
                    <span
                      className="text-[13px] font-bold"
                      style={{ color: "rgb(var(--text))" }}
                    >
                      {label}
                    </span>
                    <ol className="w-full space-y-1">
                      {steps.map((step, si) => (
                        <li
                          key={si}
                          className="flex items-start gap-1.5 text-[10.5px]"
                          style={{ color: "rgb(var(--text-muted))" }}
                        >
                          <span
                            className="mt-[1px] flex-shrink-0 text-[9px] font-bold"
                            style={{ color: "rgb(var(--brand-accent))" }}
                          >
                            {si + 1}.
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </button>
                ))}
              </div>

              {/* Footer note */}
              <p
                className="text-center text-[11px] leading-relaxed"
                style={{ color: "rgb(var(--text-faint))" }}
              >
                We discover tagged posts on Instagram directly — no submission
                needed. We&apos;ll reach out when you&apos;re selected. ✨
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
