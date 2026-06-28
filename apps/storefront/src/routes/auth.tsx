import { createFileRoute, Link } from "@tanstack/react-router";
import { Section } from "@/components/parts";

export const Route = createFileRoute("/auth")({ component: AuthPage });

function AuthPage() {
  return (
    <Section className="max-w-md text-center">
      <h1 className="text-h3 font-display">Accounts</h1>
      <p className="mt-3 text-body text-muted-foreground">
        Customer accounts are coming soon. For now you can check out as a guest —
        we'll email your order confirmation and a tracking link.
      </p>
      <Link
        to="/shop"
        className="mt-8 inline-block rounded-full bg-primary px-6 py-2.5 text-body-sm text-primary-foreground"
      >
        Continue shopping
      </Link>
    </Section>
  );
}
