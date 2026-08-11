import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { MapPin, ArrowUpRight, Briefcase } from "lucide-react";
import {
  listVacancies,
  formatBand,
  locationOf,
  WORKPLACE_LABEL,
  EMPLOYMENT_LABEL,
  type VacancyCard,
} from "@/lib/careers";

export const Route = createFileRoute("/careers")({
  head: () => ({ meta: [{ title: "Careers — join our team" }] }),
  component: Careers,
});

function Careers() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["careers", "list"],
    queryFn: () => listVacancies(),
  });

  return (
    <main className="bg-ink text-cream">
      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-32 lg:pt-36 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">Careers</p>
          <h1 className="mt-5 font-display text-5xl md:text-7xl leading-[0.95] tracking-tight text-balance">
            Build with <em className="font-couture text-taupe">us</em>.
          </h1>
          <p className="mt-6 text-cream/70 leading-relaxed text-base md:text-lg max-w-xl">
            We're growing our team. Explore open roles below and apply in minutes —
            <span className="font-couture italic text-taupe"> we read every application.</span>
          </p>
        </motion.div>

        <div className="mt-16">
          {isLoading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl border border-taupe/15 bg-cream/[0.03]" />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-2xl border border-taupe/20 p-10 text-center">
              <p className="text-cream/70">We couldn't load open roles right now.</p>
              <button onClick={() => refetch()} className="mt-4 text-sm text-taupe underline underline-offset-4">
                Try again
              </button>
            </div>
          ) : !data?.length ? (
            <div className="rounded-2xl border border-taupe/20 p-12 text-center">
              <Briefcase className="mx-auto h-7 w-7 text-taupe" />
              <p className="mt-4 font-display text-2xl">No open roles right now</p>
              <p className="mt-2 text-cream/60">
                Check back soon — or reach out via our Contact page to introduce yourself.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {data.map((v) => (
                <VacancyRow key={v.slug} v={v} />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function VacancyRow({ v }: { v: VacancyCard }) {
  const band = formatBand(v);
  const loc = locationOf(v);
  return (
    <Link
      to="/careers/$slug"
      params={{ slug: v.slug }}
      className="group flex items-center justify-between gap-4 rounded-2xl border border-taupe/15 bg-cream/[0.02] p-6 transition-colors hover:border-taupe/40"
    >
      <div className="min-w-0">
        <h2 className="font-display text-2xl leading-tight text-cream">{v.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-cream/60">
          {v.department && <span>{v.department}</span>}
          <span>{EMPLOYMENT_LABEL[v.employment_type] || v.employment_type}</span>
          <span>{WORKPLACE_LABEL[v.workplace_model] || v.workplace_model}</span>
          {loc && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {loc}
            </span>
          )}
          {band && <span className="text-cream/80">{band}</span>}
        </div>
      </div>
      <ArrowUpRight className="h-6 w-6 shrink-0 text-taupe transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  );
}
