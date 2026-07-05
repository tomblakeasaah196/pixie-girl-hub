/**
 * Praxis welcome hero — the empty-conversation state for both the drawer and
 * the full page (the Claude/Gemini "greeting + suggestions" moment).
 *
 * A time-of-day greeting, a gradient Praxis wordmark, a one-line brief, and a
 * grid of starter-prompt chips that seed the first turn. `variant` tunes the
 * scale: "drawer" is compact (fewer chips, tighter type), "page" is grand and
 * centred in the reading column.
 */

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { useGreeting } from "@/hooks/useGreeting";
import { useAuthStore } from "@/stores/auth";
import { PRAXIS_PROMPTS } from "./prompts";

/** First name only — the greeting stays personal but never stiff. */
function firstName(name?: string | null): string {
  if (!name) return "there";
  const n = name.trim().split(/\s+/)[0];
  return n || "there";
}

export function PraxisWelcome({
  variant = "page",
  onPick,
}: {
  variant?: "drawer" | "page";
  onPick: (prompt: string) => void;
}) {
  const { greeting } = useGreeting();
  const name = useAuthStore((s) => s.user?.name);
  const isPage = variant === "page";
  const prompts = isPage ? PRAXIS_PROMPTS : PRAXIS_PROMPTS.slice(0, 4);

  return (
    <div
      className={cn(
        "flex flex-col items-center text-center animate-rise-in",
        isPage ? "px-4 pt-[6vh] pb-8" : "px-2 pt-8 pb-4",
      )}
    >
      {/* Medallion */}
      <div
        className={cn(
          "grid place-items-center rounded-[22px] text-[#F4E9D9] shadow-[0_16px_40px_rgb(var(--accent-deep)/0.45)] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))]",
          isPage ? "w-16 h-16" : "w-12 h-12",
        )}
      >
        <Sparkles className={isPage ? "w-7 h-7" : "w-5 h-5"} />
      </div>

      {/* Greeting */}
      <h2
        className={cn(
          "font-display font-medium mt-5 leading-tight text-text-primary",
          isPage ? "text-[30px] sm:text-[38px]" : "text-[22px]",
        )}
      >
        {greeting.primary}, {firstName(name)}
      </h2>
      <p
        className={cn(
          "font-display leading-tight bg-clip-text text-transparent bg-[linear-gradient(110deg,rgb(var(--accent-glow)),var(--biz-1)_70%)]",
          isPage ? "text-[26px] sm:text-[32px] mt-1" : "text-[19px] mt-0.5",
        )}
      >
        How can Praxis help?
      </p>
      <p
        className={cn(
          "text-text-muted mt-3 max-w-[440px]",
          isPage ? "text-[13.5px]" : "text-[12px] px-2",
        )}
      >
        Ask about the business, draft copy, or tell Praxis what to do — every
        change it proposes waits for your sign-off before it runs.
      </p>

      {/* Suggestions */}
      <div
        className={cn(
          "w-full mt-7",
          isPage
            ? "max-w-[560px] grid gap-2.5 sm:grid-cols-2"
            : "grid gap-2",
        )}
      >
        {prompts.map((p, i) => (
          <button
            key={p.label}
            onClick={() => onPick(p.prompt)}
            style={{ animationDelay: `${80 + i * 55}ms` }}
            className={cn(
              "group animate-rise-in flex items-center gap-3 text-left rounded-2xl border border-line px-3.5 py-3 transition-all",
              "bg-text-primary/[0.03] hover:bg-accent/[0.08] hover:border-accent/35 hover:-translate-y-0.5",
            )}
          >
            <span className="grid place-items-center w-8 h-8 shrink-0 rounded-xl bg-accent/[0.1] text-accent-glow border border-accent/15 transition-colors group-hover:bg-accent/20">
              <p.icon className="w-4 h-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-text-primary truncate">
                {p.label}
              </span>
              <span className="block text-[11.5px] text-text-muted truncate">
                {p.prompt}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
