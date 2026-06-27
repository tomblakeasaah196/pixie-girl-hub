import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ogMeta, jsonLd, breadcrumbLd, clamp } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  head: () => {
    const title = "Contact the Faitlyn Maison — Lagos & Worldwide";
    const description = clamp("Speak with our Lagos atelier — orders, press, custom commissions and stockist enquiries. Every message reaches a real person.", 158);
    const url = "/contact";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        jsonLd(breadcrumbLd([{ name: "Home", url: "/" }, { name: "Contact", url }])),
        jsonLd({
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: title,
          url,
          mainEntity: {
            "@type": "Organization",
            name: "Faitlyn Hair",
            email: "hello@faitlynhair.com",
            address: { "@type": "PostalAddress", addressLocality: "Victoria Island", addressRegion: "Lagos", addressCountry: "NG" },
          },
        }),
      ],
    };
  },
  component: ContactPage,
});

function ContactPage() {
  const [sent, setSent] = useState(false);
  return (
    <>
      <SiteHeader />
      <main className="pt-32 pb-20">
        <section className="mx-auto max-w-[1100px] px-6 lg:px-10 grid md:grid-cols-2 gap-16">
          <div>
            <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">Contact</p>
            <h1 className="font-display text-5xl md:text-7xl tracking-tight">Speak with the atelier.</h1>
            <p className="mt-6 text-cream/70 leading-relaxed max-w-md">
              For orders, custom pieces, press or stockist enquiries — leave us a note. Every message is read by a real
              human in Lagos.
            </p>
            <div className="mt-10 space-y-4 text-sm text-cream/80">
              <p><span className="text-taupe tracking-[0.3em] uppercase text-[0.65rem] block mb-1">Email</span>hello@faitlynhair.com</p>
              <p><span className="text-taupe tracking-[0.3em] uppercase text-[0.65rem] block mb-1">Studio</span>Victoria Island, Lagos</p>
              <p><span className="text-taupe tracking-[0.3em] uppercase text-[0.65rem] block mb-1">Hours</span>Mon — Sat · 10:00 — 19:00 WAT</p>
            </div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} className="space-y-5">
            {sent ? (
              <p className="font-display text-2xl text-taupe">Thank you. We'll be in touch within 24 hours.</p>
            ) : (
              <>
                <Field label="Your name"><input required className="w-full bg-transparent border-b border-taupe/30 py-3 focus:outline-none focus:border-taupe" /></Field>
                <Field label="Email"><input required type="email" className="w-full bg-transparent border-b border-taupe/30 py-3 focus:outline-none focus:border-taupe" /></Field>
                <Field label="Subject"><input className="w-full bg-transparent border-b border-taupe/30 py-3 focus:outline-none focus:border-taupe" /></Field>
                <Field label="Message"><textarea required rows={5} className="w-full bg-transparent border-b border-taupe/30 py-3 focus:outline-none focus:border-taupe resize-none" /></Field>
                <button className="mt-4 py-4 px-9 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors">Send note</button>
              </>
            )}
          </form>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">{label}</span>
      {children}
    </label>
  );
}
