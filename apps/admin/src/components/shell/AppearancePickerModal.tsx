import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/ui";
import { THEME_PRESETS, PRESET_SWATCHES } from "@/lib/theme-presets";

/**
 * Personal Appearance picker (account menu · self-service, no permission).
 *
 * Lets any user choose how the Hub looks *for them, on this device* — a
 * palette preset, dark/light, and density — without touching the shared
 * white-label identity (logo, product name, fonts) that only Settings →
 * Appearance controls. The choice is a client-side override layered over the
 * platform default by ThemeProvider; "Use platform default" clears it.
 */
export function AppearancePickerModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const density = useUiStore((s) => s.density);
  const setDensity = useUiStore((s) => s.setDensity);
  const themePreset = useUiStore((s) => s.themePreset);
  const setThemePreset = useUiStore((s) => s.setThemePreset);

  // Picking a preset also switches dark/light to the mode it was tuned for,
  // so the palette looks right the instant it's applied.
  const pickPreset = (name: string, mode: "dark" | "light") => {
    setThemePreset(name);
    setTheme(mode);
  };

  return (
    <Modal open={open} onClose={onClose} title="Appearance" size="md">
      <div className="space-y-6">
        <p className="text-[13px] text-text-muted -mt-1">
          Personal to you, on this device. Choose a look — it won&apos;t change
          the company logo, fonts, or anyone else&apos;s view.
        </p>

        {/* Palette presets */}
        <section className="space-y-3">
          <div className="micro">Palette</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {THEME_PRESETS.map((p) => {
              const active = themePreset === p.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => pickPreset(p.name, p.mode)}
                  aria-pressed={active}
                  className={cn(
                    "relative text-left p-3 rounded-[13px] border bg-text-primary/[0.03] transition-colors",
                    active
                      ? "border-accent/70 ring-1 ring-accent/40"
                      : "hairline hover:border-accent/40",
                  )}
                >
                  {active && (
                    <span className="absolute top-2 right-2 grid place-items-center w-5 h-5 rounded-full bg-accent/20 text-accent-glow">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                  <div className="flex gap-1.5 mb-2.5">
                    {PRESET_SWATCHES.map((t) => {
                      const v = p.patch[t];
                      return (
                        <span
                          key={t}
                          className="w-[20px] h-[20px] rounded-[6px] border hairline"
                          style={{
                            background: v ? `rgb(${v})` : "transparent",
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="font-display text-[14px]">{p.name}</div>
                  <div className="text-[10px] text-text-faint">{p.desc}</div>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setThemePreset(null)}
            className={cn(
              "inline-flex items-center gap-2 text-[12px] font-medium transition-colors",
              themePreset === null
                ? "text-accent-glow"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            <Monitor className="w-[14px] h-[14px]" />
            Use platform default
            {themePreset === null && <Check className="w-3.5 h-3.5" />}
          </button>
        </section>

        {/* Mode */}
        <section className="space-y-3">
          <div className="micro">Mode</div>
          <div className="inline-flex gap-1 bg-text-primary/[0.05] rounded-[12px] p-1">
            {(
              [
                { m: "dark" as const, label: "Dark", Icon: Moon },
                { m: "light" as const, label: "Light", Icon: Sun },
              ]
            ).map(({ m, label, Icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => setTheme(m)}
                aria-pressed={theme === m}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-1.5 text-[12.5px] font-semibold rounded-[9px] transition-colors",
                  theme === m
                    ? "bg-accent/15 text-accent-glow"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                <Icon className="w-[15px] h-[15px]" />
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Density */}
        <section className="space-y-3">
          <div className="micro">Density</div>
          <div className="inline-flex gap-1 bg-text-primary/[0.05] rounded-[12px] p-1">
            {(
              [
                { d: "comfortable" as const, label: "Comfortable" },
                { d: "compact" as const, label: "Compact" },
              ]
            ).map(({ d, label }) => (
              <button
                key={d}
                type="button"
                onClick={() => setDensity(d)}
                aria-pressed={density === d}
                className={cn(
                  "px-4 py-1.5 text-[12.5px] font-semibold rounded-[9px] transition-colors",
                  density === d
                    ? "bg-accent/15 text-accent-glow"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-6 flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
