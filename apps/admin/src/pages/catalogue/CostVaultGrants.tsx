import { useState } from "react";
import { ShieldCheck, Trash2, KeyRound } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field } from "@/components/ui/Form";
import { useVaultGrants, useGrantVault, useRevokeVault } from "@/lib/catalogue";

/**
 * Owner-only cost-vault access panel (P0-1). Faith alone grants/revokes who
 * may see true landed cost + supplier identity. The server enforces is_ceo;
 * this UI is only rendered for the owner.
 */
export function CostVaultGrants({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const grants = useVaultGrants(open);
  const grant = useGrantVault();
  const revoke = useRevokeVault();
  const [userId, setUserId] = useState("");

  const add = () => {
    const id = userId.trim();
    if (!id) return;
    grant.mutate({ user_id: id }, { onSuccess: () => setUserId("") });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent-glow" /> Cost-vault access
        </span>
      }
    >
      <p className="text-[12.5px] text-text-muted mb-4 leading-relaxed">
        Only you and the people you grant here can see true landed cost and
        supplier identity. Everyone else sees the operational wholesale price
        only. Every view is audited.
      </p>

      <Field label="Grant a user" hint="paste their user ID">
        <div className="flex gap-2">
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="user UUID"
            className="flex-1 h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 font-mono"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!userId.trim() || grant.isPending}
            onClick={add}
            icon={<KeyRound className="w-3.5 h-3.5" />}
          >
            Grant
          </Button>
        </div>
      </Field>
      {grant.isError && (
        <p className="text-[12px] text-danger mt-1.5">
          {grant.error instanceof Error
            ? grant.error.message
            : "Could not grant access."}
        </p>
      )}

      <div className="micro mt-5 mb-2">Current grantees</div>
      {grants.isLoading ? (
        <div className="text-[12px] text-text-faint py-3">Loading…</div>
      ) : (grants.data ?? []).length === 0 ? (
        <div className="text-[12px] text-text-faint py-3">
          No one else has access.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {(grants.data ?? []).map((g) => (
            <li
              key={g.grant_id}
              className="flex items-center gap-3 p-2.5 rounded-[11px] bg-text-primary/[0.04] border hairline"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] truncate">
                  {g.user_email ?? g.user_id}
                </div>
                <div className="text-[10.5px] text-text-faint font-mono truncate">
                  {g.user_id}
                </div>
              </div>
              <button
                onClick={() => revoke.mutate({ userId: g.user_id })}
                disabled={revoke.isPending}
                className="grid place-items-center w-8 h-8 rounded-[9px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                aria-label="Revoke"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
