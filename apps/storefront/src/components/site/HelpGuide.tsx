import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useToolbar } from "@/lib/site-config";
import { useHelpOpen } from "@/lib/useStore";

/**
 * "How to shop" help guide — a shared glass modal opened from anywhere via
 * openHelp() (the header help icon and the footer "Help center" link). Content
 * (title + steps) is Studio-editable through the toolbar config. Previously this
 * lived inside the floating toolbar; it's now standalone so multiple entry
 * points can open the one guide.
 */
export function HelpGuide() {
  const cfg = useToolbar();
  const { open, setOpen } = useHelpOpen();
  const close = () => setOpen(false);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            display: "grid",
            placeItems: "center",
            padding: "1rem",
          }}
        >
          <div
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
            onClick={close}
          />
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={cfg.help.title}
            className="relative w-[min(460px,94vw)] rounded-2xl border border-taupe/20 bg-ink/95 backdrop-blur-xl p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={close}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-taupe hover:bg-cream/10 hover:text-cream transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="font-display text-[26px] leading-tight text-cream">
              {cfg.help.title}
            </h2>

            <ol className="mt-5 space-y-4">
              {cfg.help.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-full border border-taupe/40 text-[0.72rem] font-semibold text-taupe">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    {s.title ? (
                      <div className="text-[14px] font-semibold text-cream">
                        {s.title}
                      </div>
                    ) : null}
                    {s.body ? (
                      <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                        {s.body}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={close}
              className="mt-6 h-11 w-full rounded-full bg-taupe text-ink text-[0.7rem] tracking-[0.28em] uppercase font-semibold hover:bg-cream transition-colors"
            >
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
