import { useState } from "react";
import { Loader2, Receipt, Plus, X, Paperclip } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/primitives";
import { Select, NumberField } from "@/components/ui/controls";
import { useExpenseCategories, useExpenseMutations } from "./hooks";
import { uploadExpenseReceipt } from "./api";

/** Turn a free-text category name into a stable key the backend accepts. */
function slugifyKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Record a new expense — flows into the Expenses module (separate from
 * accounting). Matches the backend expenseCreate contract: a titled, dated
 * expense with at least one categorised line item.
 */

const EXPENSE_TYPES = [
  { value: "reimbursement", label: "Reimbursement" },
  { value: "company_card", label: "Company card" },
  { value: "direct_invoice", label: "Direct invoice" },
  { value: "advance_settlement", label: "Advance settlement" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function CreateExpenseDrawer({ onClose }: { onClose: () => void }) {
  const categoriesQ = useExpenseCategories();
  const { create, createCategory } = useExpenseMutations();
  const categories = (categoriesQ.data ?? []).filter((c) => c.is_active);

  const [title, setTitle] = useState("");
  const [expenseType, setExpenseType] = useState("reimbursement");
  const [date, setDate] = useState(today());
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");

  // Inline category creation.
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Optional receipt attachment.
  const [receipt, setReceipt] = useState<File | null>(null);

  const [uploading, setUploading] = useState(false);

  const amountNum = Number(amount);
  const busy = create.isPending || uploading;
  const canSave =
    !!title && !!date && !!categoryId && amountNum > 0 && !busy;

  function addCategory() {
    const name = newCategoryName.trim();
    const key = slugifyKey(name);
    if (!name || !key) return;
    createCategory.mutate(
      { category_key: key, display_name: name },
      {
        onSuccess: (cat) => {
          setCategoryId(cat.category_id);
          setNewCategoryName("");
          setAddingCategory(false);
        },
      },
    );
  }

  function submit() {
    create.mutate(
      {
        title,
        expense_date: date,
        expense_type: expenseType,
        description: description || undefined,
        lines: [
          {
            category_id: categoryId,
            description: description || title,
            amount_ngn: amountNum,
            vendor_name: vendor || undefined,
          },
        ],
      },
      {
        onSuccess: async (created) => {
          if (receipt) {
            try {
              setUploading(true);
              await uploadExpenseReceipt(created.expense_id, receipt);
            } catch {
              // Expense is already saved; a failed receipt upload shouldn't
              // block the flow. The user can re-attach from the detail view.
            } finally {
              setUploading(false);
            }
          }
          onClose();
        },
      },
    );
  }

  return (
    <Drawer open onClose={onClose} title="Record expense" subtitle="New expense entry">
      <div className="space-y-4 p-1">
        <Field label="Title">
          <Input value={title} onChange={setTitle} placeholder="Fuel for delivery run" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={expenseType} onChange={setExpenseType} options={EXPENSE_TYPES} />
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
            />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11.5px] text-text-muted">Category</span>
            {!addingCategory && (
              <button
                type="button"
                onClick={() => setAddingCategory(true)}
                className="flex items-center gap-1 text-[11px] text-accent-glow hover:text-accent transition-colors"
              >
                <Plus className="w-3 h-3" /> New category
              </button>
            )}
          </div>
          {addingCategory ? (
            <div className="flex items-center gap-2">
              <Input
                value={newCategoryName}
                onChange={setNewCategoryName}
                placeholder="e.g. Marketing, Logistics"
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
            <Select
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: "", label: categories.length ? "Choose a category…" : "No categories" },
                ...categories.map((c) => ({ value: c.category_id, label: c.category_display })),
              ]}
            />
          )}
          {createCategory.isError && (
            <p className="text-[11px] text-danger mt-1">
              Couldn&rsquo;t create the category.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₦)">
            <NumberField value={amount} onChange={setAmount} allowDecimal placeholder="0" />
          </Field>
          <Field label="Vendor (optional)">
            <Input value={vendor} onChange={setVendor} placeholder="Total Filling Station" />
          </Field>
        </div>

        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What was this for?"
            className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent/50 resize-y"
          />
        </Field>

        <div>
          <span className="block text-[11.5px] text-text-muted mb-1.5">
            Receipt (optional)
          </span>
          {receipt ? (
            <div className="flex items-center justify-between gap-2 rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px]">
              <span className="flex items-center gap-2 text-[13px] truncate">
                <Paperclip className="w-3.5 h-3.5 text-text-muted shrink-0" />
                <span className="truncate">{receipt.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="text-text-muted hover:text-danger transition-colors shrink-0"
                aria-label="Remove receipt"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer rounded-[11px] bg-text-primary/[0.04] border border-line border-dashed px-3 h-[42px] text-[13px] text-text-muted hover:border-accent/50 transition-colors">
              <Paperclip className="w-4 h-4" />
              <span>Attach a receipt</span>
              <input
                type="file"
                accept="image/*,.heic,.heif,application/pdf"
                className="hidden"
                onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
          <p className="text-[11px] text-text-faint mt-1.5">
            Attaching a receipt helps your expense get approved faster.
          </p>
        </div>

        {categories.length === 0 && !categoriesQ.isLoading && !addingCategory && (
          <p className="text-[12px] text-warn">
            No expense categories yet - use &ldquo;New category&rdquo; above to
            add your first one.
          </p>
        )}
        {create.isError && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t record the expense.</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={submit}
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
          >
            {uploading ? "Uploading receipt..." : "Record expense"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50"
    />
  );
}
