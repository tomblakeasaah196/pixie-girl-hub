import { useState } from "react";
import { Share, X } from "lucide-react";
import { cn } from "@/lib/cn";

const DISMISSED_KEY = "pixie_ios_install_dismissed";

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function IosInstallHint() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === "1",
  );

  if (dismissed || !isIos() || isStandalone()) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 text-[12.5px] leading-snug",
        "glass border-b border-accent/20",
      )}
    >
      <Share className="w-4 h-4 shrink-0 text-accent-glow" />
      <p className="min-w-0 text-text-muted">
        <span className="text-text-primary font-medium">Get alerts on this iPhone:</span>{" "}
        tap <span className="font-semibold text-text-primary">Share</span> then{" "}
        <span className="font-semibold text-text-primary">Add to Home Screen</span>
      </p>
      <button
        onClick={dismiss}
        aria-label="Dismiss install hint"
        className="no-min-h ml-auto grid place-items-center w-7 h-7 rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/10 transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
