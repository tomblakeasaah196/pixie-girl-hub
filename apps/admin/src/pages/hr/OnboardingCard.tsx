/**
 * "Getting started" onboarding pack (meeting §3.7). Always visible on My HR:
 * a welcome, the brand onboarding checklist (ticked per employee), contracts to
 * review/sign, the employee's own documents, SOP articles, and handy links.
 *
 * Contract signing note: HR sends contracts for e-signature from the Documents
 * module; the employee signs via the emailed link (the in-app signer page is a
 * separate follow-up). Here we show each contract's status + a View button.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Rocket,
  CheckCircle2,
  Circle,
  FileSignature,
  FileText,
  BookOpen,
  ExternalLink,
  Download,
} from "lucide-react";
import { Card, Button, Pill } from "@/components/ui/primitives";
import { downloadDocumentById } from "@/lib/documents-api";
import { toggleOnboardingItem, type Onboarding, type HrContract } from "@/lib/hr-api";
import { SectionTitle, useNotify, errMsg } from "./hr-shared";

function signatureTone(status?: string | null) {
  if (status === "fully_signed" || status === "signed") return "success";
  if (status === "sent" || status === "partially_signed") return "warn";
  if (status === "declined" || status === "voided" || status === "cancelled") return "danger";
  return "neutral";
}
function signatureLabel(status?: string | null) {
  if (!status) return "not sent";
  return status.replace(/_/g, " ");
}

export function OnboardingCard({
  onboarding,
  contracts,
}: {
  onboarding: Onboarding;
  contracts: HrContract[];
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const toggle = useMutation({
    mutationFn: ({ key, completed }: { key: string; completed: boolean }) =>
      toggleOnboardingItem(key, completed),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-hr"] }),
    onError: (e) => notify("Couldn't update", errMsg(e), "high"),
  });
  const dl = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string | null }) => downloadDocumentById(id, name),
    onError: (e) => notify("Download failed", errMsg(e), "high"),
  });

  const pct = onboarding.total ? Math.round((onboarding.done / onboarding.total) * 100) : 0;
  const nothing =
    !onboarding.items.length &&
    !contracts.length &&
    !onboarding.documents.length &&
    !onboarding.help_articles.length &&
    !onboarding.links.length &&
    !onboarding.welcome;
  if (nothing) return null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon={<Rocket className="h-4 w-4 text-accent-glow" />}>Getting started</SectionTitle>
        {onboarding.total > 0 && (
          <Pill tone={pct === 100 ? "success" : "accent"}>{onboarding.done}/{onboarding.total} done</Pill>
        )}
      </div>

      {onboarding.welcome && (
        <p className="mt-1 text-sm text-text-muted">{onboarding.welcome}</p>
      )}

      {/* Checklist */}
      {onboarding.items.length > 0 && (
        <div className="mt-3">
          {onboarding.total > 0 && (
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-text-primary/[0.06]">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="space-y-1.5">
            {onboarding.items.map((it) => (
              <button
                key={it.key}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ key: it.key, completed: !it.completed })}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-text-primary/[0.03]"
              >
                {it.completed ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-text-faint" />
                )}
                <span className={it.completed ? "text-sm text-text-muted line-through" : "text-sm text-text-primary"}>
                  {it.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Contracts to review / sign */}
      {contracts.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">
            <FileSignature className="h-3.5 w-3.5" /> Contracts
          </div>
          <div className="space-y-1.5">
            {contracts.map((c) => (
              <div key={c.contract_id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-text-primary/[0.02] px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm capitalize text-text-primary">{c.contract_type.replace(/_/g, " ")}</span>
                  <div className="text-xs text-text-muted">
                    From {c.effective_from} · <span className="capitalize">{signatureLabel(c.signature_status)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={signatureTone(c.signature_status)}>{signatureLabel(c.signature_status)}</Pill>
                  {c.document_id && (
                    <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />}
                      disabled={dl.isPending}
                      onClick={() => dl.mutate({ id: c.document_id as string, name: c.contract_type })}>
                      View
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Your documents */}
      {onboarding.documents.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">
            <FileText className="h-3.5 w-3.5" /> Your documents
          </div>
          <div className="flex flex-wrap gap-2">
            {onboarding.documents.map((d) => (
              <button
                key={d.document_id}
                disabled={dl.isPending}
                onClick={() => dl.mutate({ id: d.document_id, name: d.title })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-text-primary/[0.02] px-3 py-1.5 text-xs text-text-primary transition-colors hover:border-accent/30"
              >
                <Download className="h-3.5 w-3.5 text-text-faint" />
                {d.title || d.document_type}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SOPs / read-up (Help Center) */}
      {onboarding.help_articles.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">
            <BookOpen className="h-3.5 w-3.5" /> Read up
          </div>
          <div className="space-y-1">
            {onboarding.help_articles.map((a) => (
              <Link key={a.article_id} to={`/help/${a.slug}`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-text-primary transition-colors hover:bg-text-primary/[0.03]">
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent-glow" />
                <span className="min-w-0 truncate">{a.title}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Handy links */}
      {onboarding.links.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">
            <ExternalLink className="h-3.5 w-3.5" /> Handy links
          </div>
          <div className="flex flex-wrap gap-2">
            {onboarding.links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-text-primary/[0.02] px-3 py-1.5 text-xs text-text-primary transition-colors hover:border-accent/30">
                <ExternalLink className="h-3.5 w-3.5 text-text-faint" />
                {l.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
