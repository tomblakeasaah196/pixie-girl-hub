import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { api } from "@/lib/api";
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

const DEPARTMENTS = [
  { value: "", label: "—" },
  { value: "management", label: "Management" },
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "finance", label: "Finance" },
  { value: "logistics", label: "Logistics" },
  { value: "marketing", label: "Marketing" },
  { value: "hr", label: "Human Resources" },
  { value: "it", label: "IT" },
  { value: "customer_service", label: "Customer Service" },
];

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

export function EmployeeOnboardingPage() {
  const navigate = useNavigate();
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
  } | null>(null);
  const [copied, setCopied] = useState(false);

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
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
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
      if (!employeeNumber.trim()) return "Employee number is required.";
      if (!jobTitle.trim()) return "Job title is required.";
      if (!startDate) return "Start date is required.";
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

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      // 1. Resolve the contact — link existing or create fresh, typed staff.
      let contactId = linked?.contact_id;
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
      }

      // 2. Create the HR employee profile (incl. work schedule).
      const profile = await api.post<StaffProfileResult>("/hr/employees", {
        contact_id: contactId,
        employee_number: employeeNumber.trim(),
        job_title: jobTitle.trim(),
        employment_type: employmentType,
        start_date: startDate,
        ...(department ? { department } : {}),
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
        work_grace_minutes: Number(grace) || 0,
      });

      // 3. Optionally provision a Hub login instantly — returns a one-time
      //    temporary password to hand to the new hire.
      let credentials: { email: string; temp_password: string } | null = null;
      const loginEmail = email.trim() || linked?.email || "";
      if (createLogin && loginEmail) {
        try {
          credentials = await api.post<{
            email: string;
            temp_password: string;
          }>("/staff-invitations/provision", {
            email: loginEmail,
            display_name: displayName,
            business_keys: permitted.length ? permitted : [business],
            staff_profile_id: profile.profile_id,
          });
        } catch {
          /* provisioning is best-effort; HR can create the login later */
        }
      }

      setDone({
        contactId: contactId!,
        employeeNumber: profile.employee_number,
        credentials,
      });
    } catch (e) {
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
                <Field label="Employee number *">
                  <TextInput
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    placeholder="e.g. PXG-0007"
                  />
                </Field>
                <Field label="Job title *">
                  <TextInput
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="e.g. Sales Associate"
                  />
                </Field>
                <Field label="Department">
                  <Select
                    value={department}
                    onChange={setDepartment}
                    options={DEPARTMENTS}
                  />
                </Field>
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
                subtitle="Optionally provision a Hub login now. A temporary password is generated and shown once."
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
                    Sends an invitation to their email. Skip if they don&rsquo;t
                    need to sign in.
                  </span>
                </span>
              </label>

              {createLogin && (
                <>
                  {!(email.trim() || linked?.email) && (
                    <div className="px-3 py-2.5 rounded-[10px] bg-warn/[0.1] border border-warn/30 text-[12px] text-warn">
                      No email captured in step 1 — add one so a login can be
                      provisioned.
                    </div>
                  )}
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
            {done.credentials ? (
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
          onFocus={() => setOpen(true)}
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

// ── Work schedule editor ────────────────────────────────────────────────────

function WorkScheduleEditor({
  schedule,
  setSchedule,
  expectedStart,
  setExpectedStart,
  grace,
  setGrace,
}: {
  schedule: WorkSchedule;
  setSchedule: (fn: (s: WorkSchedule) => WorkSchedule) => void;
  expectedStart: string;
  setExpectedStart: (v: string) => void;
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
      <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-xs">
        <Field label="Expected start">
          <TextInput
            type="time"
            value={expectedStart}
            onChange={(e) => setExpectedStart(e.target.value)}
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
    </div>
  );
}
