import { useEffect, useState } from "react";
import {
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Check,
  AlertCircle,
  MapPin,
  History,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAuthStore } from "@/stores/auth";
import { formatDateTime } from "@/lib/format";
import {
  useGeoapifySettings,
  useUpsertGeoapifySettings,
  useTestGeoapifySettings,
  useRevealGeoapifyKey,
  useGeoapifySecretReveals,
} from "@/lib/geoapify-settings-api";

/**
 * Geoapify connection settings — mirrors ApifySettingsModal's secret pattern
 * (masked first-4 pill, password-gated reveal, Test button) for the one
 * platform-wide Geoapify API key that powers clock-in address labels and the
 * office-location picker's search/map. Replaces the old GEOAPIFY_API_KEY
 * .env variable, which now only serves as an emergency fallback.
 */
export function GeoapifySettingsModal({ onClose }: { onClose: () => void }) {
  const settingsQ = useGeoapifySettings();
  const upsert = useUpsertGeoapifySettings();
  const test = useTestGeoapifySettings();

  const [mode, setMode] = useState<"masked" | "revealed" | "new">("new");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const settings = settingsQ.data;
  const hasStored = !!settings?.has_api_key;

  useEffect(() => {
    setMode(hasStored ? "masked" : "new");
    setNotes(settings?.notes ?? "");
  }, [hasStored, settings?.notes]);

  const revealed = mode === "revealed" || mode === "new";

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={
        <span className="inline-flex items-center gap-2">
          <MapPin className="w-4 h-4 text-accent-glow" />
          Configure Geoapify
        </span>
      }
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              upsert.mutate(
                {
                  api_key: draft && mode !== "masked" ? draft : undefined,
                  notes,
                },
                { onSuccess: () => setDraft("") },
              )
            }
            disabled={upsert.isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {upsert.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save changes
          </button>
        </>
      }
    >
      <p className="text-[12.5px] text-text-muted mb-4">
        This key powers clock-in address labels and the office-location
        picker&rsquo;s search + map — it replaces the old GEOAPIFY_API_KEY
        environment variable.
      </p>

      <label className="block text-[11.5px] text-text-muted mb-1">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="w-3 h-3" />
          Geoapify API key
        </span>
      </label>
      <div className="flex items-stretch gap-2">
        {revealed ? (
          <input
            type={mode === "new" ? "password" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="geoapify_api_…"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore=""
            className="flex-1 rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-accent/40"
          />
        ) : (
          <div className="flex-1 rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] font-mono text-text-muted select-none">
            {settings?.api_key_first4 ?? "----"}
            <span className="tracking-[0.35em] ml-0.5">••••</span>
          </div>
        )}
        {hasStored && !revealed && (
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            className="rounded-xl bg-panel-2 border hairline px-3 py-2 text-[12px] hover:border-accent/40 inline-flex items-center gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" /> Reveal / edit
          </button>
        )}
        {revealed && hasStored && (
          <button
            type="button"
            onClick={() => {
              setMode("masked");
              setDraft("");
            }}
            className="rounded-xl bg-panel-2 border hairline px-3 py-2 text-[12px] hover:border-accent/40 inline-flex items-center gap-1.5"
            title="Hide plaintext"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <p className="text-[10.5px] text-text-faint mt-1">
        {hasStored
          ? "Stored encrypted. Revealing or editing the full key requires your account password — every reveal is logged."
          : "Stored encrypted at rest; only the first 4 characters will be shown after saving."}
      </p>

      {passwordOpen && (
        <GeoapifyPasswordConfirmModal
          onCancel={() => setPasswordOpen(false)}
          onRevealed={(value) => {
            setPasswordOpen(false);
            setMode("revealed");
            setDraft(value);
          }}
        />
      )}

      <label className="block text-[11.5px] text-text-muted mb-1 mt-4">Notes (optional)</label>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="e.g. which Geoapify project this key belongs to"
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
      />

      {hasStored && (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2.5 text-[13px] hover:border-accent/40 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {test.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            Test connection
          </button>
          {test.isSuccess && (
            <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-text-primary inline-flex gap-2 items-start w-full">
              <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <span>
                <strong className="text-success">Connection healthy</strong>
                {test.data?.sample_address && <> — resolved &ldquo;{test.data.sample_address}&rdquo;</>}
              </span>
            </div>
          )}
          {test.isError && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger inline-flex gap-2 items-start w-full">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {test.error instanceof Error ? test.error.message : "Test failed"}
            </div>
          )}
        </div>
      )}

      {hasStored && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-[11.5px] text-text-muted inline-flex items-center gap-1.5 hover:text-text-primary"
          >
            <History className="w-3.5 h-3.5" />
            Reveal history
          </button>
          {historyOpen && <GeoapifyRevealHistory />}
        </div>
      )}
    </Modal>
  );
}

function GeoapifyPasswordConfirmModal({
  onCancel,
  onRevealed,
}: {
  onCancel: () => void;
  onRevealed: (value: string) => void;
}) {
  const [password, setPassword] = useState("");
  const user = useAuthStore((s) => s.user);
  const reveal = useRevealGeoapifyKey();

  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title={
        <span className="inline-flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-accent-glow" />
          Confirm your password
        </span>
      }
      footer={
        <>
          <button
            onClick={onCancel}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => reveal.mutate(password, { onSuccess: (r) => onRevealed(r.value) })}
            disabled={!password || reveal.isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {reveal.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            Reveal
          </button>
        </>
      }
    >
      <p className="text-[12.5px] text-text-muted mb-3">
        To reveal or edit the <strong>Geoapify API key</strong>, re-enter the
        password for <strong>{user?.email ?? "your account"}</strong>. This
        reveal is logged.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Your login password"
        autoFocus
        autoComplete="current-password"
        onKeyDown={(e) => {
          if (e.key === "Enter" && password && !reveal.isPending) {
            reveal.mutate(password, { onSuccess: (r) => onRevealed(r.value) });
          }
        }}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-accent/40"
      />
      {reveal.isError && (
        <p className="text-[12px] text-danger mt-2 inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          {reveal.error instanceof Error ? reveal.error.message : "Incorrect password"}
        </p>
      )}
    </Modal>
  );
}

function GeoapifyRevealHistory() {
  const q = useGeoapifySecretReveals(true);
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <ul className="mt-2 rounded-xl border hairline bg-panel-2 divide-y hairline">
      {rows.slice(0, 10).map((r) => (
        <li
          key={r.reveal_id}
          className="px-3 py-2 text-[11.5px] text-text-muted flex items-center justify-between gap-2"
        >
          <span className="truncate">
            <span className="text-text-primary">{r.display_name || r.email || "Unknown"}</span>{" "}
            revealed the key
          </span>
          <span className="text-text-faint shrink-0">{formatDateTime(r.revealed_at)}</span>
        </li>
      ))}
    </ul>
  );
}
