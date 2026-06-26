import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import model2 from "@/assets/faitlyn-model-2.jpg.asset.json";

const KEY = "faitlyn.newsletter.seen.v1";

export function NewsletterModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(KEY)) return;
    const timer = setTimeout(() => setOpen(true), 25000);
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) { setOpen(true); cleanup(); }
    };
    document.addEventListener("mouseleave", onLeave);
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("mouseleave", onLeave);
    };
    return cleanup;
  }, []);

  const close = () => {
    setOpen(false);
    try { sessionStorage.setItem(KEY, "1"); } catch {}
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} className="fixed inset-0 bg-ink/80 backdrop-blur-md z-[95]" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(900px,92vw)] z-[96] bg-ink border border-taupe/30 grid md:grid-cols-2 overflow-hidden"
          >
            <div className="hidden md:block relative">
              <img src={model2.url} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-ink/40" />
            </div>
            <div className="p-8 md:p-12 flex flex-col justify-center relative">
              <button onClick={close} className="absolute top-4 right-4 text-taupe text-xs tracking-[0.3em] uppercase">Close</button>
              <p className="text-[0.65rem] tracking-[0.5em] uppercase text-taupe mb-4">The Letter</p>
              <h3 className="font-display text-3xl md:text-5xl leading-tight text-balance">
                One curated note. Once a month.
              </h3>
              <ul className="mt-6 space-y-2 text-sm text-cream/70">
                <li>· Early access to limited drops</li>
                <li>· Hair education from the Lagos atelier</li>
                <li>· Founder picks, no spam, ever</li>
              </ul>
              {sent ? (
                <p className="mt-8 text-taupe font-display text-xl">Welcome in. Check your inbox.</p>
              ) : (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (email) { setSent(true); setTimeout(close, 1800); } }}
                  className="mt-8 flex flex-col gap-3"
                >
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="bg-transparent border-b border-taupe/40 py-3 text-cream placeholder:text-muted-foreground focus:outline-none focus:border-taupe text-sm"
                  />
                  <button type="submit" className="mt-2 py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors">
                    Join the list
                  </button>
                </form>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
