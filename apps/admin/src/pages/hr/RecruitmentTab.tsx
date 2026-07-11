/**
 * Recruitment — a tab inside HR & Staff (backend module: `recruitment`).
 *
 * Flow: New role → AI drafts the JD + Offer Letter (Gemini → DeepSeek → template)
 * → the Offer Studio (split-screen: edit on the left, live branded preview on the
 * right) → enter candidate details → Approve & send (emails a no-login /offer
 * link) → candidate signs → an admin clicks "Provision & email credentials".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Plus,
  ArrowLeft,
  Send,
  Save,
  RefreshCw,
  KeyRound,
  Building2,
  FileSignature,
  Settings2,
  Download,
  FileDown,
  PenLine,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { accessApi } from "@/lib/access-api";
import {
  recruitmentApi,
  type Offer,
  type OfferStatus,
  type OfferPdfDoc,
  type ContextRow,
} from "@/lib/recruitment-api";
import { SignaturePad } from "@/components/sign/SignaturePad";
import { useNotify, errMsg } from "./hr-shared";

const BRANDS = [
  { key: "pixiegirl", label: "Pixie Girl Global" },
  { key: "faitlynhair", label: "Faitlyn Hair" },
];

const STATUS_TONE: Record<OfferStatus, "neutral" | "accent" | "warn" | "success" | "info"> = {
  draft: "neutral",
  sent: "info",
  viewed: "info",
  signed: "accent",
  contracted: "accent",
  provisioned: "success",
  declined: "warn",
  withdrawn: "warn",
};

const input =
  "w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary";

// ── Tab root ───────────────────────────────────────────────
export function RecruitmentTab({
  canEdit,
  canExport = false,
}: {
  canEdit: boolean;
  canExport?: boolean;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);

  const { data: offers, isLoading } = useQuery({
    queryKey: ["recruitment", "offers"],
    queryFn: () => recruitmentApi.listOffers(),
  });

  if (selected) {
    return (
      <OfferStudio
        offerId={selected}
        canEdit={canEdit}
        canExport={canExport}
        onBack={() => {
          setSelected(null);
          qc.invalidateQueries({ queryKey: ["recruitment", "offers"] });
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          AI-drafted job descriptions &amp; offer letters, e-signed by the candidate, with the
          contract generated on signature.
        </p>
        <div className="flex gap-2">
          {canEdit && (
            <Button icon={<Settings2 className="h-4 w-4" />} onClick={() => setCtxOpen(true)}>
              Company context
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
              New role
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-[var(--radius)]" />
      ) : !offers?.length ? (
        <EmptyState
          icon={<FileSignature className="h-6 w-6" />}
          title="No offers yet"
          message="Create a role and let AI draft the job description and offer letter for you."
        />
      ) : (
        <div className="space-y-2">
          {offers.map((o) => (
            <div key={o.offer_id} onClick={() => setSelected(o.offer_id)} className="cursor-pointer">
            <Card
              className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-accent/30"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-text-primary">{o.title}</span>
                  <Pill tone={STATUS_TONE[o.status]}>{o.status}</Pill>
                  {o.ai_provider && o.ai_provider !== "template" && (
                    <span className="text-[10px] text-text-faint">via {o.ai_provider}</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-text-muted">
                  {o.candidate_name || "No candidate yet"}
                  {o.candidate_email ? ` · ${o.candidate_email}` : ""}
                  {o.target_businesses?.length
                    ? ` · ${o.target_businesses
                        .map((b) => BRANDS.find((x) => x.key === b)?.label || b)
                        .join(" + ")}`
                    : ""}
                </div>
              </div>
              <ArrowLeft className="h-4 w-4 shrink-0 rotate-180 text-text-faint" />
            </Card>
            </div>
          ))}
        </div>
      )}

      <NewRoleModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          setNewOpen(false);
          qc.invalidateQueries({ queryKey: ["recruitment", "offers"] });
          setSelected(id);
        }}
      />
      <ContextModal open={ctxOpen} onClose={() => setCtxOpen(false)} />
    </div>
  );
}

// ── New role (intake → AI draft) ───────────────────────────
function NewRoleModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (offerId: string) => void;
}) {
  const notify = useNotify("Recruitment: new role");
  const [f, setF] = useState({
    title: "",
    target_businesses: ["pixiegirl"] as string[],
    candidate_name: "",
    candidate_email: "",
    reporting_to: "the CEO",
    employment_type: "full_time",
    location: "Lagos, Nigeria",
    seniority: "",
    experience_years: "",
    salary_probation: "",
    salary_post_probation: "",
    variable_pay: "",
    probation_months: 3,
    review_days: 60,
    start_date: "",
    responsibilities: "",
    use_ai: true,
  });

  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const toggleBrand = (key: string) =>
    set({
      target_businesses: f.target_businesses.includes(key)
        ? f.target_businesses.filter((b) => b !== key)
        : [...f.target_businesses, key],
    });

  const mut = useMutation({
    mutationFn: () =>
      recruitmentApi.draftOffer({
        title: f.title,
        target_businesses: f.target_businesses,
        candidate_name: f.candidate_name || undefined,
        candidate_email: f.candidate_email || undefined,
        use_ai: f.use_ai,
        intake: {
          reporting_to: f.reporting_to,
          employment_type: f.employment_type,
          location: f.location,
          seniority: f.seniority,
          experience_years: f.experience_years,
          salary_probation: f.salary_probation,
          salary_post_probation: f.salary_post_probation,
          variable_pay: f.variable_pay,
          probation_months: Number(f.probation_months),
          review_days: Number(f.review_days),
          start_date: f.start_date,
          responsibilities: f.responsibilities
            ? f.responsibilities.split("\n").map((s) => s.trim()).filter(Boolean)
            : undefined,
        },
      }),
    onSuccess: (offer) => onCreated(offer.offer_id),
    onError: (e) => notify("Couldn't draft", errMsg(e), "high"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New role"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<Sparkles className="h-4 w-4" />}
            disabled={!f.title.trim() || !f.target_businesses.length || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Drafting…" : f.use_ai ? "Draft with AI" : "Create draft"}
          </Button>
        </>
      }
    >
      <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        <Field label="Role title">
          <input className={input} value={f.title} onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Marketing & Business Development Officer" autoComplete="off" />
        </Field>

        <Field label="Which brands does this role serve?">
          <div className="flex flex-wrap gap-2">
            {BRANDS.map((b) => {
              const on = f.target_businesses.includes(b.key);
              return (
                <button key={b.key} type="button" onClick={() => toggleBrand(b.key)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    on ? "border-accent/30 bg-accent/15 text-accent-glow" : "border-line text-text-muted"
                  }`}>
                  {b.label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Candidate name (optional)">
            <input className={input} value={f.candidate_name}
              onChange={(e) => set({ candidate_name: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Candidate email (optional)">
            <input className={input} type="email" value={f.candidate_email}
              onChange={(e) => set({ candidate_email: e.target.value })} autoComplete="off" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reports to">
            <input className={input} value={f.reporting_to}
              onChange={(e) => set({ reporting_to: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Employment type">
            <select className={input} value={f.employment_type}
              onChange={(e) => set({ employment_type: e.target.value })}>
              {["full_time", "part_time", "contract"].map((t) => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <input className={input} value={f.location}
              onChange={(e) => set({ location: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Experience (years)">
            <input className={input} value={f.experience_years}
              onChange={(e) => set({ experience_years: e.target.value })}
              placeholder="e.g. 5–7" autoComplete="off" />
          </Field>
          <Field label="Salary — probation">
            <input className={input} value={f.salary_probation}
              onChange={(e) => set({ salary_probation: e.target.value })}
              placeholder="e.g. ₦220,000/month" autoComplete="off" />
          </Field>
          <Field label="Salary — post-probation">
            <input className={input} value={f.salary_post_probation}
              onChange={(e) => set({ salary_post_probation: e.target.value })}
              placeholder="e.g. ₦300,000/month" autoComplete="off" />
          </Field>
          <Field label="Variable pay (optional)">
            <input className={input} value={f.variable_pay}
              onChange={(e) => set({ variable_pay: e.target.value })}
              placeholder="e.g. commission + bonus" autoComplete="off" />
          </Field>
          <Field label="Start date (optional)">
            <input className={input} type="date" value={f.start_date}
              onChange={(e) => set({ start_date: e.target.value })} />
          </Field>
          <Field label="Probation (months)">
            <input className={input} type="number" min={0} max={12} value={f.probation_months}
              onChange={(e) => set({ probation_months: Number(e.target.value) })} />
          </Field>
          <Field label="Review milestone (day)">
            <input className={input} type="number" min={0} max={180} value={f.review_days}
              onChange={(e) => set({ review_days: Number(e.target.value) })} />
          </Field>
        </div>

        <Field label="Key responsibilities (optional — one per line)">
          <textarea className={input} rows={3} value={f.responsibilities}
            onChange={(e) => set({ responsibilities: e.target.value })}
            placeholder={"Own strategy & execution\nMarket research\nHit quantifiable targets"} />
        </Field>

        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={f.use_ai} onChange={(e) => set({ use_ai: e.target.checked })} />
          Draft with AI (Gemini, DeepSeek fallback). Off = start from a template you edit.
        </label>
      </div>
    </Modal>
  );
}

// ── Offer Studio (split-screen edit + preview) ─────────────
function OfferStudio({
  offerId,
  canEdit,
  canExport,
  onBack,
}: {
  offerId: string;
  canEdit: boolean;
  canExport: boolean;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify("Recruitment: studio");
  const { data: offer, isLoading } = useQuery({
    queryKey: ["recruitment", "offer", offerId],
    queryFn: () => recruitmentApi.getOffer(offerId),
  });
  const { data: roles } = useQuery({
    queryKey: ["access", "roles"],
    queryFn: () => accessApi.listRoles(),
  });

  const [d, setD] = useState<Offer | null>(null);
  const [expiresDays, setExpiresDays] = useState(14);
  useEffect(() => {
    if (offer) setD(offer);
  }, [offer]);

  const locked = useMemo(
    () => !!d && ["signed", "contracted", "provisioned"].includes(d.status),
    [d],
  );

  const inval = () => {
    qc.invalidateQueries({ queryKey: ["recruitment", "offer", offerId] });
    qc.invalidateQueries({ queryKey: ["recruitment", "offers"] });
  };

  const editableBody = (o: Offer) => ({
    title: o.title,
    candidate_name: o.candidate_name || undefined,
    candidate_email: o.candidate_email || undefined,
    target_businesses: o.target_businesses,
    jd_markdown: o.jd_markdown,
    offer_markdown: o.offer_markdown,
    offer_meta: o.offer_meta,
    role_ids: o.role_ids,
    is_ceo: o.is_ceo,
  });

  const save = useMutation({
    mutationFn: () => recruitmentApi.editOffer(offerId, editableBody(d!)),
    onSuccess: () => { inval(); notify("Saved"); },
    onError: (e) => notify("Couldn't save", errMsg(e), "high"),
  });
  const regen = useMutation({
    mutationFn: () => recruitmentApi.regenerate(offerId, { ...d!.offer_meta, title: d!.title }),
    onSuccess: (o) => { setD(o); inval(); notify("Redrafted with AI"); },
    onError: (e) => notify("Couldn't redraft", errMsg(e), "high"),
  });
  const send = useMutation({
    mutationFn: () =>
      recruitmentApi.send(offerId, { ...editableBody(d!), expires_in_days: expiresDays }),
    onSuccess: (o) => { setD(o); inval(); notify("Offer sent", "The candidate has been emailed a signing link."); },
    onError: (e) => notify("Couldn't send", errMsg(e), "high"),
  });
  const provision = useMutation({
    mutationFn: () => recruitmentApi.provision(offerId),
    onSuccess: (r) => { inval(); notify("Login provisioned", `Credentials emailed to ${r.email}.`); },
    onError: (e) => notify("Couldn't provision", errMsg(e), "high"),
  });

  if (isLoading || !d) {
    return (
      <div className="space-y-3">
        <Button size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Back</Button>
        <Skeleton className="h-[60vh] rounded-[var(--radius)]" />
      </div>
    );
  }

  const setMeta = (patch: Record<string, unknown>) =>
    setD({ ...d, offer_meta: { ...d.offer_meta, ...patch } });
  const readOnly = locked || !canEdit;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Back</Button>
          <Pill tone={STATUS_TONE[d.status]}>{d.status}</Pill>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport && <DownloadMenu offerId={offerId} title={d.title} />}
          {!readOnly && (
            <>
              <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />}
                disabled={regen.isPending} onClick={() => regen.mutate()}>
                {regen.isPending ? "Redrafting…" : "Redraft with AI"}
              </Button>
              <Button size="sm" icon={<Save className="h-3.5 w-3.5" />}
                disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />}
                disabled={send.isPending || !d.candidate_email}
                onClick={() => send.mutate()}>
                {send.isPending ? "Sending…" : d.status === "draft" ? "Approve & send" : "Resend"}
              </Button>
            </>
          )}
          {canEdit && ["signed", "contracted"].includes(d.status) && !d.provisioned_user_id && (
            <Button size="sm" variant="primary" icon={<KeyRound className="h-3.5 w-3.5" />}
              disabled={provision.isPending} onClick={() => provision.mutate()}>
              {provision.isPending ? "Provisioning…" : "Provision & email credentials"}
            </Button>
          )}
          {d.provisioned_user_id && (
            <Pill tone="success">Account provisioned</Pill>
          )}
        </div>
      </div>

      {locked && (
        <div className="rounded-xl border hairline bg-surface-2 p-3 text-xs text-text-muted">
          This offer has been {d.status} — the documents are locked. Use “Provision &amp; email
          credentials” to create the candidate’s login.
        </div>
      )}

      {/* Split screen */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left — editor */}
        <div className="space-y-3">
          <Card className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Candidate name">
                <input className={input} value={d.candidate_name || ""} disabled={readOnly}
                  onChange={(e) => setD({ ...d, candidate_name: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="Candidate email">
                <input className={input} type="email" value={d.candidate_email || ""} disabled={readOnly}
                  onChange={(e) => setD({ ...d, candidate_email: e.target.value })} autoComplete="off" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Salary — probation">
                <input className={input} value={(d.offer_meta.salary_probation as string) || ""}
                  disabled={readOnly} onChange={(e) => setMeta({ salary_probation: e.target.value })} />
              </Field>
              <Field label="Salary — post-probation">
                <input className={input} value={(d.offer_meta.salary_post_probation as string) || ""}
                  disabled={readOnly} onChange={(e) => setMeta({ salary_post_probation: e.target.value })} />
              </Field>
              <Field label="Reports to">
                <input className={input} value={(d.offer_meta.reporting_to as string) || ""}
                  disabled={readOnly} onChange={(e) => setMeta({ reporting_to: e.target.value })} />
              </Field>
              <Field label="Start date">
                <input className={input} value={(d.offer_meta.start_date as string) || ""}
                  disabled={readOnly} onChange={(e) => setMeta({ start_date: e.target.value })} />
              </Field>
            </div>

            <Field label="Roles granted on provisioning">
              <div className="max-h-28 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                {(roles || []).map((r) => {
                  const on = d.role_ids.includes(r.role_id);
                  return (
                    <label key={r.role_id} className="flex items-center gap-2 text-xs text-text-primary">
                      <input type="checkbox" checked={on} disabled={readOnly}
                        onChange={() =>
                          setD({
                            ...d,
                            role_ids: on
                              ? d.role_ids.filter((x) => x !== r.role_id)
                              : [...d.role_ids, r.role_id],
                          })
                        } />
                      {r.role_name}
                    </label>
                  );
                })}
                {!roles?.length && <span className="text-xs text-text-faint">No roles found.</span>}
              </div>
            </Field>
            {!readOnly && (
              <Field label="Signing link expires in (days)">
                <input className={input} type="number" min={1} max={60} value={expiresDays}
                  onChange={(e) => setExpiresDays(Number(e.target.value))} />
              </Field>
            )}
          </Card>

          <Editor label="Job Description (markdown)" value={d.jd_markdown} disabled={readOnly}
            onChange={(v) => setD({ ...d, jd_markdown: v })} />
          <Editor label="Offer Letter (markdown)" value={d.offer_markdown} disabled={readOnly}
            onChange={(v) => setD({ ...d, offer_markdown: v })} />
        </div>

        {/* Right — live preview. Iframe of the server-rendered packet HTML,
            so the preview, the candidate offer page, and the downloaded PDF
            are literally the same document — zero drift. */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-text-muted">
            <Building2 className="h-3.5 w-3.5" /> Live preview — what the candidate sees &amp; the PDF looks like
          </div>
          <LivePacketPreview
            offerId={offerId}
            jdMarkdown={d.jd_markdown}
            offerMarkdown={d.offer_markdown}
            title={d.title}
            candidateName={d.candidate_name}
          />
        </div>
      </div>

      {/* Executed signature — shown once the candidate has signed. */}
      {locked && d.signature?.data_url && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-xs text-text-muted">
            <PenLine className="h-3.5 w-3.5 text-accent-glow" /> Candidate signature — executed copy
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-stretch">
            <div className="rounded-xl border hairline bg-white p-4">
              <img
                src={d.signature.data_url}
                alt="Candidate signature"
                className="max-h-[120px] w-auto max-w-full"
              />
              <div className="mt-2 border-t border-neutral-200 pt-2 text-[12px] text-neutral-700">
                {d.signature.signer_name || d.candidate_name || "Candidate"}
                {d.signature.signed_at
                  ? ` · signed ${new Date(d.signature.signed_at).toLocaleDateString()}`
                  : ""}
              </div>
            </div>
            {d.signature.verification_code && (
              <div className="grid content-center rounded-xl border hairline bg-surface-2 p-3">
                <div className="micro mb-1 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-success" /> Verification
                </div>
                <span className="font-mono text-[12px] tracking-wide text-accent-glow">
                  {d.signature.verification_code}
                </span>
              </div>
            )}
          </div>
          <p className="mt-3 text-[11.5px] text-text-muted">
            This signature is embedded in the downloaded PDF (Download PDF → Full offer packet /
            Offer letter).
          </p>
        </Card>
      )}
    </div>
  );
}

