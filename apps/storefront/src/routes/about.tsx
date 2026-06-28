import { createFileRoute } from "@tanstack/react-router";
import { clientBrand } from "@/lib/brand";
import { Section } from "@/components/parts";

export const Route = createFileRoute("/about")({ component: About });

function About() {
  const brandName =
    typeof document !== "undefined" && clientBrand() === "faitlynhair"
      ? "Faitlyn Hair"
      : "Pixie Girl";
  return (
    <Section className="max-w-2xl">
      <p className="text-caption">Our story</p>
      <h1 className="mt-2 text-h2 font-display">{brandName}</h1>
      <div className="mt-6 space-y-4 text-body-lg text-muted-foreground">
        <p>
          {brandName} crafts luxury wigs for the woman who refuses to choose
          between ease and excellence. Every piece is hand-finished, shade-matched
          and made to move with you.
        </p>
        <p>
          From our atelier to your doorstep, we obsess over the details - the lace,
          the density, the fall - so you can simply wear it and go.
        </p>
      </div>
    </Section>
  );
}
