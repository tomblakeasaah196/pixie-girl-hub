import { RevealGroup, RevealItem } from "@/components/site/Reveal";
import pixie from "@/assets/product-pixie.jpg";
import bob from "@/assets/product-bob.jpg";
import curls from "@/assets/product-curls.jpg";
import straight from "@/assets/product-straight.jpg";
import models from "@/assets/faitlyn-models.jpg.asset.json";
import model2 from "@/assets/faitlyn-model-2.jpg.asset.json";
import hero from "@/assets/hero-model.webp.asset.json";

const IMGS = [pixie, bob, curls, straight, models.url, model2.url, hero.url, pixie];

export function Gallery() {
  return (
    <section className="py-28 md:py-40 border-t border-taupe/15">
      <div className="text-center mb-14 px-6">
        <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">@faitlynhair</p>
        <h2 className="font-display text-4xl md:text-6xl">Tagged on Instagram</h2>
      </div>
      <RevealGroup className="grid grid-cols-2 md:grid-cols-4 gap-1" stagger={0.06}>
        {IMGS.map((src, i) => (
          <RevealItem key={i} className="aspect-square overflow-hidden bg-card group cursor-pointer">
            <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700" />
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}
