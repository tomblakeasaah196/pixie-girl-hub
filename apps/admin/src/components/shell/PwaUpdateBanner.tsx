/**
 * PwaUpdateBanner — in-app "a new version is available" prompt.
 *
 * The service worker no longer force-refreshes the app on deploy (it parks a
 * new build in the `waiting` state instead). This banner is how the user finds
 * out and opts in: push.ts detects the waiting worker and dispatches
 * SW_UPDATE_EVENT; we surface a prominent snackbar, and "Update now" activates
 * the worker (skipWaiting → clients.claim → controllerchange → reload) so the
 * page loads the new code instantly.
 *
 * A background update check also runs on every route change, so a user who
 * leaves the tab open and keeps navigating still gets the prompt without a
 * hard reload.
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  SW_UPDATE_EVENT,
  applyServiceWorkerUpdate,
  checkForServiceWorkerUpdate,
} from "@/lib/push";

export function PwaUpdateBanner() {
  const { pathname } = useLocation();
  const [available, setAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Show the banner as soon as a waiting worker is announced.
  useEffect(() => {
    const onUpdate = () => setAvailable(true);
    window.addEventListener(SW_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
  }, []);

  // Background check on navigation — ask the browser to look for a newer build
  // whenever the route changes (SPA nav never re-fetches sw.js on its own).
  useEffect(() => {
    checkForServiceWorkerUpdate();
  }, [pathname]);

  // …and whenever the app returns to the foreground. An iOS home-screen PWA
  // is suspended, not killed, when "closed" — resuming restores the same JS
  // context with no navigation and no route change, so without this hook a
  // phone could run a stale build for days without ever hearing about a
  // deploy. visibilitychange → visible is exactly that resume moment.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        checkForServiceWorkerUpdate();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const handleUpdate = useCallback(() => {
    setUpdating(true);
    // The controllerchange listener in push.ts reloads once the new worker
    // takes control, so we don't reload here ourselves.
    applyServiceWorkerUpdate();
  }, []);

  if (!available) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[300] flex justify-center px-4 pb-[max(env(safe-area-inset-bottom,0px),16px)] pt-4 pointer-events-none max-md:bottom-16"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-3 w-full max-w-[440px]",
          "glass rounded-[14px] shadow-glass border border-accent/30",
          "px-4 py-3 animate-[slide-up_0.24s_ease-out]",
        )}
      >
        <span className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-accent/15">
          <RefreshCw className="w-4 h-4 text-accent-glow" />
        </span>
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-text-muted">
          <span className="text-text-primary font-semibold">
            A new version is available.
          </span>
        </p>
        <button
          onClick={handleUpdate}
          disabled={updating}
          className="no-min-h shrink-0 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold bg-accent text-text-primary hover:bg-accent-glow transition-colors disabled:opacity-60"
        >
          {updating ? "Updating…" : "Update now"}
        </button>
        <button
          onClick={() => setAvailable(false)}
          aria-label="Dismiss update notice"
          className="no-min-h grid place-items-center w-7 h-7 shrink-0 rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
