const PRESS = ["VOGUE", "ELLE", "HARPER'S BAZAAR", "ESSENCE", "BAZAAR ARABIA", "GQ"];
export function PressStrip() {
  return (
    <section className="border-y border-taupe/15 py-12">
      <p className="text-center text-[0.62rem] tracking-[0.5em] uppercase text-taupe/70 mb-8">As seen in</p>
      <div className="mx-auto max-w-[1400px] px-6 flex flex-wrap justify-center items-center gap-x-14 gap-y-6">
        {PRESS.map((p) => (
          <span key={p} className="font-display text-xl md:text-2xl text-cream/60 hover:text-cream transition-colors tracking-[0.15em]">{p}</span>
        ))}
      </div>
    </section>
  );
}
