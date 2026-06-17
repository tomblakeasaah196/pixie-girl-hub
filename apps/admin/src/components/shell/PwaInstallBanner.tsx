import { useState, useEffect, useCallback, useRef } from "react";
import { Download, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

const DISMISSED_KEY = "pixie_pwa_install_dismissed";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function PwaInstallBanner() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [canShow, setCanShow] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === "1",
  );
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const onPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setCanShow(true);
    };

    const onInstalled = () => {
      deferredPrompt.current = null;
      setCanShow(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    const prompt = deferredPrompt.current;
    if (!prompt) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        deferredPrompt.current = null;
        setCanShow(false);
      }
    } finally {
      setInstalling(false);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }, []);

  if (dismissed || !canShow || isStandalone()) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 text-[12.5px] leading-snug",
        "glass border-b border-accent/20",
      )}
    >
      <Download className="w-4 h-4 shrink-0 text-accent-glow" />
      <p className="min-w-0 text-text-muted">
        <span className="text-text-primary font-medium">Install Pixie Hub</span>{" "}
        for a faster, app-like experience
      </p>
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <button
          onClick={handleInstall}
          disabled={installing}
          className="no-min-h px-3 py-1 rounded-md text-[11px] font-semibold bg-accent text-text-primary hover:bg-accent-glow transition-colors disabled:opacity-60"
        >
          {installing ? "Installing…" : "Install"}
        </button>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss install banner"
          className="no-min-h grid place-items-center w-7 h-7 rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
