import { useState } from "react";
import { Play, Pause, Plus, Clock, FlaskConical, Package } from "lucide-react";
import { Pill, Button } from "@/components/ui/primitives";
import {
  useJobMaterials,
  useLogMaterial,
  useJobReferences,
  useReferenceMutations,
  useJobTimeLogs,
  useStudioLifecycle,
} from "./hooks";
import type { ServiceJob } from "./types";

const inputCls =
  "flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent transition-colors";

function fmt(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * The doing-the-work panel: a running clock, materials logging, and the style
 * brief (view + author). Shared by the stylist's "My Jobs" and Ops' QC screen so
 * both see exactly what happened on the wig. Kept deliberately simple.
 */
export function JobWorkPanel({
  job,
  canLog = true,
}: {
  job: ServiceJob;
  canLog?: boolean;
}) {
  const { data: materials } = useJobMaterials(job.job_id);
  const { data: timeLogs } = useJobTimeLogs(job.job_id);
  const { data: refs } = useJobReferences(job.job_id);
  const logMaterial = useLogMaterial(job.job_id);
  const refMut = useReferenceMutations(job.job_id);
  const life = useStudioLifecycle(job.job_id);

  const [chem, setChem] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");

  const totalMins = (timeLogs ?? []).reduce(
    (n, l) => n + (l.duration_minutes ?? 0),
    0,
  );
  const running = (timeLogs ?? []).some((l) => !l.ended_at);
  const canTime = ["assigned", "in_progress", "rework"].includes(job.status);

  return (
    <div className="space-y-3">
      {/* Timer */}
      {canTime && (
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <Clock size={16} className="text-accent-glow" />
          <span className="text-sm">
            Time on this wig: <b>{fmt(totalMins)}</b>
            {running && <span className="text-success"> · running</span>}
          </span>
          {canLog && (
            <div className="ml-auto flex gap-2">
              {running ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pause className="w-4 h-4" />}
                  disabled={life.pause.isPending}
                  onClick={() => life.pause.mutate()}
                >
                  Pause
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Play className="w-4 h-4" />}
                  disabled={life.resume.isPending || life.start.isPending}
                  onClick={() =>
                    job.status === "in_progress"
                      ? life.resume.mutate()
                      : life.start.mutate()
                  }
                >
                  {job.status === "in_progress" ? "Resume" : "Start"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Materials */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FlaskConical size={15} className="text-accent-glow" /> Materials used
        </div>
        <div className="flex flex-wrap gap-2">
          {(materials ?? []).length === 0 && (
            <span className="text-muted text-sm">Nothing logged yet.</span>
          )}
          {(materials ?? []).map((m) => (
            <Pill
              key={m.material_id}
              tone={m.kind === "chemical" ? "info" : "accent"}
            >
              {m.kind === "chemical" ? (
                <FlaskConical size={11} className="inline mr-1" />
              ) : (
                <Package size={11} className="inline mr-1" />
              )}
              {m.chemical_name ?? "item"}
              {m.quantity ? ` ×${m.quantity}` : ""}
            </Pill>
          ))}
        </div>
        {canLog && (
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              value={chem}
              onChange={(e) => setChem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && chem.trim()) {
                  e.preventDefault();
                  logMaterial.mutate({
                    kind: "chemical",
                    chemical_name: chem.trim(),
                  });
                  setChem("");
                }
              }}
              placeholder="Add a chemical used (e.g. Toner 6.1) + Enter"
            />
            <Button
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              disabled={!chem.trim() || logMaterial.isPending}
              onClick={() => {
                logMaterial.mutate({
                  kind: "chemical",
                  chemical_name: chem.trim(),
                });
                setChem("");
              }}
            >
              Add
            </Button>
          </div>
        )}
      </div>

      {/* Style brief — view + author (text / link / creative freedom) */}
      <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 space-y-2">
        <div className="text-xs text-accent-glow font-semibold">
          Style brief
        </div>
        {(refs ?? []).length === 0 && (
          <span className="text-muted text-sm">No reference yet.</span>
        )}
        {(refs ?? []).map((r) => (
          <div key={r.reference_id} className="flex items-start gap-2 text-sm">
            {r.ref_type === "creative_freedom" && (
              <Pill tone="accent">🎨 Creative freedom</Pill>
            )}
            {r.ref_type === "video_link" && r.url && (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline break-all"
              >
                {r.url}
              </a>
            )}
            {(r.ref_type === "text" || r.body) && r.body && (
              <span className="text-text-primary">“{r.body}”</span>
            )}
            {(r.ref_type === "image" || r.ref_type === "audio") && (
              <span className="text-muted">
                {r.ref_type === "image" ? "📷 photo" : "🎙 voice note"}
              </span>
            )}
            {canLog && (
              <button
                type="button"
                className="ml-auto text-muted hover:text-danger"
                onClick={() => refMut.remove.mutate(r.reference_id)}
                aria-label="Remove reference"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canLog && (
          <div className="space-y-2 pt-1">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note for the stylist…"
              />
              <Button
                size="sm"
                disabled={!note.trim() || refMut.add.isPending}
                onClick={() => {
                  refMut.add.mutate({ ref_type: "text", body: note.trim() });
                  setNote("");
                }}
              >
                Add note
              </Button>
            </div>
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Paste an inspiration link (YouTube/IG)…"
              />
              <Button
                size="sm"
                disabled={!link.trim() || refMut.add.isPending}
                onClick={() => {
                  refMut.add.mutate({
                    ref_type: "video_link",
                    url: link.trim(),
                  });
                  setLink("");
                }}
              >
                Add link
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                refMut.add.mutate({ ref_type: "creative_freedom" })
              }
            >
              🎨 Let the stylist interpret freely
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
