import { Reveal, RevealGroup, RevealItem } from "@/components/site/Reveal";
import { WHY_CHOOSE_PILLARS, type Pillar } from "@/lib/site-content";
import { useSiteContent } from "@/lib/use-site-content";

export function WhyChooseFaitlyn({ pillars: propPillars }: { pillars?: Pillar[] } = {}) {
  // Studio-editable: override the `why_choose` key to change pillars sitewide.
  const pillars = useSiteContent<Pillar[]>("why_choose", propPillars ?? WHY_CHOOSE_PILLARS);
  return (
    <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-28 md:py-40">
      <Reveal className="max-w-3xl mb-16">
        <p className="text-caption text-rose mb-4">Why choose</p>
        <h2 className="text-h2">
          Faitlyn <em className="font-couture text-taupe">Hair</em>
        </h2>
        <p className="text-body-lg text-cream/70 mt-6 max-w-2xl">
          Each wig is handcrafted by artisans in our Lagos studio — made with precision, passion,
          and with women of colour in mind. <span className="font-couture italic text-taupe">Fait à la main.</span>
        </p>
      </Reveal>

      <RevealGroup className="grid sm:grid-cols-2 lg:grid-cols-5 gap-px bg-taupe/15 border border-taupe/15">
        {pillars.map((p) => (
          <RevealItem
            key={p.n}
            className="bg-ink p-7 md:p-8 flex flex-col min-h-[220px] group hover:bg-card transition-colors"
          >
            <span className="text-caption text-rose">{p.n}</span>
            <h3 className="text-h5 mt-4 text-cream">{p.t}</h3>
            <p className="text-body-sm text-cream/65 mt-3 leading-relaxed">{p.d}</p>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}
