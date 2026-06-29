import type { Metadata } from "next";
import Link from "next/link";
import { getBrandConfig } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Privacy & Cookie Policy",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-text-primary mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function PrivacyPage() {
  const brand = await getBrandConfig();

  return (
    <main className="min-h-screen py-16 px-6 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-10"
        >
          &larr; Back
        </Link>

        <h1 className="font-display text-3xl sm:text-4xl font-semibold mb-2 text-text-primary">
          Privacy &amp; Cookie Policy
        </h1>
        <p className="text-sm text-text-faint mb-12">Last updated: June 2026</p>

        <div className="space-y-10 text-text-muted text-sm leading-relaxed">
          <Section title="Who We Are">
            <p>
              {brand.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates this
              website. This policy explains how we handle your data when you
              visit our sales pages or make a purchase.
            </p>
          </Section>

          <Section title="What We Collect">
            <p>When you browse our site we may collect:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong className="text-text-primary">Browsing data</strong>{" "}
                &mdash; pages viewed, time on page, referring URL.
              </li>
              <li>
                <strong className="text-text-primary">Device data</strong>{" "}
                &mdash; browser type, screen size, operating system.
              </li>
              <li>
                <strong className="text-text-primary">Location</strong> &mdash;
                your country, derived from your IP address and used only to
                determine which privacy laws apply.
              </li>
            </ul>
            <p className="mt-3">
              When you make a purchase we also collect your name, email, phone
              number and delivery address. Payment is handled by our payment
              partners &mdash; we never see or store your card details.
            </p>
          </Section>

          <Section title="Cookies We Use">
            <p className="mb-4">
              Cookies are small files stored on your device. We use two
              categories:
            </p>

            <h3 className="font-semibold text-text-primary text-xs uppercase tracking-wider mb-2">
              Essential
            </h3>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-line text-left text-text-faint">
                    <th className="py-2 pr-4">Cookie</th>
                    <th className="py-2 pr-4">Purpose</th>
                    <th className="py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line">
                    <td className="py-2 pr-4 font-mono">pgh-cookie-consent</td>
                    <td className="py-2 pr-4">Remembers your cookie choice</td>
                    <td className="py-2">Persistent</td>
                  </tr>
                  <tr className="border-b border-line">
                    <td className="py-2 pr-4 font-mono">pgh-cart</td>
                    <td className="py-2 pr-4">Stores your shopping cart</td>
                    <td className="py-2">Session</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="font-semibold text-text-primary text-xs uppercase tracking-wider mb-2">
              Marketing (require consent in EU/EEA/UK)
            </h3>
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-line text-left text-text-faint">
                    <th className="py-2 pr-4">Cookie</th>
                    <th className="py-2 pr-4">Purpose</th>
                    <th className="py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line">
                    <td className="py-2 pr-4 font-mono">_fbp</td>
                    <td className="py-2 pr-4">
                      Meta Pixel &mdash; tracks ad performance
                    </td>
                    <td className="py-2">90 days</td>
                  </tr>
                  <tr className="border-b border-line">
                    <td className="py-2 pr-4 font-mono">_fbc</td>
                    <td className="py-2 pr-4">
                      Meta Pixel &mdash; links ad clicks to site actions
                    </td>
                    <td className="py-2">90 days</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Marketing cookies are loaded <strong>only</strong> after you click
              &ldquo;Accept&rdquo; on the cookie banner. If you decline, these
              cookies are never set.
            </p>
          </Section>

          <Section title="Legal Basis">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-text-primary">
                  EU/EEA/UK visitors:
                </strong>{" "}
                We rely on your consent (GDPR Art.&nbsp;6(1)(a)) for marketing
                cookies. Essential cookies operate under legitimate interest.
              </li>
              <li>
                <strong className="text-text-primary">All visitors:</strong>{" "}
                Purchase data is processed to fulfil your order (contractual
                necessity).
              </li>
            </ul>
          </Section>

          <Section title="Data Sharing">
            <p>
              Marketing-cookie data is shared with Meta (Facebook) for ad
              targeting and performance measurement. We do not sell your personal
              data to any third party.
            </p>
          </Section>

          <Section title="Your Rights">
            <p>If you are in the EU/EEA/UK you have the right to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Access the data we hold about you.</li>
              <li>Request deletion of your data.</li>
              <li>
                Withdraw cookie consent at any time by clearing your browser
                cookies.
              </li>
              <li>
                Lodge a complaint with your local data protection authority.
              </li>
            </ul>
          </Section>

          <Section title="How to Control Cookies">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong className="text-text-primary">Consent banner:</strong>{" "}
                Choose &ldquo;Accept&rdquo; or &ldquo;Decline&rdquo; when
                prompted.
              </li>
              <li>
                <strong className="text-text-primary">Browser settings:</strong>{" "}
                Block or delete cookies via your browser&rsquo;s privacy
                controls.
              </li>
              <li>
                <strong className="text-text-primary">Reset consent:</strong>{" "}
                Clear{" "}
                <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-panel-2">
                  pgh-cookie-consent
                </code>{" "}
                from localStorage to see the banner again.
              </li>
            </ul>
          </Section>

          <Section title="Contact">
            <p>
              For privacy enquiries, email{" "}
              <a
                href={`mailto:${brand.fromEmail}`}
                className="underline underline-offset-2 hover:text-text-primary transition-colors"
              >
                {brand.fromEmail}
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
