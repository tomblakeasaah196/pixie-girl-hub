import { useState } from "react";
import { Plus, Send, Save, X, Loader2 } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/primitives";
import { FormSection, Field, TextInput } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { useCashRequestMutations } from "./hooks";
// Cash Requests share the expense category set (V2.2 6.32:
// "Same category set as expense_categories").
import { useExpenseCategories, useExpenseMutations } from "../expenses/hooks";

/** Turn a free-text category name into a stable key. */
function slugifyKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
import {
  URGENCY_OPTIONS,
  RECIPIENT_TYPE_OPTIONS,
  SETTLEMENT_REQUIRES_TYPES,
} from "./constants";
import type { RecipientType, Urgency } from "./types";

interface Props {
  onClose: () => void;
}

interface FormState {
  category_key: string;
  purpose: string;
  urgency: Urgency;
  needed_by_date: string;
  amount_requested_ngn: string;
  recipient_type: RecipientType;
  recipient_name: string;
  recipient_bank_name: string;
  recipient_account_number: string;
  recipient_account_name: string;
}

const INITIAL: FormState = {
  category_key: "",
  purpose: "",
  urgency: "normal",
  needed_by_date: "",
  amount_requested_ngn: "",
  recipient_type: "self_bank",
  recipient_name: "",
  recipient_bank_name: "",
  recipient_account_number: "",
  recipient_account_name: "",
};

