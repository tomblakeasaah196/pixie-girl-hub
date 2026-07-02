import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Sparkles, MessageCircle, HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUnreadCount } from "@/hooks/useCommandCenter";
import { useChatDockStore } from "@/stores/chat-dock";
import { usePraxisDockStore } from "@/stores/praxis-dock";
import { useUnreadMessages } from "@/hooks/useSmartcomm";

/**
 * Floating launcher (canon §3.4) — fans to Praxis · Messages · Help.
 * HOVER to expand on desktop; TAP on mobile. Carries the unread badge.
 */
export function FloatingLauncher() {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useUnreadCount();
  const { data: messagesUnread } = useUnreadMessages();
  const openDock = useChatDockStore((s) => s.openDock);
  const openPraxis = usePraxisDockStore((s) => s.openDock);
  const unread = (data?.unread ?? 0) + (messagesUnread?.unread_count ?? 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || isDesktop) return;
    const onDown = (e: PointerEvent) =>
      !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, isDesktop]);

  const mini = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    accent?: boolean,
  ) => (
    <button
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className={cn(
        "relative grid place-items-center w-12 h-12 rounded-full dropglass shadow-[0_8px_22px_rgb(0_0_0/0.4)] transition-all hover:scale-110 hover:border-accent/40",
        accent ? "text-accent-glow" : "text-text-primary",
      )}
    >
      <span className="absolute right-[60px] whitespace-nowrap dropglass px-2.5 py-1.5 rounded-[9px] text-[11px] font-semibold opacity-0 translate-x-1.5 transition-all peer-hover:opacity-100 group-hover/m:opacity-100 group-hover/m:translate-x-0">
        {label}
      </span>
      {icon}
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed right-6 bottom-6 max-lg:bottom-[calc(68px+max(env(safe-area-inset-bottom,0px),8px))] z-[70] flex flex-col items-center gap-2.5"
      onMouseEnter={isDesktop ? () => setOpen(true) : undefined}
      onMouseLeave={isDesktop ? () => setOpen(false) : undefined}
    >
      {open && (
        <div className="flex flex-col items-center gap-2.5 animate-fade-in">
          <div className="group/m">
            {mini("Help", <HelpCircle className="w-5 h-5" />, () =>
              navigate("/help"),
            )}
          </div>
          <div className="group/m">
            {mini("Messages", <MessageCircle className="w-5 h-5" />, () =>
              isDesktop ? openDock() : navigate("/smartcomm"),
            )}
          </div>
          <div className="group/m">
            {mini(
              "Praxis AI",
              <Sparkles className="w-5 h-5" />,
              () => openPraxis(),
              true,
            )}
          </div>
        </div>
      )}
      <button
        onClick={() => (isDesktop ? openPraxis() : setOpen((v) => !v))}
        aria-label="Quick actions"
        className={cn(
          "relative grid place-items-center w-[58px] h-[58px] rounded-[20px] text-[#F4E9D9] border border-white/10 shadow-[0_12px_30px_rgb(var(--accent-deep)/0.5)] transition-transform hover:-translate-y-0.5 hover:scale-105",
          "bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))]",
          open && "rotate-45",
        )}
      >
        {open ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1.5 rounded-[10px] bg-danger text-white text-[10px] font-bold grid place-items-center border-2 border-bg">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
