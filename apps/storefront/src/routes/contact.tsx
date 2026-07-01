import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "motion/react";
import { MessageCircle, Mail, MapPin, Clock, Instagram } from "lucide-react";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "Contact — Faitlyn Hair" }] }),
  component: Contact,
});

const WHATSAPP = "2348061987874";
const EMAIL = "hello@faitlynhair.com";
const STUDIO = "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos";

function Contact() {
  const [f, setF] = useState({ name: "", email: "", subject: "", message: "" });
  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const subject = f.subject ? `[${f.subject}] ` : "";
    const text = `Hi Faitlyn, I'm ${f.name || "a client"} (${f.email || "no email"}).%0A%0A${encodeURIComponent(subject + f.message)}`;
    window.open(`https://wa.me/${WHATSAPP}?text=${text}`, "_blank", "noopener");
  }

  const field =
    "input-line text-cream placeholder:text-cream/35 focus:border-taupe";

  return (
    <main className="bg-ink text-cream">
      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-36 md:pt-44 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">Concierge</p>
          <h1 className="mt-5 font-display text-5xl md:text-7xl leading-[0.95] tracking-tight text-balance">
            Let's talk <em className="font-couture text-taupe">hair</em>.
          </h1>
          <p className="mt-6 text-cream/70 leading-relaxed text-base md:text-lg max-w-xl">
            Sizing, shade-matching, bulk & trade orders, aftercare — our Lagos
            studio answers every message personally. <span className="font-couture italic text-taupe">Fait avec soin.</span>
          </p>
        </motion.div>

        <div className="mt-16 grid gap-14 lg:grid-cols-[1fr_1.1fr]">
          {/* Details */}
          <div className="space-y-8">
            <a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-4 border-t border-taupe/20 pt-6">
              <MessageCircle size={20} className="mt-0.5 text-taupe" />
              <div>
                <p className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe">WhatsApp</p>
                <p className="mt-1 font-display text-xl group-hover:text-taupe transition-colors">Chat with the studio</p>
                <p className="text-body-sm text-cream/60">Fastest reply · within the hour</p>
              </div>
            </a>
            <a href={`mailto:${EMAIL}`} className="group flex items-start gap-4 border-t border-taupe/20 pt-6">
              <Mail size={20} className="mt-0.5 text-taupe" />
              <div>
                <p className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe">Email</p>
                <p className="mt-1 font-display text-xl group-hover:text-taupe transition-colors">{EMAIL}</p>
                <p className="text-body-sm text-cream/60">For orders, press & partnerships</p>
              </div>
            </a>
            <div className="flex items-start gap-4 border-t border-taupe/20 pt-6">
              <MapPin size={20} className="mt-0.5 text-taupe" />
              <div>
                <p className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe">The Studio</p>
                <p className="mt-1 font-display text-xl">{STUDIO}</p>
                <p className="text-body-sm text-cream/60">By appointment</p>
              </div>
            </div>
            <div className="flex items-start gap-4 border-t border-taupe/20 pt-6">
              <Clock size={20} className="mt-0.5 text-taupe" />
              <div>
                <p className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe">Hours</p>
                <p className="mt-1 font-display text-xl">Mon – Sat · 9am – 6pm WAT</p>
              </div>
            </div>
            <a href="https://www.instagram.com/faitlynhair/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[0.62rem] tracking-[0.4em] uppercase text-taupe hover:text-cream transition-colors">
              <Instagram size={15} /> @faitlynhair
            </a>
          </div>

          {/* Form */}
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="border border-taupe/20 bg-card p-8 md:p-10"
          >
            <p className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe mb-8">Send a note</p>
            <div className="space-y-7">
              <input className={field} placeholder="Your name" value={f.name} onChange={set("name")} />
              <input className={field} type="email" placeholder="Email" value={f.email} onChange={set("email")} required />
              <input className={field} placeholder="Subject" value={f.subject} onChange={set("subject")} />
              <textarea className={`${field} min-h-[120px] resize-y`} placeholder="How can we help?" value={f.message} onChange={set("message")} required />
              <button type="submit" className="w-full bg-taupe text-ink py-4 text-[0.7rem] tracking-[0.4em] uppercase font-medium hover:bg-cream transition-colors">
                Send via WhatsApp
              </button>
              <p className="text-center text-[0.6rem] tracking-[0.15em] uppercase text-cream/40">
                Opens WhatsApp with your message pre-filled
              </p>
            </div>
          </motion.form>
        </div>
      </section>
    </main>
  );
}
