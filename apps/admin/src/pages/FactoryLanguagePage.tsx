import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Globe,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import {
  listLanguages,
  createLanguage,
  updateLanguage,
  deleteLanguage,
  type FactoryLanguage,
} from "@/lib/factory-i18n-api";
import { syncFromApi } from "@/i18n";
import enTranslations from "@/i18n/locales/en.json";

const REQUIRED_KEYS = Object.keys(
  enTranslations,
) as (keyof typeof enTranslations)[];

// ── Language list ──────────────────────────────────────────

function LanguageRow({
  lang,
  canEdit,
  onToggle,
  onDelete,
}: {
  lang: FactoryLanguage;
  canEdit: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const isBase = lang.language_code === "en";

  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs bg-white/5 px-2 py-1 rounded-lg uppercase tracking-widest text-text-muted w-12 text-center">
          {lang.language_code}
        </span>
        <span className="font-semibold text-sm">{lang.display_name}</span>
        {isBase && (
          <span className="text-[10px] text-text-faint bg-white/5 px-2 py-0.5 rounded-full">
            base
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Pill tone={lang.is_active ? "success" : "neutral"} dot={false}>
          {lang.is_active ? "Active" : "Inactive"}
        </Pill>
        {canEdit && !isBase && (
          <>
            <Button size="sm" variant="ghost" onClick={onToggle}>
              {lang.is_active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="w-3.5 h-3.5 text-danger" />}
              onClick={onDelete}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── JSON validator ─────────────────────────────────────────

function validateTranslationJson(raw: string): {
  ok: boolean;
  parsed?: Record<string, string>;
  missing?: string[];
  errors?: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      errors: ["Invalid JSON — paste the full JSON object from the AI."],
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ["Expected a JSON object (starts with {)."] };
  }

  const obj = parsed as Record<string, unknown>;
  const errors: string[] = [];
  const missing: string[] = [];

  for (const key of REQUIRED_KEYS) {
    if (!(key in obj)) {
      missing.push(key);
    } else if (typeof obj[key] !== "string") {
      errors.push(`Key "${key}" must be a string (got ${typeof obj[key]}).`);
    }
  }

  if (missing.length > 0 || errors.length > 0) {
    return { ok: false, missing, errors };
  }

  return { ok: true, parsed: obj as Record<string, string> };
}

// ── Add language form ──────────────────────────────────────

function AddLanguageForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [validation, setValidation] = useState<ReturnType<
    typeof validateTranslationJson
  > | null>(null);

  const create = useMutation({
    mutationFn: (data: {
      language_code: string;
      display_name: string;
      translations: Record<string, string>;
    }) => createLanguage(data),
    onSuccess: async (newLang) => {
      // Hot-swap translations into i18next immediately
      if (validation?.parsed) {
        await syncFromApi([
          {
            language_code: newLang.language_code,
            display_name: newLang.display_name,
            translations: validation.parsed,
          },
        ]);
      }
      qc.invalidateQueries({ queryKey: ["factory-i18n-languages"] });
      qc.invalidateQueries({ queryKey: ["factory-i18n-list"] });
      setCode("");
      setName("");
      setRaw("");
      setValidation(null);
      setOpen(false);
      onSuccess();
    },
  });

  const handleValidate = () => {
    setValidation(validateTranslationJson(raw));
  };

  const handleSave = () => {
    if (!validation?.ok || !validation.parsed) return;
    create.mutate({
      language_code: code.trim().toLowerCase(),
      display_name: name.trim(),
      translations: validation.parsed,
    });
  };

  const prettyRaw = () => {
    try {
      setRaw(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      /* keep as-is */
    }
  };

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 text-accent-glow">
            <Plus className="w-4 h-4" />
          </span>
          <div>
            <div className="font-semibold text-sm">Add New Language</div>
            <div className="text-text-faint text-xs mt-0.5">
              3-step process — no code required
            </div>
          </div>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-text-faint" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-faint" />
        )}
      </button>

      {open && (
        <div className="border-t border-white/[0.06] p-5 space-y-6">
          {/* Step 1 — Download guide */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-accent/20 text-accent-glow text-[10px] font-bold grid place-items-center shrink-0">
                1
              </span>
              <span className="text-sm font-semibold">
                Download the translation guide
              </span>
            </div>
            <p className="text-text-faint text-xs mb-3 ml-7">
              The guide contains all 61 translation keys with context, plus a
              ready-to-paste AI prompt. Upload it to Claude, ChatGPT, or any AI
              — it will return the exact JSON you need.
            </p>
            <a
              href="/factory-i18n-guide.md"
              download="factory-i18n-guide.md"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-[12px] font-semibold border border-line text-text-muted hover:text-text-primary hover:bg-white/[0.04] transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Download Guide (Markdown)
            </a>
          </div>

          {/* Step 2 — Language details */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-accent/20 text-accent-glow text-[10px] font-bold grid place-items-center shrink-0">
                2
              </span>
              <span className="text-sm font-semibold">Language details</span>
            </div>
            <div className="ml-7 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Language code *</label>
                <input
                  className="input w-full font-mono uppercase"
                  placeholder="e.g. ko"
                  maxLength={5}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toLowerCase())}
                />
                <p className="text-text-faint text-[11px] mt-1">
                  2-5 lowercase letters (ISO 639-1)
                </p>
              </div>
              <div>
                <label className="label">Display name *</label>
                <input
                  className="input w-full"
                  placeholder="e.g. 한국어"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="text-text-faint text-[11px] mt-1">
                  Name in the native language
                </p>
              </div>
            </div>
          </div>

          {/* Step 3 — Paste JSON */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-accent/20 text-accent-glow text-[10px] font-bold grid place-items-center shrink-0">
                3
              </span>
              <span className="text-sm font-semibold">
                Paste the AI-generated JSON
              </span>
            </div>
            <div className="ml-7 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">Translation JSON *</label>
                  <button
                    type="button"
                    onClick={prettyRaw}
                    className="text-[11px] text-accent hover:underline"
                  >
                    Prettify
                  </button>
                </div>
                <textarea
                  className="input w-full h-48 font-mono text-xs resize-y"
                  placeholder={'{\n  "currentBalance": "현재 잔액",\n  ...\n}'}
                  value={raw}
                  onChange={(e) => {
                    setRaw(e.target.value);
                    setValidation(null);
                  }}
                />
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={handleValidate}
                disabled={!raw.trim()}
              >
                Validate JSON
              </Button>

              {/* Validation result */}
              {validation && (
                <div
                  className={`rounded-xl p-3 text-xs space-y-2 ${validation.ok ? "bg-success/10 border border-success/20" : "bg-danger/10 border border-danger/20"}`}
                >
                  {validation.ok ? (
                    <div className="flex items-center gap-2 text-success font-semibold">
                      <CheckCircle2 className="w-4 h-4" />
                      Valid — {REQUIRED_KEYS.length}/{REQUIRED_KEYS.length} keys
                      present
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-danger font-semibold">
                        <AlertTriangle className="w-4 h-4" />
                        {validation.errors?.join(" ") ||
                          `Missing ${validation.missing?.length} keys`}
                      </div>
                      {validation.missing && validation.missing.length > 0 && (
                        <div className="text-text-faint">
                          Missing:{" "}
                          <span className="font-mono">
                            {validation.missing.join(", ")}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Preview table */}
              {validation?.ok && validation.parsed && (
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <div className="micro px-3 py-2 bg-white/[0.03] border-b border-white/10">
                    Translation Preview
                  </div>
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-white/10 text-text-muted">
                          <th className="text-left px-3 py-2 font-medium">
                            Key
                          </th>
                          <th className="text-left px-3 py-2 font-medium">
                            English
                          </th>
                          <th className="text-left px-3 py-2 font-medium text-accent-glow">
                            Translation
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {REQUIRED_KEYS.map((key) => (
                          <tr
                            key={key}
                            className="border-b border-white/[0.04] last:border-0"
                          >
                            <td className="px-3 py-1.5 font-mono text-text-faint">
                              {key}
                            </td>
                            <td className="px-3 py-1.5 text-text-muted max-w-[150px] truncate">
                              {enTranslations[key]}
                            </td>
                            <td className="px-3 py-1.5 font-medium max-w-[150px] truncate">
                              {validation.parsed![key]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Save */}
          <div className="flex gap-3 pt-2 border-t border-white/[0.06]">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !validation?.ok ||
                !code.trim() ||
                !name.trim() ||
                create.isPending
              }
            >
              {create.isPending ? "Saving…" : "Save Language"}
            </Button>
          </div>

          {create.isError && (
            <p className="text-danger text-xs">
              Failed to save. Check that the language code is not already
              registered.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────

export function FactoryLanguagePage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Factory Languages" },
  ]);
  const can = useAuthStore((s) => s.can);
  const qc = useQueryClient();
  const canEdit = can("platform_settings", "edit");

  const {
    data: langs,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["factory-i18n-list"],
    queryFn: listLanguages,
  });

  const toggle = useMutation({
    mutationFn: ({ code, is_active }: { code: string; is_active: boolean }) =>
      updateLanguage(code, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["factory-i18n-list"] }),
  });

  const remove = useMutation({
    mutationFn: (code: string) => deleteLanguage(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory-i18n-list"] });
      qc.invalidateQueries({ queryKey: ["factory-i18n-languages"] });
    },
  });

  const handleDelete = (code: string, name: string) => {
    if (
      !confirm(
        `Remove "${name}" (${code})? Factory screens will fall back to English.`,
      )
    )
      return;
    remove.mutate(code);
  };

  return (
    <div className="max-w-[720px] space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-accent-glow" />
          <h2 className="font-display text-[22px] font-medium">
            Factory Languages
          </h2>
        </div>
        <p className="text-text-muted text-[13px]">
          Manage translations for China factory-facing screens (ledger,
          shipments). New languages take effect immediately — no code changes or
          deploy needed.
        </p>
      </div>

      {/* Registered languages */}
      <div className="glass rounded-2xl p-5">
        <h3 className="font-display text-base font-medium mb-4">
          Registered Languages
        </h3>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        )}
        {isError && <ErrorState />}
        {!isLoading && !isError && (!langs || langs.length === 0) && (
          <EmptyState
            icon={<Globe className="w-6 h-6" />}
            title="No languages registered"
            message="Run migration 000215 to seed English and Chinese."
          />
        )}
        {langs && langs.length > 0 && (
          <>
            {langs.map((lang) => (
              <LanguageRow
                key={lang.language_code}
                lang={lang}
                canEdit={canEdit}
                onToggle={() =>
                  toggle.mutate({
                    code: lang.language_code,
                    is_active: !lang.is_active,
                  })
                }
                onDelete={() =>
                  handleDelete(lang.language_code, lang.display_name)
                }
              />
            ))}
            <p className="text-text-faint text-[11px] mt-3">
              English (en) cannot be removed — it is the fallback language for
              all users.
            </p>
          </>
        )}
      </div>

      {/* Add language */}
      {canEdit ? (
        <AddLanguageForm
          onSuccess={() => {
            /* Query invalidated inside form */
          }}
        />
      ) : (
        <div className="glass rounded-2xl p-5 text-center text-text-faint text-sm">
          You need platform settings edit permission to add languages.
        </div>
      )}
    </div>
  );
}
