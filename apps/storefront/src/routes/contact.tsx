import { createFileRoute } from "@tanstack/react-router";
import { Mail, MessageCircle } from "lucide-react";
import { Section } from "@/components/parts";

export const Route = createFileRoute("/contact")({ component: Contact });

function Contact() {
  return (
    <Section className="max-w-2xl">
      <p className="text-caption">Get in touch</p>
      <h1 className="mt-2 text-h2 font-display">Contact us</h1>
      <p className="mt-6 text-body text-muted-foreground">
        We're here to help with sizing, orders and care. Reach us any time and
        we'll get back to you quickly.
      </p>
      <div className="mt-8 space-y-4">
        <a
          href="https://wa.me/?text=Hi!%20I%20have%20a%20question%20about%20my%20order."
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-secondary"
        >
          <MessageCircle size={20} />
          <span className="text-body">Chat with us on WhatsApp</span>
        </a>
        <a
          href="mailto:hello@example.com"
          className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-secondary"
        >
          <Mail size={20} />
          <span className="text-body">Email our support team</span>
        </a>
      </div>
    </Section>
  );
}
