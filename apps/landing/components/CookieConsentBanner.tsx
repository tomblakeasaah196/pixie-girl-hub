"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Shield } from "lucide-react";
import { useConsentStore } from "@/lib/consent-store";

export function CookieConsentBanner({ isEu }: { isEu: boolean }) {
  const status = useConsentStore((s) => s.status);
  const accept = useConsentStore((s) => s.accept);
  const reject = useConsentStore((s) => s.reject);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const visible = mounted && isEu && status === "undecided";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed bottom-0 inset-x-0 z-50 p-4 sm:p-6"
          role="dialog"
          aria-label="Cookie consent"
        >
          <div className="glass mx-auto max-w-2xl rounded-2xl px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Shield className="w-5 h-5 shrink-0 text-text-muted mt-0.5 sm:mt-0" />
            <p className="flex-1 text-sm leading-relaxed text-text-muted m-0">
              We use cookies to personalise ads and analyse traffic via Meta
              Pixel.{" "}
              <Link
                href="/privacy"
                className="underline underline-offset-2 hover:text-text-primary transition-colors"
              >
                Privacy &amp; Cookie Policy
              </Link>
            </p>
            <div className="flex gap-3 shrink-0 w-full sm:w-auto">
              <button
                onClick={reject}
                className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium rounded-xl border border-line text-text-muted hover:text-text-primary hover:border-text-faint transition-colors"
              >
                Decline
              </button>
              <button
                onClick={accept}
                className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium rounded-xl bg-accent text-white hover:brightness-110 transition-all"
              >
                Accept
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
