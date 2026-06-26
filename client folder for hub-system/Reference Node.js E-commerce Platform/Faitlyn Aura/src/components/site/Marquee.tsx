import { motion } from "motion/react";

const ITEMS = [
  "Hand-finished in Lagos",
  "Single-donor virgin hair",
  "HD melt lace",
  "Complimentary worldwide shipping",
  "1-year atelier guarantee",
  "Reusable for 18 months+",
];

export function Marquee() {
  const loop = [...ITEMS, ...ITEMS, ...ITEMS];
  return (
    <section className="border-y border-taupe/15 bg-ink py-5 overflow-hidden">
      <motion.div
        className="flex gap-16 whitespace-nowrap"
        animate={{ x: ["0%", "-33.333%"] }}
        transition={{ duration: 32, ease: "linear", repeat: Infinity }}
      >
        {loop.map((t, i) => (
          <span key={i} className="text-[0.7rem] tracking-[0.4em] uppercase text-taupe/80 flex items-center gap-16">
            {t}
            <span className="w-1 h-1 rounded-full bg-taupe/40" />
          </span>
        ))}
      </motion.div>
    </section>
  );
}
