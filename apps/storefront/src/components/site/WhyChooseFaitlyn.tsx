import { Reveal, RevealGroup, RevealItem } from "@/components/site/Reveal";
import { DEFAULT_HOME, type HomeContent } from "@/lib/home-content";

export function WhyChooseFaitlyn({
  content = DEFAULT_HOME.whyChoose,
}: {
  content?: HomeContent["whyChoose"];
}) {
  return (
    <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-28 md:py-40">
      <Reveal className="max-w-3xl mb-16">
        <p className="text-caption text-rose mb-4">{content.eyebrow}</p>
        <h2 className="text-h2">
          {content.heading}
          {content.headingAccent ? <em className="font-couture text-taupe">{content.headingAccent}</em> : null}
        </h2>
        {content.body ? (
          <p className="text-body-lg text-cream/70 mt-6 max-w-2xl">
            {content.body}
            {content.bodyAccent ? <span className="font-couture italic text-taupe">{content.bodyAccent}</span> : null}
          </p>
        ) : null}
      </Reveal>

      <RevealGroup className="grid sm:grid-cols-2 lg:grid-cols-5 gap-px bg-taupe/15 border border-taupe/15">
        {content.pillars.map((p) => (
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
