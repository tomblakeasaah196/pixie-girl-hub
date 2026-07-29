import { useEffect, useState } from "react";
import { ShieldCheck, Trash2, KeyRound, Search, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, Pill } from "@/components/ui/primitives";
import { Field } from "@/components/ui/Form";
import { useVaultGrants, useGrantVault, useRevokeVault } from "@/lib/catalogue";
import { useIamUsers, type IamUser } from "@/lib/iam";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

function useDebounce<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Owner-only cost-vault access panel (P0-1). Faith alone grants/revokes who
 * may see true landed cost + supplier identity. The server enforces is_ceo;
 * this UI is only rendered for the owner.
 *
 * Access is granted by picking an employee by name (search-as-you-type over
 * active staff) rather than pasting a raw user UUID — the id still travels to
 * the API under the hood, but the operator only ever sees names + emails.
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
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search.trim(), 250);
  const [selected, setSelected] = useState<IamUser | null>(null);

  // Active staff only — the vault is granted to employees, and inviting a
  // suspended/disabled account makes no sense. Server-side search over name +
  // email. Enabled only while the modal is open.
  // Gated on `open` — this modal is always mounted in BaseTab (only the CEO's
  // button opens it), so an ungated fetch would hit /iam/users for every base
  // tab view, including non-CEOs who'd get a 403.
  const usersQ = useIamUsers(
    { search: debounced || undefined, status: "active" },
    { enabled: open },
  );

  const grantedIds = new Set((grants.data ?? []).map((g) => g.user_id));
  const candidates = (usersQ.data?.rows ?? []).slice(0, 8);

  const add = () => {
    if (!selected) return;
    grant.mutate(
      { user_id: selected.user_id },
      {
        onSuccess: () => {
          setSelected(null);
          setSearch("");
        },
      },
    );
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

      <Field label="Grant an employee" hint="search staff by name or email">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
            }}
            placeholder="e.g. Ada, or ada@…"
            className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
          />
        </div>
      </Field>

      {/* Employee results */}
      <div className="mt-2 rounded-[11px] border hairline overflow-hidden max-h-[240px] overflow-y-auto">
        {usersQ.isLoading ? (
          <div className="px-3 py-4 text-[12px] text-text-faint">Loading staff…</div>
        ) : usersQ.isError ? (
          <div className="px-3 py-4 text-[12px] text-danger">
            Couldn't load staff.
          </div>
        ) : candidates.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-text-faint">
            {debounced ? `No active staff match “${debounced}”.` : "No active staff."}
          </div>
        ) : (
          candidates.map((u) => {
            const already = grantedIds.has(u.user_id);
            const active = selected?.user_id === u.user_id;
            return (
              <button
                key={u.user_id}
                type="button"
                disabled={already}
                onClick={() => setSelected(active ? null : u)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b hairline last:border-b-0 disabled:cursor-default ${
                  active
                    ? "bg-accent/[0.1]"
                    : already
                      ? "opacity-70"
                      : "hover:bg-text-primary/[0.05]"
                }`}
              >
                <span className="grid place-items-center w-8 h-8 rounded-full bg-accent/10 text-accent-glow text-[11px] font-semibold shrink-0">
                  {initials(u.display_name || u.email)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium truncate">
                    {u.display_name || u.email}
                  </span>
                  <span className="block text-[11px] text-text-faint truncate">
                    {u.email}
                  </span>
                </span>
                {already ? (
                  <Pill tone="success" dot={false}>
                    Has access
                  </Pill>
                ) : active ? (
                  <Check className="w-4 h-4 text-accent-glow shrink-0" />
                ) : null}
              </button>
            );
          })
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="min-w-0 text-[12px] text-text-muted truncate">
          {selected ? (
            <>
              Grant to{" "}
              <span className="text-text-primary font-medium">
                {selected.display_name || selected.email}
              </span>
            </>
          ) : (
            "Pick an employee to grant."
          )}
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={!selected || grant.isPending}
          onClick={add}
          icon={<KeyRound className="w-3.5 h-3.5" />}
        >
          {grant.isPending ? "Granting…" : "Grant access"}
        </Button>
      </div>
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
              <span className="grid place-items-center w-8 h-8 rounded-full bg-accent/10 text-accent-glow text-[11px] font-semibold shrink-0">
                {initials(g.user_name || g.user_email || "?")}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] truncate">
                  {g.user_name || g.user_email || g.user_id}
                </div>
                {(g.user_name || g.user_email) && (
                  <div className="text-[11px] text-text-faint truncate">
                    {g.user_email ?? ""}
                  </div>
                )}
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
