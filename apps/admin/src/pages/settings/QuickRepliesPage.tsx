import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  Plus,
  Save,
  Trash2,
  Loader2,
  AlertCircle,
  Hash,
  Check,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useActiveBusiness } from "@/stores/business";
import { Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import type { QuickReply } from "@/lib/smartcomm-types";

/**
 * Quick Replies admin — Settings → Quick Replies.
 *
 * Personal snippets (per-user) AND brand-shared library (per-business).
 * Slash command `/welcome` triggers the matching reply in the
 * Smartcomm composer; `{{variable}}` tokens are detected from the body
 * so the UI can prompt the rep to fill them when sending.
 */

interface QuickReplyDraft {
  reply_id?: string;
  scope: "personal" | "brand";
  slug: string;
  title: string;
  body: string;
  category?: string | null;
  sort_order?: number;
}

const empty = (scope: "personal" | "brand"): QuickReplyDraft => ({
  scope,
  slug: "",
  title: "",
  body: "",
});

function detectVariables(body: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(m[1]);
  return Array.from(out);
}

const qrApi = {
  list: () => api.get<QuickReply[]>("/smartcomm/quick-replies"),
  create: (input: Omit<QuickReplyDraft, "reply_id"> & { variables?: string[] }) =>
    api.post<QuickReply>("/smartcomm/quick-replies", input),
  update: (
    reply_id: string,
    input: Partial<Omit<QuickReplyDraft, "reply_id" | "scope" | "slug">> & {
      variables?: string[];
      is_active?: boolean;
    },
  ) => api.patch<QuickReply>(`/smartcomm/quick-replies/${reply_id}`, input),
  remove: (reply_id: string) =>
    api.delete(`/smartcomm/quick-replies/${reply_id}`),
};

export function QuickRepliesPage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Quick Replies" },
  ]);
  const business = useActiveBusiness();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<QuickReplyDraft | null>(null);

  const { data: replies = [], isLoading } = useQuery({
    queryKey: ["quick-replies", business.key],
    queryFn: () => qrApi.list(),
  });

  const personal = useMemo(() => replies.filter((r) => r.scope === "personal"), [replies]);
  const brand = useMemo(() => replies.filter((r) => r.scope === "brand"), [replies]);

  const save = useMutation({
    mutationFn: async (draft: QuickReplyDraft) => {
      const variables = detectVariables(draft.body);
      if (draft.reply_id) {
        return qrApi.update(draft.reply_id, {
          title: draft.title,
          body: draft.body,
          category: draft.category,
          sort_order: draft.sort_order,
          variables,
        });
      }
      return qrApi.create({
        scope: draft.scope,
        slug: draft.slug,
        title: draft.title,
        body: draft.body,
        category: draft.category,
        sort_order: draft.sort_order,
        variables,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quick-replies", business.key] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => qrApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quick-replies", business.key] });
    },
  });

  return (
    <div className="max-w-[960px]">
      <header className="flex items-start gap-3 mb-5">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <MessageCircle className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-medium">Quick Replies</h2>
          <p className="text-text-muted text-[13px]">
            Slash-command snippets the team taps into the composer. Use{" "}
            <code className="font-mono text-[11px] bg-panel-2 px-1 rounded">
              {`{{first_name}}`}
            </code>{" "}
            to insert variables at send time.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section
          title="Brand shared"
          subtitle="Every member of this brand sees these."
          items={brand}
          isLoading={isLoading}
          onAdd={() => setEditing(empty("brand"))}
          onEdit={(r) => setEditing({ ...r, scope: r.scope })}
          onRemove={(id) => remove.mutate(id)}
          deleting={remove.isPending ? (remove.variables as string) : null}
        />
        <Section
          title="Personal"
          subtitle="Only you see these."
          items={personal}
          isLoading={isLoading}
          onAdd={() => setEditing(empty("personal"))}
          onEdit={(r) => setEditing({ ...r, scope: r.scope })}
          onRemove={(id) => remove.mutate(id)}
          deleting={remove.isPending ? (remove.variables as string) : null}
        />
      </div>

      {editing && (
        <EditorPanel
          draft={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => save.mutate(editing)}
          isPending={save.isPending}
          isError={save.isError}
        />
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  items,
  isLoading,
  onAdd,
  onEdit,
  onRemove,
  deleting,
}: {
  title: string;
  subtitle: string;
  items: QuickReply[];
  isLoading: boolean;
  onAdd: () => void;
  onEdit: (r: QuickReply) => void;
  onRemove: (id: string) => void;
  deleting: string | null;
}) {
  return (
    <div>
      <div className="flex items-end justify-between mb-2">
        <div>
          <h3 className="font-display text-[16px] leading-tight">{title}</h3>
          <p className="text-text-faint text-[11.5px]">{subtitle}</p>
        </div>
        <button
          onClick={onAdd}
          className="rounded-xl bg-panel-2 border hairline px-3 py-1.5 text-[12px] hover:border-accent/40 inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>
      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-12 bg-panel-2 rounded animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="p-5 text-center text-[12.5px] text-text-faint italic">
            No replies yet — create one above.
          </p>
        ) : (
          items.map((r, i) => (
            <button
              key={r.reply_id}
              onClick={() => onEdit(r)}
              className={`w-full text-left p-3 ${
                i !== items.length - 1 ? "border-b hairline" : ""
              } hover:bg-panel-2/60`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-accent-glow text-[12px] shrink-0">
                    /{r.slug}
                  </span>
                  <span className="font-medium text-[13px] truncate">
                    {r.title}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm(
                        `Remove "${r.title}"? This can't be undone.`,
                      )
                    ) {
                      onRemove(r.reply_id);
                    }
                  }}
                  className="text-text-muted hover:text-danger"
                  disabled={deleting === r.reply_id}
                  title="Delete"
                >
                  {deleting === r.reply_id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <p className="text-[12px] text-text-muted truncate mt-0.5">
                {r.body}
              </p>
              {r.variables?.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.variables.map((v) => (
                    <span
                      key={v}
                      className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-widest font-mono text-text-faint bg-panel-2 border hairline rounded-full px-1.5 py-[1px]"
                    >
                      <Hash className="w-2.5 h-2.5" />
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))
        )}
      </Card>
    </div>
  );
}

function EditorPanel({
  draft,
  onChange,
  onCancel,
  onSave,
  isPending,
  isError,
}: {
  draft: QuickReplyDraft;
  onChange: (v: QuickReplyDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  isPending: boolean;
  isError: boolean;
}) {
  const isNew = !draft.reply_id;
  const variables = detectVariables(draft.body);
  const canSave =
    !!draft.title.trim() && !!draft.body.trim() && !!draft.slug.trim();
  return (
    <Modal
      open
      onClose={onCancel}
      title={`${isNew ? "New" : "Edit"} ${draft.scope} quick reply`}
      footer={
        <>
          <button
            onClick={onCancel}
            className="rounded-xl bg-panel-2 border hairline px-4 py-2 text-[13px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!canSave || isPending}
            className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                {isNew ? <Save className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                {isNew ? "Create" : "Save"}
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-3">
          <label className="block">
            <span className="block text-[11.5px] text-text-muted mb-1">
              Slash command
            </span>
            <div className="flex items-center gap-2 rounded-xl bg-panel-2 border hairline px-3 py-2 focus-within:border-accent/40">
              <span className="text-accent-glow font-mono">/</span>
              <input
                value={draft.slug}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    slug: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, ""),
                  })
                }
                disabled={!isNew}
                placeholder="welcome"
                className="bg-transparent flex-1 text-[13.5px] focus:outline-none disabled:opacity-60"
              />
            </div>
            {!isNew && (
              <p className="text-[10.5px] text-text-faint mt-1">
                Slug can&rsquo;t change after creation (it&rsquo;s the trigger).
              </p>
            )}
          </label>
          <label className="block">
            <span className="block text-[11.5px] text-text-muted mb-1">
              Title
            </span>
            <input
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder="Friendly welcome"
              className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
            />
          </label>
          <label className="block">
            <span className="block text-[11.5px] text-text-muted mb-1">
              Body
            </span>
            <textarea
              value={draft.body}
              onChange={(e) => onChange({ ...draft, body: e.target.value })}
              placeholder="Hi {{first_name}} 🌹 Welcome to Pixie Girl! How can we help you today?"
              rows={5}
              className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
            />
            {variables.length > 0 && (
              <p className="text-[11px] text-text-faint mt-1">
                Variables detected:{" "}
                {variables.map((v) => (
                  <code
                    key={v}
                    className="font-mono text-[11px] bg-panel-2 px-1 rounded mr-1"
                  >{`{{${v}}}`}</code>
                ))}
              </p>
            )}
          </label>
          {isError && (
            <p className="text-[12px] text-danger inline-flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Couldn&rsquo;t save. Slug might already exist.
            </p>
          )}
      </div>
    </Modal>
  );
}
