/**
 * Praxis drawer (§6.29) — the persistent right-side slide-out, openable from
 * the FloatingLauncher on every admin screen. Quick chat + confirm cards;
 * "Open full view" jumps to /praxis for history, trace and the pending
 * queue. Mounted once in AppShell; joins the ai_pending room while the app
 * is open so cards update live even when the drawer is closed.
 */

import { useNavigate } from "react-router-dom";
import { Expand, Plus, Sparkles } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
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

  if (!can("praxis_ai", "view")) return null;

  return (
    <Drawer
      open={open}
      onClose={closeDock}
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="w-4.5 h-4.5 text-accent-glow" />
          Praxis
        </span>
      }
      subtitle="Your AI operator — reads freely, writes only with your sign-off"
      leading={
        <>
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
        </>
      }
    >
      {/* Cancel the Drawer body's padding/scroll — the thread manages its own
          scroll area so the composer stays pinned to the bottom. */}
      <div className="h-full -m-[22px]">
        <PraxisConversation
          conversationId={conversationId}
          onConversationCreated={setConversation}
          autoFocus
        />
      </div>
    </Drawer>
  );
}
