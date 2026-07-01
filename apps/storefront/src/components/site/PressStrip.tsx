import { DEFAULT_HOME } from "@/lib/home-content";

export function PressStrip({
  eyebrow = DEFAULT_HOME.press.eyebrow,
  items = DEFAULT_HOME.press.items,
}: {
  eyebrow?: string;
  items?: string[];
}) {
  return (
    <section className="border-y border-taupe/15 py-12">
      <p className="text-center text-[0.62rem] tracking-[0.5em] uppercase text-taupe/70 mb-8">{eyebrow}</p>
      <div className="mx-auto max-w-[1400px] px-6 flex flex-wrap justify-center items-center gap-x-14 gap-y-6">
        {items.map((p) => (
          <span key={p} className="font-display text-xl md:text-2xl text-cream/60 hover:text-cream transition-colors tracking-[0.15em]">{p}</span>
        ))}
      </div>
    </section>
  );
}
