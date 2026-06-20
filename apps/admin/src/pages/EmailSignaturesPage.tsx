import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useEffect, useMemo, useState } from "react";
import { Mail } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { SaveBar } from "@/components/ui/Form";
import { useSignatureTemplate, useSaveSignatureTemplate } from "@/lib/settings";

/**
 * Settings → Email signatures. A raw HTML editor on the left, a live
 * preview on the right with sample tokens substituted. Dirty-aware SaveBar.
 */

const TOKENS: { token: string; sample: string; label: string }[] = [
  { token: "{{full_name}}", sample: "Ada Obi", label: "Sender full name" },
  { token: "{{job_title}}", sample: "Sales Lead", label: "Sender job title" },
  { token: "{{phone}}", sample: "+234 801 234 5678", label: "Sender phone" },
  { token: "{{email}}", sample: "ada.obi@pixiegirl.ng", label: "Sender email" },
  { token: "{{business_name}}", sample: "Pixie Girl", label: "Business name" },
  {
    token: "{{website}}",
    sample: "https://pixiegirl.ng",
    label: "Business website",
  },
];

function renderPreview(html: string): string {
  let out = html;
  for (const t of TOKENS) {
    out = out.split(t.token).join(t.sample);
  }
  return out;
}

const STARTER = `<table style="font-family: Arial, sans-serif; color: #1a1011;">
  <tr>
    <td>
      <strong>{{full_name}}</strong><br/>
      {{job_title}} · {{business_name}}<br/>
      {{phone}} · {{email}}
    </td>
  </tr>
</table>`;

export function EmailSignaturesPage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Email Signatures" },
  ]);
  const query = useSignatureTemplate();
  const save = useSaveSignatureTemplate();

  const saved = query.data?.html ?? "";
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);

  const dirty = draft !== saved;
  const preview = useMemo(() => renderPreview(draft), [draft]);

  if (query.isLoading) {
    return (
      <div className="max-w-[1100px] mx-auto">
        <Card className="p-5 text-text-muted">Loading signature template…</Card>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="max-w-[1100px] mx-auto">
        <Card className="overflow-hidden">
          <ErrorState
            message="We couldn't load the signature template."
            onRetry={() => query.refetch()}
          />
        </Card>
      </div>
    );
  }

  // "Empty" — no template yet. Offer a starter CTA.
  if (!saved && !dirty) {
    return (
      <div className="max-w-[1100px] mx-auto">
        <Header />
        <Card className="overflow-hidden">
          <EmptyState
            icon={<Mail className="w-7 h-7" />}
            title="No signature template yet"
            message="Create a shared HTML signature. Tokens are substituted per sender at send time."
            action={
              <button
                onClick={() => setDraft(STARTER)}
                className="h-9 px-4 rounded-[10px] text-[13px] font-semibold bg-accent-deep text-[#F4E9D9] hover:bg-accent"
              >
                Start from a template
              </button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto pb-24">
      <Header />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="micro mb-3">HTML source</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-[420px] p-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 font-mono text-[12.5px] leading-relaxed resize-none"
            placeholder="<table>…</table>"
          />
        </Card>

        <Card className="p-5">
          <div className="micro mb-3">Preview · sample tokens substituted</div>
          <div className="rounded-[11px] border border-line bg-white text-black p-4 min-h-[420px] overflow-auto">
            <div dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        </Card>
      </div>

      <Card className="p-5 mt-4">
        <div className="micro mb-3">Available tokens</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TOKENS.map((t) => (
            <div
              key={t.token}
              className="flex items-center justify-between gap-3 p-2.5 rounded-[10px] bg-text-primary/[0.03] border border-line"
            >
              <code className="font-mono text-[12px] text-accent-glow">
                {t.token}
              </code>
              <span className="text-[12px] text-text-muted truncate">
                {t.label}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4">
        <Card className="overflow-hidden">
          <SaveBar
            dirty={dirty}
            saving={save.isPending}
            onSave={() => save.mutate(draft)}
            onCancel={() => setDraft(saved)}
          />
        </Card>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-4">
      <h2 className="font-display text-xl font-medium">Email signatures</h2>
      <p className="text-[13px] text-text-muted mt-0.5">
        Shared HTML signature appended to outgoing email. Tokens are replaced
        per sender at send time.
      </p>
    </div>
  );
}
