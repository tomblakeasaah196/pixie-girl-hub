import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ChevronLeft, UserPlus, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { useCreateContact } from "./hooks";
import { DIAL_CODES } from "./ContactFormModal";
import type { ContactCreateInput } from "./types";

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
];

const GENDER_OPTS = [
  { value: "", label: "— select —" },
  { value: "F", label: "Female" },
  { value: "M", label: "Male" },
  { value: "other", label: "Non-binary / Other" },
  { value: "prefer_not", label: "Prefer not to say" },
];

/**
 * Full employee onboarding (Q4) — employees are NEVER created via Quick Add.
 * This creates the directory contact (contact_type: ['staff']) AND the HR
 * employee profile (job title, employment type, start date, salary, statutory
 * & bank details) in one flow. Schedule / attendance / leave are then managed
 * in the HR module (the contact's Employment tab deep-links there).
 */
export function EmployeeOnboardingPage() {
  const navigate = useNavigate();
  const createContact = useCreateContact();

  useBreadcrumbs([
    { label: "Contacts", href: "/contacts" },
    { label: "Onboard employee" },
  ]);

  // Person
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("");
  const [dialCode, setDialCode] = useState<(typeof DIAL_CODES)[number]>(
    DIAL_CODES[0],
  );
  const [rawPhone, setRawPhone] = useState("");
  const [email, setEmail] = useState("");

  // Employment
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [department, setDepartment] = useState("");
  const [startDate, setStartDate] = useState("");
  const [baseSalary, setBaseSalary] = useState("");

  // Statutory & bank
  const [nin, setNin] = useState("");
  const [bvn, setBvn] = useState("");
  const [taxId, setTaxId] = useState("");
  const [pensionPin, setPensionPin] = useState("");
  const [nhfNumber, setNhfNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankSortCode, setBankSortCode] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const phone = rawPhone.replace(/\D/g, "")
    ? `${dialCode.dial}${rawPhone.replace(/\D/g, "")}`
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!displayName.trim()) return setError("Full name is required.");
    if (!employeeNumber.trim()) return setError("Employee number is required.");
    if (!jobTitle.trim()) return setError("Job title is required.");
    if (!startDate) return setError("Start date is required.");

    setBusy(true);
    try {
      // 1. Create the directory contact, typed as staff.
      const contactPayload: ContactCreateInput = {
        contact_type: ["staff"],
        display_name: displayName.trim(),
        priority_level: "regular",
        ...(firstName.trim() ? { first_name: firstName.trim() } : {}),
        ...(lastName.trim() ? { last_name: lastName.trim() } : {}),
        ...(gender ? { gender } : {}),
        ...(phone ? { primary_phone: phone } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      };
      const contact = await createContact.mutateAsync(contactPayload);

      // 2. Create the HR employee profile linked to that contact.
      await api.post("/hr/employees", {
        contact_id: contact.contact_id,
        employee_number: employeeNumber.trim(),
        job_title: jobTitle.trim(),
        employment_type: employmentType,
        start_date: startDate,
        ...(department.trim() ? { department: department.trim() } : {}),
        ...(baseSalary ? { base_salary: baseSalary } : {}),
        ...(nin.trim() ? { nin: nin.trim() } : {}),
        ...(bvn.trim() ? { bvn: bvn.trim() } : {}),
        ...(taxId.trim() ? { tax_id: taxId.trim() } : {}),
        ...(pensionPin.trim() ? { pension_pin: pensionPin.trim() } : {}),
        ...(nhfNumber.trim() ? { nhf_number: nhfNumber.trim() } : {}),
        ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
        ...(bankAccount.trim()
          ? { bank_account_number: bankAccount.trim() }
          : {}),
        ...(bankSortCode.trim() ? { bank_sort_code: bankSortCode.trim() } : {}),
      });

      navigate(`/contacts/${contact.contact_id}`);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not onboard employee. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in max-w-3xl mx-auto">
      <button
        onClick={() => navigate("/contacts?tab=staff")}
        className="flex items-center gap-1.5 text-[12.5px] text-text-muted hover:text-text-primary transition-colors mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Employees
      </button>

      <div className="mb-6">
        <p className="text-[11px] tracking-[0.16em] uppercase text-accent-glow mb-1.5">
          New employee · Full onboarding
        </p>
        <h1 className="font-display text-2xl sm:text-3xl text-text-primary">
          Onboard an employee
        </h1>
      </div>

      <div className="rounded-[16px] glass border hairline p-2 mb-5">
        <div className="flex items-start gap-2.5 p-3 text-[12.5px] text-text-muted">
          <Sparkles className="w-4 h-4 text-accent-glow mt-0.5 shrink-0" />
          <p>
            This creates the contact <strong>and</strong> the HR employee
            profile together. Work schedule (days &amp; hours), attendance and
            leave are managed in the{" "}
            <Link to="/hr" className="text-accent-glow hover:underline">
              HR module
            </Link>{" "}
            after onboarding.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-[16px] glass border hairline p-5 sm:p-6"
      >
        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-[10px] bg-danger/[0.1] border border-danger/30 text-[12px] text-danger">
            {error}
          </div>
        )}

        <FormSection title="Person">
          <Field label="Full name *">
            <TextInput
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Chidinma Eze"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gender">
              <Select
                value={gender}
                onChange={setGender}
                options={GENDER_OPTS}
              />
            </Field>
            <Field label="Email">
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </Field>
          </div>
          <Field label="Phone">
            <div className="flex gap-2">
              <Select
                className="w-[100px] shrink-0"
                value={dialCode.code}
                onChange={(v) =>
                  setDialCode(
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
        </FormSection>

        <FormSection title="Employment">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employee number *">
              <TextInput
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
                placeholder="e.g. PXG-0007"
                required
              />
            </Field>
            <Field label="Employment type *">
              <Select
                value={employmentType}
                onChange={setEmploymentType}
                options={EMPLOYMENT_TYPES}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Job title *">
              <TextInput
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Sales Associate"
                required
              />
            </Field>
            <Field label="Department">
              <TextInput
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Retail"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date *">
              <TextInput
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </Field>
            <Field label="Base salary (NGN / month)">
              <TextInput
                type="number"
                inputMode="decimal"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                placeholder="e.g. 250000"
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Statutory & bank (optional)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="NIN">
              <TextInput value={nin} onChange={(e) => setNin(e.target.value)} />
            </Field>
            <Field label="BVN">
              <TextInput value={bvn} onChange={(e) => setBvn(e.target.value)} />
            </Field>
            <Field label="Tax ID">
              <TextInput
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
              />
            </Field>
            <Field label="Pension PIN">
              <TextInput
                value={pensionPin}
                onChange={(e) => setPensionPin(e.target.value)}
              />
            </Field>
            <Field label="NHF number">
              <TextInput
                value={nhfNumber}
                onChange={(e) => setNhfNumber(e.target.value)}
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
                value={bankSortCode}
                onChange={(e) => setBankSortCode(e.target.value)}
              />
            </Field>
          </div>
        </FormSection>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="ghost"
            type="button"
            onClick={() => navigate("/contacts?tab=staff")}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            icon={<UserPlus className="w-4 h-4" />}
            disabled={busy}
          >
            {busy ? "Onboarding…" : "Onboard employee"}
          </Button>
        </div>
      </form>
    </div>
  );
}
