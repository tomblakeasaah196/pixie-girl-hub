import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Copy, Check, Ban, Users } from "lucide-react";
import {
  listOperators,
  inviteOperator,
  disableOperator,
} from "@/lib/api";
import type { InviteResult } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { Card, StatusPill, Spinner, EmptyState } from "@/components/ui";

function statusTone(s: string) {
  return s === "active" ? "green" : s === "invited" ? "amber" : "neutral";
}

function InvitePanel({ onInvited }: { onInvited: (r: InviteResult) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => inviteOperator(email.trim(), name.trim() || undefined),
    onSuccess: (r) => {
      setEmail("");
      setName("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["operators"] });
      onInvited(r);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Invite failed"),
  });

  return (
    <Card title="Invite an operator">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            placeholder="dev@jbspraxis.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Name (optional)</label>
          <input
            className="input"
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Send invite
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-signal-red">{error}</p>}
    </Card>
  );
}

function InviteLinkNotice({ result }: { result: InviteResult }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card border-amber/30 bg-amber/5">
      <p className="text-sm text-fog-100">
        Invite created for <strong>{result.email}</strong>.{" "}
        {result.emailed ? (
          <span className="text-signal-green">An email was sent.</span>
        ) : (
          <span className="text-signal-amber">
            Email could not be sent — share this link directly:
          </span>
        )}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-900 px-3 py-2 font-mono text-xs text-fog-200">
          {result.invite_url}
        </code>
        <button
          className="btn-ghost"
          onClick={() => {
            navigator.clipboard?.writeText(result.invite_url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-4 w-4 text-signal-green" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function OperatorsPage() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.operator);
  const [lastInvite, setLastInvite] = useState<InviteResult | null>(null);
  const [pendingDisable, setPendingDisable] = useState<string | null>(null);

  const operators = useQuery({ queryKey: ["operators"], queryFn: listOperators });

  const disable = useMutation({
    mutationFn: (id: string) => disableOperator(id),
    onSettled: () => {
      setPendingDisable(null);
      qc.invalidateQueries({ queryKey: ["operators"] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-fog-100">
          Operators
        </h1>
        <p className="mt-1 text-sm text-fog-300">
          Everyone here is a full admin. Invite JBS Praxis engineers by email.
        </p>
      </div>

      <InvitePanel onInvited={setLastInvite} />
      {lastInvite && <InviteLinkNotice result={lastInvite} />}

      <Card title="All operators">
        {operators.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6 text-fog-400" />
          </div>
        ) : operators.isError ? (
          <EmptyState
            title="Couldn't load operators"
            hint={
              operators.error instanceof Error ? operators.error.message : undefined
            }
            action={
              <button
                className="btn-ghost"
                onClick={() => operators.refetch()}
              >
                Retry
              </button>
            }
          />
        ) : !operators.data?.length ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="No operators yet"
            hint="Invite your first teammate above."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line/60 text-xs uppercase tracking-wider text-fog-400">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Last login</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {operators.data.map((op) => {
                  const isSelf = op.operator_id === me?.operator_id;
                  return (
                    <tr
                      key={op.operator_id}
                      className="border-b border-line/40 last:border-0"
                    >
                      <td className="px-3 py-3 font-medium text-fog-100">
                        {op.display_name}
                        {isSelf && (
                          <span className="ml-2 text-xs text-fog-400">(you)</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-fog-300">{op.email}</td>
                      <td className="px-3 py-3">
                        <StatusPill tone={statusTone(op.status)}>
                          {op.status}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-fog-400">
                        {op.last_login_at
                          ? new Date(op.last_login_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {op.status !== "disabled" &&
                          !isSelf &&
                          (pendingDisable === op.operator_id ? (
                            <span className="inline-flex items-center gap-2">
                              <button
                                className="btn-danger px-2 py-1 text-xs"
                                onClick={() => disable.mutate(op.operator_id)}
                                disabled={disable.isPending}
                              >
                                Confirm
                              </button>
                              <button
                                className="btn-ghost px-2 py-1 text-xs"
                                onClick={() => setPendingDisable(null)}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              className="btn-ghost px-2 py-1 text-xs"
                              onClick={() => setPendingDisable(op.operator_id)}
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Disable
                            </button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
