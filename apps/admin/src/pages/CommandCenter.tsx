import { AlertTriangle, CheckCircle2, Sparkles, PackageCheck } from "lucide-react";
import { useGreeting } from "@/hooks/useGreeting";
import { useAuthStore } from "@/stores/auth";
import { useActiveBusiness } from "@/stores/business";
import { AppGrid } from "@/components/hub/AppGrid";
import { Card } from "@/components/ui/primitives";

/** Home / Command Center (canon §3.3): greeting + live clock + business chip,
 *  the app grid, then recent activity. */
export function CommandCenter() {
  const { time, greeting } = useGreeting();
  const user = useAuthStore((s) => s.user);
  const biz = useActiveBusiness();

  const hh = time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dd = time.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  // Literal class strings so Tailwind JIT can see them.
  const TONE_CLS: Record<string, string> = {
    success: "bg-success/[0.14] text-success",
    info: "bg-info/[0.16] text-info",
    warn: "bg-warn/[0.14] text-warn",
  };
  const recent = [
    { tone: "success", icon: CheckCircle2, a: "Payment received", b: "₦310k deposit · PXG-SO-10428", t: "12m" },
    { tone: "info", icon: Sparkles, a: "Praxis drafted a reminder", b: "Awaiting your confirm", t: "20m" },
    { tone: "warn", icon: AlertTriangle, a: "Low stock alert", b: 'Body Wave 24" · 3 left', t: "41m" },
    { tone: "success", icon: PackageCheck, a: "Order delivered", b: "PXG-SO-10425 · Lagos", t: "2h" },
  ] as const;

  return (
    <div>
      <div className="flex gap-6 items-start flex-wrap mb-8">
        <div className="flex-1 min-w-[280px]">
          <div className="text-[13px] text-text-muted">
            {greeting.primary}, <b className="text-accent-glow font-semibold">{user?.name}</b>
          </div>
          <h2 className="font-display font-medium leading-[1.04] my-2.5 max-w-[14ch] text-[clamp(28px,4.4vw,46px)]">
            What would you like to <em className="italic text-accent-glow">craft</em> today?
          </h2>
          <div className="text-text-muted text-sm max-w-[46ch]">{greeting.secondary}</div>
        </div>
        <Card className="relative overflow-hidden w-[min(250px,100%)] p-[18px_20px] text-right">
          <span className="pointer-events-none absolute -right-[30px] -top-[40px] w-[140px] h-[140px] rounded-full opacity-50 blur-[22px]"
            style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--biz-2) 40%, transparent), transparent 70%)" }} />
          <div className="relative font-display font-medium text-[42px] leading-none tabular-nums">{hh}</div>
          <div className="relative text-text-muted text-[12.5px] mt-1.5">{dd}</div>
          <div className="relative mt-3 pt-3 border-t hairline flex items-center gap-2.5 justify-end">
            <span className="w-6 h-6 rounded-[7px] grid place-items-center text-white font-display font-semibold text-xs"
              style={{ background: `linear-gradient(140deg, ${biz.grad1}, ${biz.grad2})` }}>{biz.monogram}</span>
            <span className="font-semibold text-[12.5px]">{biz.name}</span>
          </div>
        </Card>
      </div>

      <SectionHead title="Your apps" />
      <AppGrid badges={{ sales: 12, invoicing: 3, cash: 5, campaigns: 2 }} />

      <SectionHead title="Recent activity" />
      <Card className="overflow-hidden">
        {recent.map((r, i) => (
          <div key={i} className="flex items-center gap-3.5 p-[14px_18px] border-b hairline last:border-0 hover:bg-text-primary/[0.03] transition-colors">
            <span className={`w-[38px] h-[38px] rounded-[11px] grid place-items-center ${TONE_CLS[r.tone]}`}>
              <r.icon className="w-[18px] h-[18px]" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px]"><b className="text-text-primary">{r.a}</b></div>
              <div className="text-[11px] text-text-faint">{r.b}</div>
            </div>
            <div className="text-[11px] text-text-faint tabular-nums whitespace-nowrap">{r.t} ago</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mt-7 mb-4">
      <h3 className="font-display text-xl font-medium">{title}</h3>
      <span className="flex-1 h-px bg-line/20" />
    </div>
  );
}