export default function CreateCashRequestDrawer({ onClose }: Props) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const mutations = useCashRequestMutations();

  const categoriesQ = useExpenseCategories();
  const categories = (categoriesQ.data ?? []).filter((c) => c.is_active);
  const { createCategory } = useExpenseMutations();

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((p) => ({ ...p, [key]: val }));

  const categoryLabel =
    categories.find((c) => c.category_key === form.category_key)
      ?.category_display ?? form.category_key;

  function addCategory() {
    const name = newCategoryName.trim();
    const key = slugifyKey(name);
    if (!name || !key) return;
    createCategory.mutate(
      { category_key: key, display_name: name },
      {
        onSuccess: (cat) => {
          set("category_key", cat.category_key);
          setNewCategoryName("");
          setAddingCategory(false);
        },
      },
    );
  }
  const showBankFields = [
    "self_bank",
    "third_party_bank",
    "supplier_direct",
  ].includes(form.recipient_type);
  const requiresSettlement = SETTLEMENT_REQUIRES_TYPES.has(form.recipient_type);

  function validate(): boolean {
    const e: typeof errors = {};
    if (!form.category_key) e.category_key = "Required";
    if (!form.purpose.trim()) e.purpose = "Required";
    if (!form.amount_requested_ngn || Number(form.amount_requested_ngn) <= 0)
      e.amount_requested_ngn = "Enter a positive amount";
    if (showBankFields && form.recipient_type !== "self_bank") {
      if (!form.recipient_account_number.trim())
        e.recipient_account_number = "Required for bank transfers";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave(andSubmit: boolean) {
    if (!validate()) return;
    const input = {
      category_key: form.category_key,
      category_display: categoryLabel,
      purpose: form.purpose,
      urgency: form.urgency,
      needed_by_date: form.needed_by_date || undefined,
      amount_requested_ngn: Number(form.amount_requested_ngn),
      recipient_type: form.recipient_type,
      recipient_name: form.recipient_name || undefined,
      recipient_bank_name: form.recipient_bank_name || undefined,
      recipient_account_number: form.recipient_account_number || undefined,
      recipient_account_name: form.recipient_account_name || undefined,
      requires_settlement: requiresSettlement,
    };
    mutations.create.mutate(input, {
      onSuccess: (created) => {
        if (andSubmit) {
          mutations.submit.mutate(created.cash_request_id, {
            onSuccess: onClose,
          });
        } else {
          onClose();
        }
      },
    });
  }

  const isBusy = mutations.create.isPending || mutations.submit.isPending;

  return (
    <Drawer
      open
      onClose={onClose}
      title="New Cash Request"
      subtitle="Request funds for a purchase or expense"
      leading={<Plus className="w-5 h-5 text-accent" />}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => handleSave(false)}
            icon={<Save className="w-3.5 h-3.5" />}
          >
            Save Draft
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isBusy}
            onClick={() => handleSave(true)}
            icon={<Send className="w-3.5 h-3.5" />}
          >
            Submit for Approval
          </Button>
        </>
      }
    >
      <div className="space-y-1">
        <FormSection title="Category & Purpose">
          <Field
            label="Category"
            hint={addingCategory ? "new category" : "required"}
          >
            {addingCategory ? (
              <div className="flex items-center gap-2">
                <TextInput
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Studio Rent, Courier Fees"
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!newCategoryName.trim() || createCategory.isPending}
                  onClick={addCategory}
                  icon={
                    createCategory.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )
                  }
                >
                  Add
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAddingCategory(false);
                    setNewCategoryName("");
                  }}
                  icon={<X className="w-3.5 h-3.5" />}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Select
                  value={form.category_key}
                  onChange={(v) => set("category_key", v)}
                  options={[
                    {
                      value: "",
                      label: categories.length
                        ? "Choose a category..."
                        : "No categories",
                    },
                    ...categories.map((c) => ({
                      value: c.category_key,
                      label: c.category_display,
                    })),
                  ]}
                />
                <button
                  type="button"
                  onClick={() => setAddingCategory(true)}
                  className="flex items-center gap-1 text-[11px] text-accent-glow hover:text-accent transition-colors"
                >
                  <Plus className="w-3 h-3" /> New category
                </button>
              </div>
            )}
            {errors.category_key && <ErrText>{errors.category_key}</ErrText>}
            {createCategory.isError && (
              <ErrText>Couldn&rsquo;t create the category.</ErrText>
            )}
          </Field>
          <Field label="Purpose" hint="what is this money for?">
            <textarea
              value={form.purpose}
              onChange={(e) => set("purpose", e.target.value)}
              placeholder="Describe what the funds will be used for"
              className="w-full h-20 px-3 py-2 rounded-xl bg-text-primary/[0.04] border border-line text-text-primary text-sm resize-none outline-none focus:border-accent/50"
            />
            {errors.purpose && <ErrText>{errors.purpose}</ErrText>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Urgency">
              <Select
                value={form.urgency}
                onChange={(v) => set("urgency", v as Urgency)}
                options={URGENCY_OPTIONS}
              />
            </Field>
            <Field label="Needed By">
              <TextInput
                type="date"
                value={form.needed_by_date}
                onChange={(e) => set("needed_by_date", e.target.value)}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Amount">
          <Field label="Amount (₦)" hint="in Nigerian Naira">
            <TextInput
              type="number"
              step="0.01"
              min="1"
              value={form.amount_requested_ngn}
              onChange={(e) => set("amount_requested_ngn", e.target.value)}
              placeholder="0.00"
              className="font-mono"
            />
            {errors.amount_requested_ngn && (
              <ErrText>{errors.amount_requested_ngn}</ErrText>
            )}
          </Field>
          {Number(form.amount_requested_ngn) >= 100000 && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-warn/10 border border-warn/20 text-xs text-warn">
              <span className="font-bold">Note:</span> Amounts ≥ ₦100,000
              require CEO approval in addition to Finance review.
            </div>
          )}
        </FormSection>

        <FormSection title="Recipient">
          <Field label="Payment To">
            <Select
              value={form.recipient_type}
              onChange={(v) => set("recipient_type", v as RecipientType)}
              options={RECIPIENT_TYPE_OPTIONS}
            />
          </Field>
          {requiresSettlement && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-info/10 border border-info/20 text-xs text-info">
              This is a <strong>cash advance</strong> — you'll need to settle it
              with receipts after disbursement.
            </div>
          )}
          {showBankFields && (
            <>
              {form.recipient_type !== "self_bank" && (
                <Field label="Recipient Name">
                  <TextInput
                    value={form.recipient_name}
                    onChange={(e) => set("recipient_name", e.target.value)}
                    placeholder="Name of the recipient"
                  />
                </Field>
              )}
              <Field label="Bank Name">
                <TextInput
                  value={form.recipient_bank_name}
                  onChange={(e) => set("recipient_bank_name", e.target.value)}
                  placeholder="e.g. GTBank, Access Bank"
                />
              </Field>
              <Field
                label="Account Number"
                hint={
                  form.recipient_type === "self_bank"
                    ? "auto-filled from your profile"
                    : "required"
                }
              >
                <TextInput
                  value={form.recipient_account_number}
                  onChange={(e) =>
                    set("recipient_account_number", e.target.value)
                  }
                  placeholder="10-digit account number"
                />
                {errors.recipient_account_number && (
                  <ErrText>{errors.recipient_account_number}</ErrText>
                )}
              </Field>
              <Field label="Account Name">
                <TextInput
                  value={form.recipient_account_name}
                  onChange={(e) =>
                    set("recipient_account_name", e.target.value)
                  }
                  placeholder="Name on the bank account"
                />
              </Field>
            </>
          )}
        </FormSection>
      </div>
    </Drawer>
  );
}

function ErrText({ children }: { children: React.ReactNode }) {
  return <p className="text-danger text-[11px] mt-1">{children}</p>;
}
