/**
 * Partner profile drawer — certifications + badge manager + contract +
 * specialities + lifecycle (§6.26). Status changes reflect instantly on the
 * public verify page; that's the point of the badge.
 */

import { useState } from "react";
import { BadgeCheck, QrCode, Send, ShieldOff } from "lucide-react";
import { Button, Pill, MoneyText } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, ConfirmDialog } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { usePartner, usePartnerMutations, useTiers } from "./hooks";
import { PARTNER_STATUS_META } from "./constants";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b hairline last:border-0">
      <span className="micro pt-0.5 shrink-0">{label}</span>
      <span className="text-[13px] text-right">{children}</span>
    </div>
  );
}

export function PartnerDrawer({
  stylistId,
  onClose,
}: {
  stylistId: string;
  onClose: () => void;
}) {
  const can = useAuthStore((s) => s.can);
  const partner = usePartner(stylistId);
  const tiers = useTiers();
  const m = usePartnerMutations(stylistId);
  const [awarding, setAwarding] = useState(false);
  const [awardTier, setAwardTier] = useState("");
  const [awardScore, setAwardScore] = useState("");
  const [suspend, setSuspend] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [newSpec, setNewSpec] = useState({ service_key: "", display_name: "", rate: "" });

  const p = partner.data;
  const canEdit = can("stylist_programme", "edit");
  const canApprove = can("stylist_programme", "approve");
  const badgeLive = p && p.badge_token && !p.badge_revoked_at;
  const onProbation =
    p?.probation_ends_at && new Date(p.probation_ends_at) > new Date();

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={p ? p.display_name : "Partner"}
      subtitle={p ? `${p.partner_code} · ${p.city}, ${p.country_code}` : undefined}
    >
      {partner.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 rounded-xl bg-text-primary/[0.05] animate-pulse" />
          ))}
        </div>
      )}
      {partner.isError && (
        <ErrorState
          message={(partner.error as Error).message}
          onRetry={() => partner.refetch()}
        />
      )}
      {p && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={PARTNER_STATUS_META[p.status].tone}>
              {PARTNER_STATUS_META[p.status].label}
            </Pill>
            {onProbation && (
              <Pill tone="warn" dot={false}>
                Probation to {new Date(p.probation_ends_at!).toLocaleDateString()}
              </Pill>
            )}
            {badgeLive ? (
              <Pill tone="success" dot={false}>
                <BadgeCheck className="w-3 h-3" /> Badge live
              </Pill>
            ) : (
              <Pill tone="neutral" dot={false}>No badge</Pill>
            )}
          </div>

          <section className="glass rounded-xl p-4">
            <Row label="Verified rating">
              {p.rating_count > 0
                ? `${Number(p.avg_rating).toFixed(2)}★ (${p.rating_count})`
                : "No verified reviews yet"}
            </Row>
            <Row label="Capacity">
              {p.current_active_count}/{p.max_active_assignments} active jobs
            </Row>
            <Row label="Referral code">
              <span className="font-mono">{p.referral_code ?? "—"}</span>
            </Row>
            <Row label="Contract">
              {p.contract_signed_at
                ? `Signed ${new Date(p.contract_signed_at).toLocaleDateString()}`
                : p.contract_document_id
                  ? "Sent — awaiting signature"
                  : "Not generated"}
            </Row>
            <Row label="Payout account">
              {p.payout_bank_name
                ? `${p.payout_bank_name} · ${p.payout_account_name ?? ""} (${p.payout_currency})`
                : "Not provided"}
            </Row>
          </section>

          {/* Badge + contract + invite actions */}
          {canEdit && (
            <section className="flex gap-2 flex-wrap">
              {badgeLive ? (
                <Button
                  size="sm"
                  variant="danger"
                  icon={<ShieldOff className="w-3.5 h-3.5" />}
                  disabled={m.revokeBadge.isPending}
                  onClick={() => m.revokeBadge.mutate()}
                >
                  Revoke badge
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={<QrCode className="w-3.5 h-3.5" />}
                  disabled={m.issueBadge.isPending}
                  onClick={() => m.issueBadge.mutate()}
                >
                  Issue badge
                </Button>
              )}
              <Button
                size="sm"
                icon={<Send className="w-3.5 h-3.5" />}
                disabled={m.sendContract.isPending}
                onClick={() => m.sendContract.mutate()}
              >
                {p.contract_document_id ? "Resend contract" : "Send contract"}
              </Button>
              <Button
                size="sm"
                disabled={m.invite.isPending}
                onClick={() => m.invite.mutate()}
              >
                {m.invite.isSuccess ? "Invite sent ✓" : "Send portal invite"}
              </Button>
              {p.status === "certified" || p.status === "vetted" ? (
                <Button size="sm" variant="danger" onClick={() => setSuspend(true)}>
                  Suspend
                </Button>
              ) : p.status === "suspended" ? (
                <Button
                  size="sm"
                  onClick={() => m.setStatus.mutate({ status: "certified" })}
                >
                  Reinstate
                </Button>
              ) : null}
            </section>
          )}
          {badgeLive && (
            <p className="text-[11.5px] text-text-faint">
              Public verify: <span className="font-mono">/verify/badge/{p.badge_token}</span>
            </p>
          )}

          {/* Certifications */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="micro">Certifications</h3>
              {canApprove && (
                <Button size="sm" onClick={() => setAwarding(true)}>
                  Award tier
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {p.certifications.map((c) => (
                <div key={c.certification_id} className="glass rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold capitalize">
                      {tiers.data?.find((t) => t.tier_key === c.tier_key)?.label ?? c.tier_key}
                      {c.is_current && !c.revoked_at && (
                        <Pill tone="success" dot={false}>Current</Pill>
                      )}
                      {c.revoked_at && <Pill tone="danger" dot={false}>Revoked</Pill>}
                    </div>
                    <div className="text-[11.5px] text-text-faint tabular-nums">
                      {new Date(c.awarded_at).toLocaleDateString()} →{" "}
                      {new Date(c.expires_at).toLocaleDateString()}
                      {c.assessment_score != null && ` · score ${Number(c.assessment_score)}`}
                    </div>
                  </div>
                  {canApprove && c.is_current && !c.revoked_at && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => m.revokeCertification.mutate(c.certification_id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
              {p.certifications.length === 0 && (
                <p className="text-[12.5px] text-text-faint">
                  No certifications — award a tier to certify this partner.
                </p>
              )}
            </div>
          </section>

          {/* Specialities */}
          <section>
            <h3 className="micro mb-2">Specialities & rates</h3>
            <div className="space-y-2">
              {p.specialities.map((s) => (
                <div key={s.speciality_id} className="glass rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold">{s.display_name}</div>
                    <div className="text-[11.5px] text-text-faint font-mono">{s.service_key}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <MoneyText ngn={Number(s.rate)} />
                    {!s.is_active && <Pill tone="neutral" dot={false}>Inactive</Pill>}
                    {canEdit && s.is_active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => m.removeSpeciality.mutate(s.speciality_id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {canEdit && (
                <div className="flex gap-2 items-end flex-wrap">
                  <div>
                    <label className="label">Service key</label>
                    <input
                      className="input h-9 w-32 font-mono"
                      placeholder="install"
                      value={newSpec.service_key}
                      onChange={(e) => setNewSpec((f) => ({ ...f, service_key: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Display name</label>
                    <input
                      className="input h-9 w-40"
                      placeholder="Wig Install"
                      value={newSpec.display_name}
                      onChange={(e) => setNewSpec((f) => ({ ...f, display_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Rate (₦)</label>
                    <input
                      className="input h-9 w-28 tabular-nums"
                      type="number"
                      min={0}
                      value={newSpec.rate}
                      onChange={(e) => setNewSpec((f) => ({ ...f, rate: e.target.value }))}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={
                      !newSpec.service_key || !newSpec.display_name || !newSpec.rate ||
                      m.setSpeciality.isPending
                    }
                    onClick={() =>
                      m.setSpeciality.mutate(
                        {
                          service_key: newSpec.service_key,
                          display_name: newSpec.display_name,
                          rate: Number(newSpec.rate),
                        },
                        { onSuccess: () => setNewSpec({ service_key: "", display_name: "", rate: "" }) },
                      )
                    }
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Award tier */}
      <ConfirmDialog
        open={awarding}
        title="Award certification tier"
        tone="accent"
        busy={m.awardCertification.isPending}
        confirmLabel="Award"
        message={
          <div className="space-y-3 text-left">
            <div>
              <label className="label">Tier</label>
              <select
                className="input w-full"
                value={awardTier}
                onChange={(e) => setAwardTier(e.target.value)}
              >
                <option value="">Select tier…</option>
                {(tiers.data ?? [])
                  .filter((t) => t.is_active)
                  .map((t) => (
                    <option key={t.tier_key} value={t.tier_key}>
                      {t.label} — ×{Number(t.payout_multiplier)} payout, {t.validity_months}mo
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">Assessment score (0–100, optional)</label>
              <input
                className="input w-28 tabular-nums"
                type="number"
                min={0}
                max={100}
                value={awardScore}
                onChange={(e) => setAwardScore(e.target.value)}
              />
            </div>
            <p className="text-[11.5px]">
              Validity comes from the tier config; the partner is notified and
              the verify page updates instantly. Expiry reminders + auto-lapse
              run nightly.
            </p>
          </div>
        }
        onConfirm={() => {
          const tier = tiers.data?.find((t) => t.tier_key === awardTier);
          if (!tier) return;
          const expires = new Date();
          expires.setMonth(expires.getMonth() + tier.validity_months);
          m.awardCertification.mutate(
            {
              tier_key: tier.tier_key,
              expires_at: expires.toISOString(),
              assessment_score: awardScore ? Number(awardScore) : undefined,
            },
            { onSuccess: () => setAwarding(false) },
          );
        }}
        onClose={() => setAwarding(false)}
      />

      {/* Suspend */}
      <ConfirmDialog
        open={suspend}
        title="Suspend this partner?"
        busy={m.setStatus.isPending}
        confirmLabel="Suspend"
        message={
          <div className="space-y-3 text-left">
            <p>
              Suspension removes them from routing and flips the public verify
              page immediately. The badge link stays but shows the suspension.
            </p>
            <textarea
              className="input w-full min-h-[70px]"
              placeholder="Reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
            />
          </div>
        }
        onConfirm={() =>
          m.setStatus.mutate(
            { status: "suspended", reason: suspendReason || undefined },
            { onSuccess: () => setSuspend(false) },
          )
        }
        onClose={() => setSuspend(false)}
      />
    </Drawer>
  );
}
