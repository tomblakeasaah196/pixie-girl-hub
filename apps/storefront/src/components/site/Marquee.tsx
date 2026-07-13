import { DEFAULT_HOME } from "@/lib/home-content";

export function Marquee({ items = DEFAULT_HOME.marquee }: { items?: string[] }) {
  const loop = [...items, ...items];
  return (
    <section className="border-y border-taupe/15 bg-ink py-5 overflow-hidden">
      <div
        className="flex whitespace-nowrap"
        style={{ animation: "marquee-scroll 32s linear infinite", width: "200%" }}
      >
        {loop.map((t, i) => (
          <span key={i} className="text-[0.7rem] tracking-[0.4em] uppercase text-taupe/80 flex items-center gap-16 px-8">
            {t}
            <span className="w-1 h-1 rounded-full bg-taupe/40" />
          </span>
        ))}
      </div>
    </section>
  );
}
