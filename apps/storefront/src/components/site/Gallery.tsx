import { RevealGroup, RevealItem } from "@/components/site/Reveal";
import { DEFAULT_HOME } from "@/lib/home-content";

export function Gallery({
  eyebrow = DEFAULT_HOME.gallery.eyebrow,
  heading = DEFAULT_HOME.gallery.heading,
  images = DEFAULT_HOME.gallery.images,
}: {
  eyebrow?: string;
  heading?: string;
  images?: string[];
}) {
  return (
    <section className="py-28 md:py-40 border-t border-taupe/15">
      <div className="text-center mb-14 px-6">
        <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">{eyebrow}</p>
        <h2 className="font-display text-4xl md:text-6xl">{heading}</h2>
      </div>
      <RevealGroup className="grid grid-cols-2 md:grid-cols-4 gap-1" stagger={0.06}>
        {images.map((src, i) => (
          <RevealItem key={i} className="aspect-square overflow-hidden bg-card group cursor-pointer">
            <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700" />
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}
