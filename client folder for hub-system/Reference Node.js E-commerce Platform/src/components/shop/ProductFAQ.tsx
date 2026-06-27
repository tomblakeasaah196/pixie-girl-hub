import { useState } from "react";
import { Reveal } from "@/components/site/Reveal";
import { ChevronDown } from "lucide-react";
import { DEFAULT_FAQ, type FAQContent } from "@/lib/site-content";
import { useSiteContent } from "@/lib/use-site-content";

export function ProductFAQ({
  content,
  productSlug,
}: {
  content?: FAQContent;
  productSlug?: string;
}) {
  const fallback = content ?? DEFAULT_FAQ;
  const key = productSlug ? `faq:product:${productSlug}` : "faq:global";
  const c = useSiteContent<FAQContent>(key, fallback);
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto max-w-[1100px] px-6 lg:px-10 py-20 md:py-28">
      <Reveal>
        <p className="text-caption text-rose mb-4">{c.eyebrow}</p>
        <h2 className="text-h3 mb-10">
          {c.title}
          {c.emphasis ? <em className="font-couture text-taupe"> {c.emphasis}</em> : null}
        </h2>
      </Reveal>
      <div className="border-t border-taupe/20">
        {c.items.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} className="border-b border-taupe/20">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-6 py-6 text-left group"
                aria-expanded={isOpen}
              >
                <span className="text-h6 text-cream group-hover:text-taupe transition-colors">{f.q}</span>
                <ChevronDown
                  className={`shrink-0 w-5 h-5 text-taupe transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              <div
                className={`grid transition-all duration-500 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100 pb-7" : "grid-rows-[0fr] opacity-0"}`}
              >
                <div className="overflow-hidden">
                  <p className="text-body text-cream/75 max-w-3xl leading-relaxed">{f.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