// ── Live packet preview (iframe of server-rendered HTML) ───
/**
 * Renders the server-authoritative packet HTML in a sandboxed iframe. Sends
 * the studio's in-flight markdown to `/recruitment/offers/:id/preview` with a
 * short debounce so edits feel live but we don't hammer the endpoint. On
 * transient error we keep the last-good HTML on screen and quietly retry on
 * the next edit — the preview should never flash blank.
 */
function LivePacketPreview({
  offerId,
  jdMarkdown,
  offerMarkdown,
  title,
  candidateName,
}: {
  offerId: string;
  jdMarkdown: string;
  offerMarkdown: string;
  title: string;
  candidateName: string | null;
}) {
  const [html, setHtml] = useState<string>("");
  const [pending, setPending] = useState(true);
  useEffect(() => {
    setPending(true);
    const handle = window.setTimeout(async () => {
      try {
        const { packet_html } = await recruitmentApi.previewPacket(offerId, {
          jd_markdown: jdMarkdown,
          offer_markdown: offerMarkdown,
          title,
          candidate_name: candidateName || undefined,
        });
        setHtml(packet_html);
      } catch {
        // Keep the last-good render on screen. Next successful edit refreshes.
      } finally {
        setPending(false);
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [offerId, jdMarkdown, offerMarkdown, title, candidateName]);

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-xl border hairline bg-white">
        <iframe
          title="Offer packet preview"
          srcDoc={html || "<p style='padding:20px;font-family:sans-serif;color:#888'>Preparing preview…</p>"}
          sandbox=""
          className="block w-full h-[78vh] bg-white"
        />
      </div>
      {pending && html && (
        <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 text-[10.5px] text-white">
          <Loader2 className="h-3 w-3 animate-spin" /> Updating
        </div>
      )}
    </div>
  );
}

// ── Download menu (branded PDF export) ─────────────────────
function DownloadMenu({ offerId, title }: { offerId: string; title: string }) {
  const notify = useNotify("Recruitment: download");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<OfferPdfDoc | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const slug = title.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "offer";
  const run = async (doc: OfferPdfDoc, name: string) => {
    setBusy(doc);
    try {
      await recruitmentApi.downloadPdf(offerId, doc, `${name}_${slug}.pdf`);
      setOpen(false);
    } catch (e) {
      notify("Couldn't download", errMsg(e), "high");
    } finally {
      setBusy(null);
    }
  };

  const items: { doc: OfferPdfDoc; label: string; name: string }[] = [
    { doc: "packet", label: "Full offer packet", name: "Offer-Packet" },
    { doc: "jd", label: "Job description", name: "Job-Description" },
    { doc: "offer", label: "Offer letter", name: "Offer-Letter" },
  ];

  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        icon={<Download className="h-3.5 w-3.5" />}
        onClick={() => setOpen((o) => !o)}
      >
        Download PDF
      </Button>
      {open && (
        <div className="glass absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border hairline p-1 shadow-xl">
          {items.map((it) => (
            <button
              key={it.doc}
              type="button"
              disabled={!!busy}
              onClick={() => run(it.doc, it.name)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-primary transition-colors hover:bg-text-primary/[0.06] disabled:opacity-60"
            >
              <span>{it.label}</span>
              {busy === it.doc ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5 text-text-faint" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Editor({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Card className="p-3">
      <div className="mb-1.5 text-xs font-medium text-text-muted">{label}</div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        className="w-full resize-y rounded-lg border border-line bg-text-primary/[0.03] p-3 font-mono text-[12.5px] leading-relaxed text-text-primary disabled:opacity-70"
      />
    </Card>
  );
}

// ── Company context editor ─────────────────────────────────
function ContextModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify("Recruitment: context");
  const { data } = useQuery({
    queryKey: ["recruitment", "context"],
    queryFn: () => recruitmentApi.getContext(),
    enabled: open,
  });
  const [biz, setBiz] = useState("*");
  const [row, setRow] = useState<Partial<ContextRow>>({});
  // Local flag: has the admin drawn a NEW signature in this session? If so the
  // pad's data URL replaces the stored one on save; if not we leave the stored
  // signature untouched (drawing nothing must never wipe an existing signature).
  const [sigDraft, setSigDraft] = useState<string | null>(null);

  useEffect(() => {
    const found = data?.find((r) => r.business === biz);
    setRow(found ? { ...found } : { business: biz });
    setSigDraft(null);
  }, [data, biz]);

  const save = useMutation({
    mutationFn: () =>
      recruitmentApi.updateContext(biz, {
        ...row,
        ...(sigDraft !== null ? { signatory_signature_data_url: sigDraft } : {}),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recruitment", "context"] }); notify("Context saved"); },
    onError: (e) => notify("Couldn't save", errMsg(e), "high"),
  });

  const options = [
    { key: "*", label: "Group (shared)" },
    ...BRANDS,
  ];

  const storedSig = row.signatory_signature_data_url || null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Company context (grounds the AI)"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-text-muted">
          What the AI reads before drafting, plus who countersigns offers on the
          Company's behalf. Keep it accurate — better context, better drafts.
        </p>
        <div className="flex gap-2">
          {options.map((o) => (
            <button key={o.key} type="button" onClick={() => setBiz(o.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                biz === o.key ? "border-accent/30 bg-accent/15 text-accent-glow" : "border-line text-text-muted"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
        {(
          [
            ["display_name", "Display name"],
            ["summary", "Summary (what the business is / does)"],
            ["tone", "Brand voice"],
            ["target_markets", "Target markets"],
            ["non_negotiables", "Non-negotiables for any hire"],
            ["signatory_name", "Signatory — full name"],
            ["signatory_title", "Signatory title"],
            ["notes", "Extra notes"],
          ] as [keyof ContextRow, string][]
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            {key === "summary" || key === "notes" || key === "non_negotiables" ? (
              <textarea className={input} rows={2} value={(row[key] as string) || ""}
                onChange={(e) => setRow({ ...row, [key]: e.target.value })} />
            ) : (
              <input className={input} value={(row[key] as string) || ""}
                onChange={(e) => setRow({ ...row, [key]: e.target.value })} autoComplete="off" />
            )}
          </Field>
        ))}

        {/* Countersignatory e-signature. Drawn once and reused on every offer
            packet — same treatment as the candidate's own signature. Leaving
            the pad blank preserves the stored signature; clicking Remove
            explicitly wipes it. */}
        <div className="rounded-xl border hairline bg-surface-2 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-text-muted">
            <FileSignature className="h-3.5 w-3.5 text-accent-glow" /> Signatory signature
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-text-faint">
            Draw the signature that will be stamped on the "For {row.display_name || biz}"
            side of every offer packet's Execution block.
            {biz === "*" ? " Per-brand rows can override this shared signature." : ""}
          </p>
          {storedSig && sigDraft === null && (
            <div className="mb-3 rounded-lg border hairline bg-white p-3">
              <img
                src={storedSig}
                alt="Current signatory signature"
                className="max-h-[110px] w-auto max-w-full"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => { setRow({ ...row, signatory_signature_data_url: null }); setSigDraft(""); }}
                  className="text-[12px] text-text-muted hover:text-danger"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
          <SignaturePad onChange={setSigDraft} />
          <p className="mt-2 text-[10.5px] text-text-faint">
            {sigDraft
              ? "New signature will replace the stored one on save."
              : storedSig
                ? "Leaving the pad blank keeps the stored signature."
                : "Draw once — used on every future offer packet."}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

export default RecruitmentTab;
