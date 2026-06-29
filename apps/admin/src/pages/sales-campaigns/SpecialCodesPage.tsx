/**
 * SpecialCodesPage — manage "share-anywhere" VIP discount codes.
 *
 * These are NOT the exit-intent popup code (that lives on a campaign and only
 * surfaces in the mouseleave modal). A code created here has no popup and no
 * campaign binding: you enter a code + a ₦ amount, hand it to a VVIP, and they
 * type it into the checkout's "Have a promo code?" field — the Hub applies the
 * discount server-side (floor-respecting). Backed by the retention coupon
 * engine (shared.coupons); checkout already honours it with no further wiring.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  KeyRound,
  Plus,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  Button,
  Card,
  EmptyState,
  Pill,
  Skeleton,
} from "@/components/ui/primitives";
import { DeniedState, ErrorState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { money } from "@/lib/format";
import {
  useCouponList,
  useCreateCoupon,
  useDeleteCoupon,
  useSetCouponActive,
  type Coupon,
} from "@/lib/coupons";

function fmtDiscount(c: Coupon): string {
  if (c.discount_type === "fixed_amount")
    return `${money(c.discount_value)} off`;
  if (c.discount_type === "percentage")
    return `${Math.round(c.discount_value * 100)}% off`;
  if (c.discount_type === "free_shipping") return "Free shipping";
  return "Special";
}

export function SpecialCodesPage() {
  useBreadcrumbs([
    { label: "Sales Campaigns", href: "/sales-campaigns" },
    { label: "Special codes" },
  ]);
  const { can } = useAuthStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Coupon | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const list = useCouponList();
  const setActive = useSetCouponActive();
  const del = useDeleteCoupon();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // shared.coupons holds every coupon type; this screen is for the manually
  // shared "fixed ₦ off" VIP codes, so surface those (plus any % codes a
  // manager made here). Engine-generated/segment coupons stay in Retention.
  const coupons = useMemo(() => list.data ?? [], [list.data]);

  // Permission gate after hooks (Rules of Hooks).
  if (!can("retention", "view")) {
    return (
      <DeniedState message="You don't have access to discount codes. Ask an admin to grant the Retention module in Org & Workflow." />
    );
  }
  const canCreate = can("retention", "create");
  const canEdit = can("retention", "edit");
  const canDelete = can("retention", "delete");

  function copyCode(code: string) {
    void navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000);
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleteError(null);
    try {
      await del.mutateAsync(toDelete.coupon_id);
      setToDelete(null);
    } catch (e: unknown) {
      setDeleteError((e as Error)?.message || "Couldn't delete this code.");
    }
  }

  return (
    <div className="space-y-5">
      {/* Hero strip */}
      <Card className="p-6 md:p-7 relative overflow-hidden">
        <div
          className="absolute -top-16 -right-12 w-[320px] h-[320px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgb(var(--accent-deep)/0.45), transparent 65%)",
            filter: "blur(38px)",
          }}
        />
        <div className="relative flex flex-col md:flex-row md:items-end gap-5">
          <div className="min-w-0">
            <Link
              to="/sales-campaigns"
              className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Sales Campaigns
            </Link>
            <div className="micro mb-2">VIP & special discount codes</div>
            <h1 className="font-display text-[30px] md:text-[36px] leading-[1.05]">
              <span>A private code, </span>
              <span className="italic text-accent-glow">just for them.</span>
            </h1>
            <p className="text-text-muted mt-2.5 max-w-[640px]">
              Enter a code and a ₦ amount, then share it with a hand-picked
              client. No popup, no campaign — they type it at checkout and the
              discount applies automatically.
            </p>
          </div>
          {canCreate && (
            <div className="md:ml-auto">
              <Button
                size="md"
                variant="primary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setCreateOpen(true)}
              >
                New code
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* List */}
      {list.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-5 space-y-3">
              <Skeleton style={{ height: 18, width: "50%" }} />
              <Skeleton style={{ height: 12, width: "35%" }} />
              <Skeleton style={{ height: 28 }} />
            </Card>
          ))}
        </div>
      )}
      {list.isError && <ErrorState onRetry={() => list.refetch()} />}
      {!list.isLoading && !list.isError && coupons.length === 0 && (
        <Card className="p-2">
          <EmptyState
            icon={<KeyRound className="w-7 h-7" />}
            title="No special codes yet"
            message={
              canCreate
                ? "Create a private code for a VVIP — they type it at checkout and the discount applies. No popup needed."
                : "Ask an admin to grant 'retention.create' permission to add codes."
            }
            action={
              canCreate ? (
                <Button
                  variant="primary"
                  icon={<Sparkles className="w-4 h-4" />}
                  onClick={() => setCreateOpen(true)}
                >
                  Create a code
                </Button>
              ) : null
            }
          />
        </Card>
      )}
      {coupons.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {coupons.map((c) => (
            <Card key={c.coupon_id} className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5 text-accent-glow shrink-0" />
                    <span className="font-mono font-semibold text-[15px] tracking-wide truncate">
                      {c.coupon_code}
                    </span>
                  </div>
                  <div className="text-[12px] text-text-muted truncate mt-1">
                    {c.display_name}
                  </div>
                </div>
                <Pill tone={c.is_active ? "success" : "neutral"}>
                  {c.is_active ? "Active" : "Off"}
                </Pill>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="font-display text-[22px] tabular-nums">
                  {fmtDiscount(c)}
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-text-faint">
                <span>
                  Used{" "}
                  <span className="tabular-nums text-text-muted">
                    {c.total_redeemed}
                  </span>
                  {c.total_usage_limit
                    ? ` / ${c.total_usage_limit}`
                    : " time(s)"}
                </span>
                {c.valid_to && (
                  <span>
                    · Expires {new Date(c.valid_to).toLocaleDateString()}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Copy className="w-3.5 h-3.5" />}
                  onClick={() => copyCode(c.coupon_code)}
                >
                  {copied === c.coupon_code ? "Copied!" : "Copy"}
                </Button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      setActive.mutate({
                        id: c.coupon_id,
                        is_active: !c.is_active,
                      })
                    }
                    disabled={setActive.isPending}
                    className="h-9 px-3 rounded-[10px] text-[12px] font-semibold text-text-muted hover:bg-text-primary/[0.06] disabled:opacity-50"
                  >
                    {c.is_active ? "Turn off" : "Turn on"}
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setToDelete(c);
                    }}
                    className="ml-auto h-9 w-9 grid place-items-center rounded-[10px] text-text-faint hover:text-danger hover:bg-danger/10"
                    aria-label={`Delete ${c.coupon_code}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateCodeModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Delete confirm */}
      <Modal
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title="Delete this code?"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-text-muted">
            <span className="font-mono font-semibold text-text-primary">
              {toDelete?.coupon_code}
            </span>{" "}
            will stop working at checkout immediately. This can't be undone.
          </p>
          {deleteError && (
            <p className="text-[12px] text-danger">{deleteError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setToDelete(null)}
              className="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-text-muted hover:bg-text-primary/[0.06]"
            >
              Cancel
            </button>
            <Button
              variant="danger"
              disabled={del.isPending}
              icon={<Trash2 className="w-4 h-4" />}
              onClick={confirmDelete}
            >
              {del.isPending ? "Deleting…" : "Delete code"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CreateCodeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateCoupon();
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCode("");
    setAmount("");
    setLabel("");
    setExpiry("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanCode = code.trim().toUpperCase();
    const amt = Number(amount);
    if (cleanCode.length < 2) {
      setError("Enter a code of at least 2 characters.");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a discount amount greater than ₦0.");
      return;
    }
    try {
      await create.mutateAsync({
        coupon_code: cleanCode,
        // display_name is required by the engine; default it to the code.
        display_name: label.trim() || cleanCode,
        discount_type: "fixed_amount",
        discount_value: amt,
        valid_to: expiry ? new Date(expiry).toISOString() : undefined,
        is_active: true,
      });
      reset();
      onClose();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || "Couldn't create this code.";
      // The engine returns 409 COUPON_EXISTS for a duplicate code.
      setError(
        /exist/i.test(msg)
          ? "That code already exists — pick a different one."
          : msg,
      );
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New special code">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Code" hint="What the client types at checkout">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="VVIP-AMARA"
            required
            autoFocus
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[14px] tracking-wide uppercase"
          />
        </Field>
        <Field label="Discount amount" hint="Flat ₦ taken off the order">
          <div className="flex items-stretch gap-2">
            <span className="inline-flex items-center px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-muted text-[13px] font-mono">
              ₦
            </span>
            <input
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              placeholder="20000"
              required
              className="flex-1 h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[13px] tabular-nums"
            />
          </div>
        </Field>
        <Field label="Label" hint="Optional · only you see this">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Amara — loyal client"
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
          />
        </Field>
        <Field label="Expires" hint="Optional · leave blank for no expiry">
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
          />
        </Field>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <p className="text-[12px] text-text-faint flex items-center gap-2">
          <KeyRound className="w-3.5 h-3.5" />
          The Hub applies the discount at checkout — never below the price
          floor.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-text-muted hover:bg-text-primary/[0.06]"
          >
            Cancel
          </button>
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending}
            icon={<Plus className="w-4 h-4" />}
          >
            {create.isPending ? "Creating…" : "Create code"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
