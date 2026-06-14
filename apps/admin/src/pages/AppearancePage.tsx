import { cn } from "@/lib/cn";
import { hexToTriplet } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { Pill } from "@/components/ui/primitives";

/**
 * Settings → Appearance (canon §2.3). Layer A = platform skin (presets +
 * accent + mode). Layer B = per-business accent. Backend dependency:
 * persistence to shared.app_appearance (flagged); here it mutates CSS vars
 * live + the persisted theme/density in the UI store.
 */
const PRESETS = [
  { name: "Maroon Noir", desc: "Black · deep red · cream", mode: "dark", accent: "#a81d1d", deep: "#690909", sw: ["#0f0809", "#690909", "#f4e9d9"] },
  { name: "Porcelain White", desc: "White · deep red · ink", mode: "light", accent: "#690909", deep: "#690909", sw: ["#ffffff", "#690909", "#1a1011"] },
  { name: "Onyx Ruby", desc: "Neutral black · ruby", mode: "dark", accent: "#b11e1e", deep: "#9b1818", sw: ["#0c0b0d", "#b11e1e", "#fff9f3"] },
  { name: "Oxblood Luxe", desc: "Oxblood · red · bronze", mode: "dark", accent: "#690909", deep: "#690909", sw: ["#140b0c", "#690909", "#7f703d"] },
] as const;

const APP_ACCENTS = ["#690909", "#a81d1d", "#b11e1e", "#7f703d", "#1878b9", "#121212"];
const BRAND_ACCENTS = ["#690909", "#7f703d", "#d5b8a4", "#e97a7e", "#a81d1d", "#8a7d72"];

function setVar(k: string, v: string) {
  document.documentElement.style.setProperty(k, v);
}

export function AppearancePage() {
  const { theme, setTheme } = useUiStore();

  return (
    <div className="max-w-[640px]">
      <div className="flex items-center gap-2.5 mb-1.5">
        <Pill tone="danger" dot={false}>Layer A</Pill>
        <h3 className="font-display text-[17px] font-medium">App Appearance — the platform</h3>
      </div>
      <p className="text-xs text-text-muted mb-4">The white-label switch. Re-skin the whole ERP per client.</p>

      <div className="micro mb-2">Theme preset</div>
      <div className="grid grid-cols-2 gap-2.5 mb-6">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => { setTheme(p.mode as "dark" | "light"); setVar("--accent", hexToTriplet(p.accent)); setVar("--accent-glow", hexToTriplet(p.accent)); setVar("--accent-deep", hexToTriplet(p.deep)); }}
            className="text-left p-3 rounded-[13px] border hairline bg-text-primary/[0.03] hover:border-accent/40 transition-colors"
          >
            <div className="flex gap-1.5 mb-2.5">{p.sw.map((c) => <span key={c} className="w-[22px] h-[22px] rounded-[7px]" style={{ background: c }} />)}</div>
            <div className="font-display text-[15px]">{p.name}</div>
            <div className="text-[10px] text-text-faint">{p.desc}</div>
          </button>
        ))}
      </div>

      <div className="micro mb-2">App accent · used sparingly</div>
      <div className="flex gap-2.5 mb-6">
        {APP_ACCENTS.map((c) => (
          <button key={c} onClick={() => { setVar("--accent", hexToTriplet(c)); setVar("--accent-glow", hexToTriplet(c)); setVar("--accent-deep", hexToTriplet(c)); }} className="w-8 h-8 rounded-[10px] border-2 border-transparent hover:scale-110 transition-transform" style={{ background: c }} />
        ))}
      </div>

      <div className="micro mb-2">Mode</div>
      <div className="flex gap-1.5 mb-6 max-w-[280px]">
        {(["dark", "light"] as const).map((m) => (
          <button key={m} onClick={() => setTheme(m)} className={cn("flex-1 p-2.5 rounded-[11px] text-[12.5px] font-semibold capitalize border", theme === m ? "text-accent-glow border-accent/45 bg-accent/[0.08]" : "text-text-muted hairline")}>{m}</button>
        ))}
      </div>

      <div className="h-px bg-line/20 my-6" />

      <div className="flex items-center gap-2.5 mb-1.5">
        <Pill tone="info" dot={false}>Layer B</Pill>
        <h3 className="font-display text-[17px] font-medium">Brand Appearance — each business</h3>
      </div>
      <p className="text-xs text-text-muted mb-4">Per business — tints the chip, ambient wash &amp; medallions. Pixie deep-red · Faitlyn bronze.</p>
      <div className="micro mb-2">Active brand accent</div>
      <div className="flex gap-2.5">
        {BRAND_ACCENTS.map((c) => (
          <button key={c} onClick={() => setVar("--biz-accent", c)} className="w-8 h-8 rounded-[10px] border-2 border-transparent hover:scale-110 transition-transform" style={{ background: c }} />
        ))}
      </div>

      <p className="mt-7 text-[12px] text-text-faint">
        Persistence lands with <code>shared.app_appearance</code> (backend dependency, flagged in the canon). Theme &amp; density already persist locally.
      </p>
    </div>
  );
}
