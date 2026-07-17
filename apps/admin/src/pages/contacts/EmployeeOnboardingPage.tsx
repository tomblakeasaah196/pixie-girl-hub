import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Search,
  X,
  Sparkles,
  AlertTriangle,
  Copy,
  UserPlus,
  FileSignature,
  Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import { toastReport } from "@/lib/error-report";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { useBusinesses } from "@/stores/business";
import { useBusinessStore } from "@/stores/business";
import { useCreateContact } from "./hooks";
import { listContacts, getContact } from "./api";
import { DIAL_CODES } from "./ContactFormModal";
import type { Contact, ContactCreateInput } from "./types";
import { orgApi, type OrgPosition } from "@/lib/org-api";
import { accessApi, type Role } from "@/lib/access-api";
import { recruitmentApi } from "@/lib/recruitment-api";

// ──────────────────────────────────────────────────────────────────────────
// Staff onboarding — full 4-step wizard (Person · Employment · Financial ·
// Access), on its own page. Either links an existing directory contact or
// creates one fresh, then creates the HR employee profile (including the work
// schedule set here, editable later in HR), and optionally provisions a Hub
// login via a staff invitation.
// ──────────────────────────────────────────────────────────────────────────

const STEPS = [
  { key: "person", label: "Person", description: "Who they are" },
  { key: "employment", label: "Employment", description: "Job, dept, dates" },
  { key: "financial", label: "Financial", description: "Salary, bank, IDs" },
  { key: "access", label: "Access", description: "Login & businesses" },
] as const;

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
];

const WEEK_DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

type DayMode = "on_site" | "remote" | "off";
type WorkSchedule = Record<string, DayMode>;

const DAY_MODES: { value: DayMode; label: string }[] = [
  { value: "on_site", label: "Office" },
  { value: "remote", label: "Remote" },
  { value: "off", label: "Off" },
];

const INPUT_CLS =
  "w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors";

interface StaffProfileResult {
  profile_id: string;
  contact_id: string;
  employee_number: string;
}

// ── Offer-prefill helpers ───────────────────────────────────────────────────
// offer_meta fields are free text in the Offer Studio, so parse tolerantly.

