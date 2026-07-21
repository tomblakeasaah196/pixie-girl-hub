/**
 * Praxis drawer (§6.29) — the persistent right-side slide-out, openable from
 * the FloatingLauncher on every admin screen. A self-contained mini workspace:
 * a gradient identity header, the welcome/thread body, and the pinned glass
 * composer. "Open full view" jumps to /praxis for history, trace and the
 * pending queue. Mounted once in AppShell; joins the ai_pending room while the
 * app is open so cards update live even when the drawer is closed.
 *
 * Bespoke (not the generic Drawer) so the header can carry the Praxis identity
 * and the composer can pin to the bottom without fighting the Drawer's padding.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Expand, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/primitives";
import { PraxisConversation } from "./PraxisConversation";
import { usePraxisDockStore } from "@/stores/praxis-dock";
import { usePraxisRealtime } from "@/lib/praxis-api";
import { useAuthStore } from "@/stores/auth";

export function PraxisDrawer() {
  const { open, conversationId, closeDock, setConversation } =
    usePraxisDockStore();
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);

  // Live pending-action pushes for every Praxis surface (drawer + page).
  usePraxisRealtime();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDock();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeDock]);

  if (!can("praxis_ai", "view")) return null;

  return createPortal(
    <>
      {/* Scrim */}
      <div
        onClick={closeDock}
        className={cn(
          "fixed inset-0 z-[80] bg-black/50 backdrop-blur-[3px] transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Praxis AI"
        className={cn(
          "fixed top-0 right-0 h-full z-[90] flex flex-col dropglass border-l pt-safe",
          "shadow-[-30px_0_80px_rgb(0_0_0/0.5)] transition-[transform,visibility] duration-300 ease-brand",
          "w-[min(440px,96vw)] lg:w-[480px]",
          open
            ? "translate-x-0 visible"
            : "translate-x-full invisible pointer-events-none",
        )}
      >
        {/* Identity header — accent wash + actions */}
        <header className="relative flex items-center gap-3 p-4 border-b hairline overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none opacity-70"
            style={{
              background:
                "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--biz-2) 30%, transparent), transparent 60%)",
            }}
          />
          <div className="relative grid place-items-center w-10 h-10 rounded-[13px] text-[#F4E9D9] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] shadow-[0_8px_22px_rgb(var(--accent-deep)/0.45)]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="relative min-w-0 flex-1">
            <h2 className="font-display text-lg font-medium leading-tight">
              Praxis
            </h2>
            <p className="text-[11px] text-text-muted truncate">
              Reads freely · writes only with your sign-off
            </p>
          </div>
          <div className="relative flex items-center gap-1">
            <IconButton
              aria-label="New conversation"
              onClick={() => setConversation(null)}
            >
              <Plus className="w-4 h-4" />
            </IconButton>
            <IconButton
              aria-label="Open full view"
              onClick={() => {
                closeDock();
                navigate("/praxis");
              }}
            >
              <Expand className="w-4 h-4" />
            </IconButton>
            <IconButton aria-label="Close" onClick={closeDock}>
              <X className="w-[18px] h-[18px]" />
            </IconButton>
          </div>
        </header>

        {/* Body — welcome/thread + pinned composer. */}
        <div className="flex-1 min-h-0">
          <PraxisConversation
            conversationId={conversationId}
            onConversationCreated={setConversation}
            variant="drawer"
            autoFocus
          />
        </div>
      </aside>
    </>,
    document.body,
  );
}
