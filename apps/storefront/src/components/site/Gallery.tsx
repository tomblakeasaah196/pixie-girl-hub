import { Instagram } from "lucide-react";
import { RevealGroup, RevealItem } from "@/components/site/Reveal";
import { DEFAULT_HOME, type GalleryItem } from "@/lib/home-content";

/**
 * "Tagged on Instagram" UGC grid. Each tile shows a photo; when the operator has
 * pasted an Instagram link for it (Studio → Pages → Home → Gallery), the tile
 * becomes a link that opens the post in a new tab and credits the handle on
 * hover. Tiles without a link render as plain, non-interactive images.
 */
export function Gallery({
  eyebrow = DEFAULT_HOME.gallery.eyebrow,
  heading = DEFAULT_HOME.gallery.heading,
  items = DEFAULT_HOME.gallery.items,
}: {
  eyebrow?: string;
  heading?: string;
  items?: GalleryItem[];
}) {
  return (
    <section className="py-28 md:py-40 border-t border-taupe/15">
      <div className="text-center mb-14 px-6">
        <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">{eyebrow}</p>
        <h2 className="font-display text-4xl md:text-6xl">{heading}</h2>
      </div>
      <RevealGroup className="grid grid-cols-2 md:grid-cols-4 gap-1" stagger={0.06}>
        {items.map((it, i) => (
          <RevealItem key={i} className="aspect-square overflow-hidden bg-card group">
            <GalleryTile item={it} />
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}

function GalleryTile({ item }: { item: GalleryItem }) {
  const img = (
    <img
      src={item.image}
      alt={item.handle ? `Tagged by ${item.handle}` : ""}
      loading="lazy"
      decoding="async"
      className="w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700"
    />
  );

  if (!item.href) {
    return <div className="relative h-full w-full">{img}</div>;
  }

  return (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={item.handle ? `View ${item.handle} on Instagram` : "View on Instagram"}
      className="relative block h-full w-full cursor-pointer"
    >
      {img}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-ink/75 to-transparent px-2 pb-3 pt-10 text-[0.66rem] tracking-[0.18em] uppercase text-cream opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <Instagram size={13} strokeWidth={1.75} />
        {item.handle || "View on Instagram"}
      </span>
    </a>
  );
}
