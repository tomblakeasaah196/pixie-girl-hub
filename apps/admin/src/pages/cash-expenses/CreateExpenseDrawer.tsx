import { useState } from "react";
import { Loader2, Receipt } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/primitives";
import { Select, NumberField } from "@/components/ui/controls";
import { useExpenseCategories, useExpenseMutations } from "./hooks";

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
  const { create } = useExpenseMutations();
  const categories = (categoriesQ.data ?? []).filter((c) => c.is_active);

  const [title, setTitle] = useState("");
  const [expenseType, setExpenseType] = useState("reimbursement");
  const [date, setDate] = useState(today());
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");

  const amountNum = Number(amount);
  const canSave =
    !!title && !!date && !!categoryId && amountNum > 0 && !create.isPending;

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
      { onSuccess: onClose },
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

        <Field label="Category">
          <Select
            value={categoryId}
            onChange={setCategoryId}
            options={[
              { value: "", label: categories.length ? "Choose a category…" : "No categories" },
              ...categories.map((c) => ({ value: c.category_id, label: c.category_display })),
            ]}
          />
        </Field>

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

        {categories.length === 0 && !categoriesQ.isLoading && (
          <p className="text-[12px] text-warn">
            No expense categories yet — add one in Settings before recording an
            expense.
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
            icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
          >
            Record expense
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