/** Accepts ISO (2026-07-14…) or dd/mm/yyyy → yyyy-mm-dd, else null. */
function parseOfferDate(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** "₦220,000/month" → "220000"; null when no usable number. */
function parseOfferMoney(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const digits = v.replace(/[^\d.]/g, "");
  let n = Number(digits);
  if (!Number.isFinite(n)) n = Number(digits.replace(/\./g, ""));
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

/** yyyy-mm-dd plus N months (probation end from the offer terms). */
function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** "Human Resources" → "human_resources" (org unit/position keys). */
function slugKey(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "unit"
  );
}

export function EmployeeOnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const businesses = useBusinesses();
  const activeKey = useBusinessStore((s) => s.activeKey);
  const createContact = useCreateContact();

  useBreadcrumbs([
    { label: "Contacts", href: "/contacts" },
    { label: "Staff Onboarding" },
  ]);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{
    contactId: string;
    employeeNumber: string;
    credentials?: { email: string; temp_password: string } | null;
    /** Offer mode: credentials were emailed straight to the candidate. */
    emailedTo?: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Recruitment offer mode (?offer_id=) ─────────────────
  // "Onboard & provision" on a signed offer lands here: the wizard is
  // prefilled from the offer/contract, and the final step provisions the
  // login through the recruitment endpoint (credentials emailed to the
  // candidate, offer marked provisioned, HR profile linked).
  const offerId = params.get("offer_id");
  const offerMode = !!offerId;
  const { data: offer } = useQuery({
    queryKey: ["recruitment", "offer", offerId],
    queryFn: () => recruitmentApi.getOffer(offerId!),
    enabled: offerMode,
  });

  // ── Person ──────────────────────────────────────────────
  const [linked, setLinked] = useState<Contact | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dial, setDial] = useState<(typeof DIAL_CODES)[number]>(DIAL_CODES[0]);
  const [rawPhone, setRawPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");

  // Prefill from ?contact_id= (e.g. "Onboard as employee" on a profile).
  const prefillId = params.get("contact_id");
  useQuery({
    queryKey: ["contacts", "prefill", prefillId],
    queryFn: async () => {
      const c = await getContact(prefillId!);
      setLinked(c);
      if (c.email) setEmail(c.email);
      return c;
    },
    enabled: !!prefillId && !linked,
  });

  // ── Employment ──────────────────────────────────────────
  const [business, setBusiness] = useState(activeKey);
  // Job title + department come from the organigramme (no free text). Picking a
  // position sets both, and assigns the new hire to that seat after creation.
  const [positionId, setPositionId] = useState("");
  const [newPositionOpen, setNewPositionOpen] = useState(false);
  const [employmentType, setEmploymentType] = useState("full_time");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [reportsTo, setReportsTo] = useState("");
  const [schedule, setSchedule] = useState<WorkSchedule>({
    mon: "on_site",
    tue: "on_site",
    wed: "on_site",
    thu: "on_site",
    fri: "on_site",
    sat: "off",
    sun: "off",
  });
  const [expectedStart, setExpectedStart] = useState("09:00");
  const [expectedEnd, setExpectedEnd] = useState("18:00");
  const [grace, setGrace] = useState("15");

  // ── Financial ───────────────────────────────────────────
  const [baseSalary, setBaseSalary] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankSort, setBankSort] = useState("");
  const [nin, setNin] = useState("");
  const [bvn, setBvn] = useState("");
  const [pensionPin, setPensionPin] = useState("");
  const [nhf, setNhf] = useState("");
  const [taxId, setTaxId] = useState("");

  // ── Access ──────────────────────────────────────────────
  const [createLogin, setCreateLogin] = useState(true);
  const [permitted, setPermitted] = useState<string[]>([activeKey]);
  const [roleId, setRoleId] = useState("");

  // Prefill from the signed offer — once, when it loads. Everything stays
  // editable; the wizard only fills what the contract already knows.
  const offerPrefilled = useRef(false);
  useEffect(() => {
    if (!offer || offerPrefilled.current) return;
    offerPrefilled.current = true;
    const parts = (offer.candidate_name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length) {
      setFirstName(parts[0]);
      setLastName(parts.slice(1).join(" "));
    }
    if (offer.candidate_email) setEmail(offer.candidate_email);
    if (offer.business) setBusiness(offer.business);
    if (offer.target_businesses?.length) setPermitted(offer.target_businesses);
    const start = parseOfferDate(offer.offer_meta?.start_date);
    if (start) setStartDate(start);
    const et = offer.offer_meta?.employment_type;
    if (typeof et === "string" && EMPLOYMENT_TYPES.some((t) => t.value === et))
      setEmploymentType(et);
    // The hire starts on the probation salary; fall back to post-probation.
    const salary =
      parseOfferMoney(offer.offer_meta?.salary_probation) ??
      parseOfferMoney(offer.offer_meta?.salary_post_probation);
    if (salary) setBaseSalary(salary);
    if (offer.role_ids?.length) setRoleId((r) => r || offer.role_ids[0]);
  }, [offer]);

  // Organigramme sources: positions drive title/department/role; roles gate
  // the login (required — no permission-less accounts).
  const { data: positions = [] } = useQuery({
    queryKey: ["org-positions"],
    queryFn: () => orgApi.listPositions(),
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["access-roles"],
    queryFn: () => accessApi.listRoles(),
  });
  const selectedPosition = positions.find((p) => p.position_id === positionId);
  // Default the login role to the position's role once a position is chosen.
  if (createLogin && !roleId && selectedPosition?.role_id) {
    setRoleId(selectedPosition.role_id);
  }

  // Reports-to options (same business).
  const { data: staffResp } = useQuery({
    queryKey: ["hr", "employees", "for-reports", business],
    queryFn: () => api.get<{ data: any[] }>(`/hr/employees?page_size=200`),
  });
  const reportsOptions = [
    { value: "", label: "— None —" },
    ...((staffResp?.data ?? [])
      .filter((s: any) => !business || s.business === business)
      .map((s: any) => ({
        value: s.profile_id,
        label: `${s.display_name ?? s.employee_number} · ${s.job_title}`,
      })) ?? []),
  ];

  const phone = rawPhone.replace(/\D/g, "")
    ? `${dial.dial}${rawPhone.replace(/\D/g, "")}`
    : "";

  const validateStep = (): string | null => {
    if (step === 0) {
      if (!linked && !firstName.trim() && !lastName.trim())
        return "Enter a name or link an existing contact.";
    }
    if (step === 1) {
      if (!business) return "Pick a primary business.";
      if (!positionId) return "Pick a position (it sets the job title & department).";
      if (!startDate) return "Start date is required.";
    }
    if (step === 3 && createLogin) {
      // In offer mode the offer's stored role grants are an acceptable source.
      if (!roleId && !(offerMode && offer?.role_ids?.length))
        return "Pick a role for the login (no permission-less accounts).";
    }
    return null;
  };

  const next = () => {
    const v = validateStep();
    if (v) {
      setError(v);
      return;
    }
    setError("");
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit();
  };

  // Keep what a failed submit already created, so retrying never duplicates
  // the contact or the HR profile (it resumes from where it stopped).
  const createdContactRef = useRef<string | null>(null);
  const createdProfileRef = useRef<StaffProfileResult | null>(null);

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      // 1. Resolve the contact — link existing or create fresh, typed staff.
      let contactId = linked?.contact_id || createdContactRef.current;
      const displayName =
        linked?.display_name ||
        [firstName, lastName].filter(Boolean).join(" ").trim();
      if (!contactId) {
        const payload: ContactCreateInput = {
          contact_type: ["staff"],
          display_name: displayName,
          priority_level: "regular",
          ...(firstName.trim() ? { first_name: firstName.trim() } : {}),
          ...(lastName.trim() ? { last_name: lastName.trim() } : {}),
          ...(phone ? { primary_phone: phone } : {}),
          ...(whatsapp ? { whatsapp_number: whatsapp } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        };
        const c = await createContact.mutateAsync(payload);
        contactId = c.contact_id;
        createdContactRef.current = contactId;
      }

      // 2. Create the HR employee profile (incl. work schedule). Title +
      //    department are taken from the chosen organigramme position. In
      //    offer mode the contract's probation terms seed probation tracking.
      const probationMonths = offerMode
        ? Number(offer?.offer_meta?.probation_months) || 0
        : 0;
      let profile = createdProfileRef.current;
      if (!profile) {
        profile = await api.post<StaffProfileResult>("/hr/employees", {
          contact_id: contactId,
          job_title: selectedPosition?.display_name ?? "Unassigned",
          employment_type: employmentType,
          start_date: startDate,
          ...(probationMonths > 0
            ? {
                probation_status: "active",
                probation_start_date: startDate,
                probation_end_date: addMonthsIso(startDate, probationMonths),
              }
            : {}),
          ...(selectedPosition?.unit_name
            ? { department: selectedPosition.unit_name }
            : {}),
          ...(reportsTo ? { reports_to: reportsTo } : {}),
          ...(baseSalary ? { base_salary: Number(baseSalary) } : {}),
          ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
          ...(bankAccount.trim()
            ? { bank_account_number: bankAccount.trim() }
            : {}),
          ...(bankSort.trim() ? { bank_sort_code: bankSort.trim() } : {}),
          ...(nin.trim() ? { nin: nin.trim() } : {}),
          ...(bvn.trim() ? { bvn: bvn.trim() } : {}),
          ...(pensionPin.trim() ? { pension_pin: pensionPin.trim() } : {}),
          ...(nhf.trim() ? { nhf_number: nhf.trim() } : {}),
          ...(taxId.trim() ? { tax_id: taxId.trim() } : {}),
          work_schedule: schedule,
          ...(expectedStart ? { work_expected_start_time: expectedStart } : {}),
          ...(expectedEnd ? { work_expected_end_time: expectedEnd } : {}),
          work_grace_minutes: Number(grace) || 0,
        });
        createdProfileRef.current = profile;
      }

      // 2b. Slot the new hire into their organigramme seat — this grants the
      //     position's role and confirms their title + department.
      if (positionId) {
        try {
          await orgApi.updatePosition(positionId, {
            profile_id: profile.profile_id,
          });
        } catch (e) {
          toastReport("Contacts → Employee onboarding", "Assign position", e);
        }
      }

      // 3. Provision the Hub login.
      //    • Offer mode: through the recruitment endpoint — it links the login
      //      to the HR profile just created, emails the credentials straight
      //      to the candidate, files the contract, and marks the offer
      //      provisioned.
      //    • Otherwise: instant provisioning — returns a one-time temporary
      //      password to hand to the new hire. A role is required.
      let credentials: { email: string; temp_password: string } | null = null;
      let emailedTo: string | null = null;
      const loginEmail = email.trim() || linked?.email || "";
      if (offerMode && offerId && createLogin) {
        const roleIds = Array.from(
          new Set([...(roleId ? [roleId] : []), ...(offer?.role_ids ?? [])]),
        );
        const r = await recruitmentApi.provision(offerId, {
          staff_profile_id: profile.profile_id,
          ...(roleIds.length ? { role_ids: roleIds } : {}),
        });
        emailedTo = r.email;
        qc.invalidateQueries({ queryKey: ["recruitment"] });
      } else if (createLogin && loginEmail) {
        try {
          credentials = await api.post<{
            email: string;
            temp_password: string;
          }>("/staff-invitations/provision", {
            email: loginEmail,
            display_name: displayName,
            business_keys: permitted.length ? permitted : [business],
            staff_profile_id: profile.profile_id,
            ...(roleId ? { role_ids: [roleId] } : {}),
          });
        } catch {
          /* provisioning is best-effort; HR can create the login later */
        }
      }

      setDone({
        contactId: contactId!,
        employeeNumber: profile.employee_number,
        credentials,
        emailedTo,
      });
    } catch (e) {
      toastReport("Contacts → Employee onboarding", "Onboard employee", e);
      setError(
        e instanceof Error ? e.message : "Could not onboard. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <p className="text-[11px] tracking-[0.16em] uppercase text-accent-glow mb-1.5">
            Step {step + 1} of {STEPS.length}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl text-text-primary">
            New team member
          </h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft className="w-4 h-4" />}
          onClick={() => navigate("/contacts?tab=staff")}
        >
          Cancel
        </Button>
      </div>

      {offerMode && offer && (
        <div className="mb-5 flex items-start gap-2.5 rounded-[12px] border border-accent-deep/40 bg-accent-deep/[0.08] p-3.5 text-[12.5px] text-text-primary">
          <FileSignature className="w-4 h-4 mt-0.5 shrink-0 text-accent-glow" />
          <span>
            Onboarding from the signed offer <strong>{offer.title}</strong>
            {offer.candidate_name ? ` — ${offer.candidate_name}` : ""}. The form
            is prefilled from the contract; login credentials will be emailed to{" "}
            <strong>{offer.candidate_email}</strong> at the final step.
          </span>
        </div>
      )}

      <div className="grid lg:grid-cols-[260px_1fr] gap-5 items-start">
        {/* Step rail */}
        <div className="rounded-[16px] glass border hairline p-3 space-y-1">
          {STEPS.map((s, i) => {
            const state =
              i < step ? "done" : i === step ? "current" : "upcoming";
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => i <= step && setStep(i)}
                disabled={i > step}
                className={[
                  "w-full flex items-start gap-3 p-2.5 rounded-[11px] text-left transition-colors",
                  state === "current"
                    ? "bg-accent-deep/[0.14] border border-accent-deep/40"
                    : "border border-transparent hover:bg-text-primary/[0.04] disabled:opacity-50 disabled:hover:bg-transparent",
                ].join(" ")}
              >
                <span
                  className={[
                    "grid place-items-center w-6 h-6 rounded-full text-[11px] font-semibold flex-shrink-0",
                    state === "done"
                      ? "bg-success/20 text-success"
                      : state === "current"
                        ? "bg-accent-deep text-[#F4E9D9]"
                        : "bg-text-primary/[0.08] text-text-faint",
                  ].join(" ")}
                >
                  {state === "done" ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-text-primary">
                    {s.label}
                  </span>
                  <span className="block text-[11px] text-text-faint">
                    {s.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Step content */}
        <div className="rounded-[16px] glass border hairline p-5 sm:p-7">
          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-[10px] bg-danger/[0.1] border border-danger/30 text-[12px] text-danger">
              {error}
            </div>
          )}

          {step === 0 && (
            <PersonStep
              linked={linked}
              onLink={(c) => {
                setLinked(c);
                if (c?.email) setEmail(c.email);
              }}
              firstName={firstName}
              setFirstName={setFirstName}
              lastName={lastName}
              setLastName={setLastName}
              dial={dial}
              setDial={setDial}
              rawPhone={rawPhone}
              setRawPhone={setRawPhone}
              whatsapp={whatsapp}
              setWhatsapp={setWhatsapp}
              email={email}
              setEmail={setEmail}
            />
          )}

          {step === 1 && (
            <div className="space-y-6">
              <StepHeader
                title="Employment"
                subtitle="Job role, department, reporting line and work schedule."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Primary business *">
                  <Select
                    value={business}
                    onChange={setBusiness}
                    options={businesses.map((b) => ({
                      value: b.key,
                      label: b.name,
                    }))}
                  />
                </Field>
                <Field label="Position *">
                  <Select
                    value={positionId}
                    onChange={setPositionId}
                    options={[
                      { value: "", label: "— Select a position —" },
                      ...positions.map((p) => ({
                        value: p.position_id,
                        label: `${p.display_name}${p.unit_name ? ` · ${p.unit_name}` : ""}`,
                      })),
                    ]}
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="text-text-faint">
                      {selectedPosition
                        ? `Dept ${selectedPosition.unit_name ?? "—"}${selectedPosition.role_name ? ` · grants ${selectedPosition.role_name}` : ""}`
                        : "Sets job title, department & role"}
                    </span>
                    <button type="button"
                      onClick={() => setNewPositionOpen((o) => !o)}
                      className="text-accent-glow hover:underline">
                      {newPositionOpen ? "Close" : "+ New department / position"}
                    </button>
                  </div>
                </Field>
                {newPositionOpen && (
                  <div className="sm:col-span-2">
                    <InlinePositionCreator
                      roles={roles}
                      positions={positions}
                      onCreated={(p) => {
                        qc.invalidateQueries({ queryKey: ["org-positions"] });
                        setPositionId(p.position_id);
                        setNewPositionOpen(false);
                      }}
                    />
                  </div>
                )}
                <Field label="Employment type">
                  <Select
                    value={employmentType}
                    onChange={setEmploymentType}
                    options={EMPLOYMENT_TYPES}
                  />
                </Field>
                <Field label="Start date *">
                  <TextInput
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Reports to (optional)">
                    <Select
                      value={reportsTo}
                      onChange={setReportsTo}
                      options={reportsOptions}
                    />
                  </Field>
                </div>
              </div>

              <WorkScheduleEditor
                schedule={schedule}
                setSchedule={setSchedule}
                expectedStart={expectedStart}
                setExpectedStart={setExpectedStart}
                expectedEnd={expectedEnd}
                setExpectedEnd={setExpectedEnd}
                grace={grace}
                setGrace={setGrace}
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <StepHeader
                title="Financial & ID"
                subtitle="Sensitive fields are encrypted at rest — only HR and the employee can read them."
              />
              <div className="rounded-[11px] border border-warn/30 bg-warn/[0.07] p-3 flex items-start gap-2 text-[12px] text-text-muted">
                <Sparkles className="w-3.5 h-3.5 text-warn mt-0.5 shrink-0" />
                <p>Base salary seeds the employee&rsquo;s pay record.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Base salary (NGN / month, gross)">
                  <TextInput
                    type="number"
                    inputMode="decimal"
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Bank name">
                  <TextInput
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                  />
                </Field>
                <Field label="Bank account number">
                  <TextInput
                    value={bankAccount}
                    onChange={(e) => setBankAccount(e.target.value)}
                  />
                </Field>
                <Field label="Sort code">
                  <TextInput
                    value={bankSort}
                    onChange={(e) => setBankSort(e.target.value)}
                  />
                </Field>
                <Field label="NIN (National ID)">
                  <TextInput value={nin} onChange={(e) => setNin(e.target.value)} />
                </Field>
                <Field label="BVN">
                  <TextInput value={bvn} onChange={(e) => setBvn(e.target.value)} />
                </Field>
                <Field label="Pension PIN">
                  <TextInput
                    value={pensionPin}
                    onChange={(e) => setPensionPin(e.target.value)}
                  />
                </Field>
                <Field label="NHF number">
                  <TextInput value={nhf} onChange={(e) => setNhf(e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Tax ID">
                    <TextInput
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <StepHeader
                title="Access"
                subtitle={
                  offerMode
                    ? "Provision the Hub login and email the credentials straight to the candidate."
                    : "Optionally provision a Hub login now. A temporary password is generated and shown once."
                }
              />
              <label className="flex items-start gap-3 p-4 rounded-[12px] bg-text-primary/[0.04] border hairline cursor-pointer">
                <input
                  type="checkbox"
                  checked={createLogin}
                  onChange={(e) => setCreateLogin(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-[13px] font-semibold text-text-primary">
                    Provision a Hub login for this person
                  </span>
                  <span className="block text-[12px] text-text-faint">
                    {offerMode
                      ? `A one-time password is generated and emailed to ${offer?.candidate_email ?? "the candidate"}; they set a new one at first sign-in.`
                      : "Sends an invitation to their email. Skip if they don't need to sign in."}
                  </span>
                </span>
              </label>

              {createLogin && (
                <>
                  {!offerMode && !(email.trim() || linked?.email) && (
                    <div className="px-3 py-2.5 rounded-[10px] bg-warn/[0.1] border border-warn/30 text-[12px] text-warn">
                      No email captured in step 1 — add one so a login can be
                      provisioned.
                    </div>
                  )}
                  <Field label="Role *">
                    <Select
                      value={roleId}
                      onChange={setRoleId}
                      options={[
                        { value: "", label: "— Select a role —" },
                        ...roles.map((r) => ({
                          value: r.role_id,
                          label: r.role_name,
                        })),
                      ]}
                    />
                    <span className="mt-1 block text-[11px] text-text-faint">
                      Every login needs a role — it decides what they can see and
                      do. Defaults to the position&rsquo;s role.
                    </span>
                  </Field>
                  <div>
                    <div className="micro mb-2">Permitted businesses</div>
                    <div className="flex flex-wrap gap-2">
                      {businesses.map((b) => {
                        const on = permitted.includes(b.key);
                        return (
                          <button
                            key={b.key}
                            type="button"
                            onClick={() =>
                              setPermitted((prev) =>
                                on
                                  ? prev.filter((k) => k !== b.key)
                                  : [...prev, b.key],
                              )
                            }
                            className={[
                              "px-3 h-[34px] rounded-[9px] text-[12px] font-semibold border transition-all",
                              on
                                ? "bg-accent-deep/[0.15] border-accent-deep/50 text-accent-glow"
                                : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary",
                            ].join(" ")}
                          >
                            {b.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 pt-6 mt-6 border-t hairline">
            <Button
              variant="ghost"
              size="sm"
              icon={<ChevronLeft className="w-4 h-4" />}
              disabled={step === 0 || busy}
              onClick={() => setStep(step - 1)}
            >
              Back
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => navigate("/contacts?tab=staff")}
              >
                Save &amp; exit
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                icon={
                  step === STEPS.length - 1 ? (
                    <UserPlus className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )
                }
                onClick={next}
              >
                {busy
                  ? "Onboarding…"
                  : step === STEPS.length - 1
                    ? "Onboard"
                    : "Continue"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Success */}
      <Modal
        open={!!done}
        onClose={() => done && navigate(`/contacts/${done.contactId}`)}
        title={
          <span className="flex items-center gap-2">
            <span className="grid place-items-center w-7 h-7 rounded-full bg-success/20 text-success">
              <Check className="w-4 h-4" />
            </span>
            Employee onboarded
          </span>
        }
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => done && navigate(`/contacts/${done.contactId}`)}
          >
            Open profile
          </Button>
        }
      >
        {done && (
          <div className="space-y-3">
            <p className="text-[13px] text-text-muted">
              Employee number{" "}
              <span className="font-mono text-text-primary">
                {done.employeeNumber}
              </span>{" "}
              created with their work schedule.
            </p>
            {done.emailedTo ? (
              <div className="px-3 py-2.5 rounded-[10px] bg-success/[0.08] border border-success/30 text-[12px] text-text-primary flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                <span>
                  Login provisioned — credentials emailed to{" "}
                  <strong>{done.emailedTo}</strong>. The offer is now marked
                  provisioned, and the new hire appears in the HR directory,
                  their organigramme seat, and Users &amp; Access.
                </span>
              </div>
            ) : done.credentials ? (
              <div className="space-y-3">
                <div className="px-3 py-2.5 rounded-[10px] bg-warn/[0.1] border border-warn/30 text-[12px] text-warn flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Temporary password — shown once. Share it securely; they
                    must set a new one at first sign-in.
                  </span>
                </div>
                <div>
                  <div className="micro mb-1">Email</div>
                  <code className="block px-3 py-2 rounded-[10px] bg-text-primary/[0.04] border hairline text-[13px] text-text-primary">
                    {done.credentials.email}
                  </code>
                </div>
                <div>
                  <div className="micro mb-1">Temporary password</div>
                  <div className="relative">
                    <code className="block px-3 py-2 pr-11 rounded-[10px] bg-text-primary/[0.04] border hairline text-[13px] font-mono tracking-wider text-text-primary">
                      {done.credentials.temp_password}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(
                          done.credentials!.temp_password,
                        );
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]"
                      aria-label="Copy password"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-success" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-3 py-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline text-[12px] text-text-muted flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-warn mt-0.5 shrink-0" />
                <span>
                  No login was provisioned. You can create one later from HR.
                </span>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header>
      <h2 className="font-display text-xl text-text-primary">{title}</h2>
      <p className="text-[12.5px] text-text-muted mt-1">{subtitle}</p>
    </header>
  );
}

// ── Step 1: Person ──────────────────────────────────────────────────────────

function PersonStep({
  linked,
  onLink,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  dial,
  setDial,
  rawPhone,
  setRawPhone,
  whatsapp,
  setWhatsapp,
  email,
  setEmail,
}: {
  linked: Contact | null;
  onLink: (c: Contact | null) => void;
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  dial: (typeof DIAL_CODES)[number];
  setDial: (v: (typeof DIAL_CODES)[number]) => void;
  rawPhone: string;
  setRawPhone: (v: string) => void;
  whatsapp: string;
  setWhatsapp: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <StepHeader
        title="Person"
        subtitle="Either link an existing contact, or fill in the basics to create one."
      />

      <div className="rounded-[12px] bg-text-primary/[0.03] border hairline p-4">
        <ContactPicker value={linked} onChange={onLink} />
        <p className="mt-2 text-[11px] text-text-faint">
          Pick someone already in the directory (a converted customer, for
          example) — or leave empty and fill the fields below to create them
          fresh.
        </p>
      </div>

      {linked ? (
        <div className="rounded-[12px] border border-accent-deep/40 bg-accent-deep/[0.06] p-4 text-[13px] text-text-primary">
          Onboarding <strong>{linked.display_name}</strong>
          {linked.primary_phone ? ` · ${linked.primary_phone}` : ""}
          {linked.email ? ` · ${linked.email}` : ""} — their existing contact
          details will be used.
        </div>
      ) : (
        <FormSection>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <TextInput
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </Field>
            <Field label="Last name">
              <TextInput
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </Field>
            <Field label="Primary phone">
              <div className="flex gap-2">
                <Select
                  className="w-[100px] shrink-0"
                  value={dial.code}
                  onChange={(v) =>
                    setDial(
                      DIAL_CODES.find((c) => c.code === v) ?? DIAL_CODES[0],
                    )
                  }
                  options={DIAL_CODES.map((d) => ({
                    value: d.code,
                    label: `${d.flag} ${d.dial}`,
                  }))}
                />
                <TextInput
                  className="flex-1"
                  type="tel"
                  inputMode="numeric"
                  placeholder="8020868273"
                  value={rawPhone}
                  onChange={(e) =>
                    setRawPhone(e.target.value.replace(/[^\d\s-]/g, ""))
                  }
                />
              </div>
            </Field>
            <Field label="WhatsApp">
              <TextInput
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="Same as phone if blank"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email">
                <TextInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </Field>
            </div>
          </div>
        </FormSection>
      )}
    </div>
  );
}

function ContactPicker({
  value,
  onChange,
}: {
  value: Contact | null;
  onChange: (c: Contact | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["contacts", "search", q],
    queryFn: () => listContacts({ q, page_size: 8 }),
    enabled: q.trim().length >= 2,
  });
  const results = data?.data ?? [];

  if (value) {
    return (
      <div>
        <div className="micro mb-1.5">Linked contact</div>
        <div className="flex items-center justify-between gap-2 h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-accent-deep/40">
          <span className="text-[13px] text-text-primary truncate">
            {value.display_name}
            {value.primary_phone ? ` · ${value.primary_phone}` : ""}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-text-faint hover:text-text-primary"
            aria-label="Unlink"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="micro mb-1.5">Link to existing contact (optional)</div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
        <input
          className={INPUT_CLS + " pl-9"}
          placeholder="Search by name, phone, or email…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </div>
      {open && q.trim().length >= 2 && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-[12px] glass border hairline shadow-glass max-h-64 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.contact_id}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
                setQ("");
              }}
              className="w-full text-left px-3 py-2.5 hover:bg-text-primary/[0.06] transition-colors"
            >
              <div className="text-[13px] text-text-primary">
                {c.display_name}
              </div>
              <div className="text-[11px] text-text-faint">
                {[c.primary_phone, c.email].filter(Boolean).join(" · ") || "—"}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inline department + position creator ───────────────────────────────────
// New hires sometimes open a brand-new seat. Create the department (org unit)
// and position right here — same wiring the Org & Workflow builder uses — then
// the wizard selects the fresh position so title/department/role flow from it.

function InlinePositionCreator({
  roles,
  positions,
  onCreated,
}: {
  roles: Role[];
  positions: OrgPosition[];
  onCreated: (p: OrgPosition) => void;
}) {
  const NEW_UNIT = "__new__";
  const { data: units = [] } = useQuery({
    queryKey: ["org-units"],
    queryFn: () => orgApi.listUnits(),
  });
  const [unitId, setUnitId] = useState("");
  const [newUnitName, setNewUnitName] = useState("");
  const [title, setTitle] = useState("");
  const [posRoleId, setPosRoleId] = useState("");
  const [reportsToPositionId, setReportsToPositionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const create = async () => {
    if (!title.trim()) {
      setErr("Give the position a title.");
      return;
    }
    if (!unitId || (unitId === NEW_UNIT && !newUnitName.trim())) {
      setErr("Pick a department, or name the new one.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      let targetUnitId = unitId;
      if (unitId === NEW_UNIT) {
        const unit = await orgApi.createUnit({
          unit_key: slugKey(newUnitName),
          display_name: newUnitName.trim(),
        });
        targetUnitId = unit.unit_id;
      }
      const position = await orgApi.createPosition({
        unit_id: targetUnitId,
        position_key: slugKey(title),
        display_name: title.trim(),
        ...(posRoleId ? { role_id: posRoleId } : {}),
        ...(reportsToPositionId
          ? { reports_to_position_id: reportsToPositionId }
          : {}),
      });
      onCreated(position);
    } catch (e) {
      toastReport("Contacts → Employee onboarding", "Create position", e);
      setErr(
        e instanceof Error ? e.message : "Could not create the position.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[12px] border border-accent-deep/40 bg-accent-deep/[0.06] p-4 space-y-3">
      <div className="text-[12.5px] font-semibold text-text-primary">
        New department / position
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department *">
          <Select
            value={unitId}
            onChange={setUnitId}
            options={[
              { value: "", label: "— Select a department —" },
              ...units.map((u) => ({
                value: u.unit_id,
                label: u.display_name,
              })),
              { value: NEW_UNIT, label: "＋ New department…" },
            ]}
          />
        </Field>
        {unitId === NEW_UNIT ? (
          <Field label="New department name *">
            <TextInput
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              placeholder="e.g. Marketing"
            />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Position title *">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Marketing & BD Officer"
          />
        </Field>
        <Field label="Role the seat grants (optional)">
          <Select
            value={posRoleId}
            onChange={setPosRoleId}
            options={[
              { value: "", label: "— Structure only —" },
              ...roles.map((r) => ({ value: r.role_id, label: r.role_name })),
            ]}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reports to position (optional)">
            <Select
              value={reportsToPositionId}
              onChange={setReportsToPositionId}
              options={[
                { value: "", label: "— None —" },
                ...positions.map((p) => ({
                  value: p.position_id,
                  label: `${p.display_name}${p.unit_name ? ` · ${p.unit_name}` : ""}`,
                })),
              ]}
            />
          </Field>
        </div>
      </div>
      {err && <div className="text-[12px] text-danger">{err}</div>}
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" />}
          disabled={busy}
          onClick={create}
        >
          {busy ? "Creating…" : "Create & select"}
        </Button>
      </div>
    </div>
  );
}

// ── Work schedule editor ────────────────────────────────────────────────────

function WorkScheduleEditor({
  schedule,
  setSchedule,
  expectedStart,
  setExpectedStart,
  expectedEnd,
  setExpectedEnd,
  grace,
  setGrace,
}: {
  schedule: WorkSchedule;
  setSchedule: (fn: (s: WorkSchedule) => WorkSchedule) => void;
  expectedStart: string;
  setExpectedStart: (v: string) => void;
  expectedEnd: string;
  setExpectedEnd: (v: string) => void;
  grace: string;
  setGrace: (v: string) => void;
}) {
  return (
    <div className="rounded-[12px] border hairline bg-text-primary/[0.03] p-4">
      <h4 className="text-[13px] font-semibold text-text-primary">
        Work schedule
      </h4>
      <p className="mb-3 text-[11.5px] text-text-faint">
        Set on-site / remote / off per day. Attendance only expects a clock-in
        on working days; office days are geofence-checked. Editable later in HR.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {WEEK_DAYS.map(({ key, label }) => (
          <div key={key} className="rounded-[10px] border hairline p-2">
            <div className="mb-1 text-center text-[11px] font-semibold text-text-primary">
              {label}
            </div>
            <div className="flex flex-col gap-1">
              {DAY_MODES.map((m) => {
                const selected = (schedule[key] || "off") === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() =>
                      setSchedule((s) => ({ ...s, [key]: m.value }))
                    }
                    className={[
                      "rounded-md px-1.5 py-1 text-[10.5px] transition-colors",
                      selected
                        ? "bg-accent-deep text-[#F4E9D9] font-semibold"
                        : "bg-text-primary/[0.05] text-text-muted hover:bg-text-primary/[0.1]",
                    ].join(" ")}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 sm:max-w-md">
        <Field label="Expected start">
          <TextInput
            type="time"
            value={expectedStart}
            onChange={(e) => setExpectedStart(e.target.value)}
          />
        </Field>
        <Field label="Closing time">
          <TextInput
            type="time"
            value={expectedEnd}
            onChange={(e) => setExpectedEnd(e.target.value)}
          />
        </Field>
        <Field label="Grace (min)">
          <TextInput
            type="number"
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
          />
        </Field>
      </div>
      <p className="mt-2 text-[11px] text-text-faint">
        Closing time powers early-departure tracking, supplementary-hours
        (overtime) capture, and the clock-out reminders.
      </p>
    </div>
  );
}
