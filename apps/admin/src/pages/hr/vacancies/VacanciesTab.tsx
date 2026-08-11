/**
 * Vacancies — a tab inside HR & Staff (backend module: `recruitment`).
 *
 * The vacancy-first flow: New vacancy → conversational AI intake drafts the whole
 * thing → review & publish to the public Careers page → applicants apply → track
 * them through the pipeline with AI match scoring + the 5-question rubric → move
 * a winner to "Offered", which hands off to the existing Recruitment tab.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Briefcase, MapPin, Users2, Sparkles } from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { vacancyApi, type Vacancy, type VacancyStatus } from "@/lib/vacancy-api";
import {
  fmtSalary,
  VACANCY_TONE,
  WORKPLACE_LABEL,
  EMPLOYMENT_LABEL,
} from "./vacancy-ui";
import { VacancyWizard } from "./VacancyWizard";
import { VacancyStudio } from "./VacancyStudio";

const BRAND_LABEL: Record<string, string> = {
  pixiegirl: "Pixie Girl Global",
  faitlynhair: "Faitlyn Hair",
};

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "published", label: "Published" },
  { key: "paused", label: "Paused" },
  { key: "closed", label: "Closed" },
];

export function VacanciesTab({
  canEdit,
  canCreate,
  canApprove,
}: {
  canEdit: boolean;
  canCreate: boolean;
  canApprove: boolean;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "new" | string>("list");
  const [filter, setFilter] = useState("");

  const { data: vacancies, isLoading } = useQuery({
    queryKey: ["vacancies", "list"],
    queryFn: () => vacancyApi.list(),
  });

  if (view === "new") {
    return (
      <VacancyWizard
        onCancel={() => setView("list")}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["vacancies", "list"] });
          setView(id);
        }}
      />
    );
  }

  if (view !== "list") {
    return (
      <VacancyStudio
        vacancyId={view}
        canEdit={canEdit}
        canApprove={canApprove}
        onBack={() => {
          setView("list");
          qc.invalidateQueries({ queryKey: ["vacancies", "list"] });
        }}
      />
    );
  }

  const rows = (vacancies ?? []).filter((v) => !filter || v.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-text-muted">
          Post a role, let AI draft the full job description, collect applications on your public
          Careers page, and track candidates with an AI match score. Move a winner to{" "}
          <span className="text-text-primary">Recruitment</span> for the offer.
        </p>
        {canCreate && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setView("new")}>
            New vacancy
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              filter === f.key
                ? "border-accent/30 bg-accent/15 text-accent-glow"
                : "border-line text-text-muted hover:text-text-primary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-[var(--radius)]" />
      ) : !rows.length ? (
        <EmptyState
          icon={<Briefcase className="h-6 w-6" />}
          title={filter ? "No vacancies here" : "No vacancies yet"}
          message={
            canCreate
              ? "Create a vacancy and let AI draft the whole job description from a few quick questions."
              : "No vacancies have been posted yet."
          }
        />
      ) : (
        <div className="grid gap-2">
          {rows.map((v) => (
            <VacancyCard key={v.vacancy_id} v={v} onOpen={() => setView(v.vacancy_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function VacancyCard({ v, onOpen }: { v: Vacancy; onOpen: () => void }) {
  const loc = [v.location_city, v.location_state, v.location_country].filter(Boolean).join(", ");
  return (
    <div onClick={onOpen} className="cursor-pointer">
      <Card className="p-4 transition-colors hover:border-accent/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-text-primary">{v.title}</span>
              <Pill tone={VACANCY_TONE[v.status as VacancyStatus]}>{v.status}</Pill>
              {v.ai_provider && v.ai_provider !== "template" && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-text-faint">
                  <Sparkles className="h-3 w-3" /> {v.ai_provider}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              {v.department && <span>{v.department}</span>}
              <span>{EMPLOYMENT_LABEL[v.employment_type] || v.employment_type}</span>
              <span>{WORKPLACE_LABEL[v.workplace_model]}</span>
              {loc && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {loc}
                </span>
              )}
              {!v.salary_hidden && (
                <span className="font-mono text-[11px] text-text-primary/80">
                  {fmtSalary(v.salary_min, v.salary_max, v.salary_currency, v.salary_period)}
                </span>
              )}
              {v.target_businesses?.length > 0 && (
                <span>{v.target_businesses.map((b) => BRAND_LABEL[b] || b).join(" + ")}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 text-xs text-text-muted">
              <Users2 className="h-3.5 w-3.5" />
              {v.application_count ?? 0}
            </span>
            {(v.new_count ?? 0) > 0 && (
              <Pill tone="info">{v.new_count} new</Pill>
            )}
            {v.headcount > 1 && (
              <span className="text-[10px] text-text-faint">{v.headcount} hires</span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

export default VacanciesTab;
