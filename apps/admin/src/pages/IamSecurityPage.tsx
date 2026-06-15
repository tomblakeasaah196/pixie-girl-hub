import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { ShieldCheck, ScrollText, KeyRound, Users, Activity } from "lucide-react";
import { Card } from "@/components/ui/primitives";

/**
 * IAM & Security — new module home (placeholder).
 *
 * Scope is being defined; for now this is the landing the Settings
 * "IAM & Security" tile deep-links to. The AUDIT LOG moves here (out of
 * Settings). Full build — sessions, access reviews, audit search,
 * security events — lands in its own PR once scoped.
 */
const PLANNED = [
  { icon: ScrollText, title: "Audit Log", body: "Append-only trail of every privileged action, searchable by user, module and date." },
  { icon: Activity, title: "Security Events", body: "Failed logins, password resets, permission changes, secret rotations." },
  { icon: Users, title: "Sessions & Devices", body: "Active sessions per user; force sign-out; device trust." },
  { icon: KeyRound, title: "Access Reviews", body: "Periodic attestation of who can do what, exportable for compliance." },
];

export function IamSecurityPage() {
  useBreadcrumbs([{ label: "IAM & Security" }]);
  return (
    <div className="max-w-[900px]">
      <div className="flex items-center gap-3 mb-2">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <ShieldCheck className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">IAM & Security</h2>
          <p className="text-text-muted text-[13px]">
            Identity, access and the audit trail. Scope in progress — full build lands next.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
        {PLANNED.map((p) => {
          const Icon = p.icon;
          return (
            <Card key={p.title} className="p-5">
              <div className="flex items-center gap-2.5 mb-2">
                <Icon className="w-[18px] h-[18px] text-accent-glow" />
                <span className="font-display text-[15px]">{p.title}</span>
                <span className="ml-auto text-[9px] uppercase tracking-wide text-warn/80 border border-warn/30 rounded px-1.5 py-px">
                  planned
                </span>
              </div>
              <p className="text-text-muted text-[12.5px] leading-relaxed">{p.body}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
