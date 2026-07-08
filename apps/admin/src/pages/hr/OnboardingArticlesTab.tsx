/**
 * HR & Staff → Onboarding tab. Lets HR pick which Help Center articles show
 * on every new hire's My HR "Getting started" card, and in what order.
 * Saved through the existing PUT /hr/settings. An empty selection falls back
 * to the legacy behaviour (any active article tagged `onboarding`).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, GripVertical, X, BookOpen } from "lucide-react";
import { Card, Button, Skeleton } from "@/components/ui/primitives";
import { helpApi, type HelpArticleSummary } from "@/lib/help-api";
import { getSettings, updateSettings } from "@/lib/hr-api";
import { SectionTitle, useNotify, errMsg } from "./hr-shared";

export function OnboardingArticlesTab() {
  const qc = useQueryClient();
  const notify = useNotify("HR → Staff: onboarding articles");
  const [q, setQ] = useState("");
  // null until the HR admin makes a change locally — lets settings refetch
  // (e.g. after another tab's save) without clobbering an in-progress edit.
  const [selected, setSelected] = useState<string[] | null>(null);

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["hr", "settings"],
    queryFn: getSettings,
  });
  const { data: articles, isLoading: articlesLoading } = useQuery({
    queryKey: ["help", "articles", q],
    queryFn: () => helpApi.listArticles({ q: q || undefined, limit: 100 }),
  });

  const current = selected ?? settings?.onboarding_help_article_ids ?? [];

  const byId = useMemo(() => {
    const m = new Map<string, HelpArticleSummary>();
    for (const a of articles || []) m.set(a.article_id, a);
    return m;
  }, [articles]);

  const save = useMutation({
    mutationFn: () => updateSettings({ onboarding_help_article_ids: current }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "settings"] });
      notify("Onboarding articles saved");
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  function toggle(id: string) {
    setSelected(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }
  function move(id: string, dir: -1 | 1) {
    const i = current.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= current.length) return;
    const next = [...current];
    [next[i], next[j]] = [next[j], next[i]];
    setSelected(next);
  }
  function remove(id: string) {
    setSelected(current.filter((x) => x !== id));
  }

  if (settingsLoading) return <Skeleton className="h-64 rounded-[var(--radius)]" />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle icon={<BookOpen className="h-4 w-4 text-accent-glow" />}>
            Selected (shown in this order)
          </SectionTitle>
          <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="mb-3 text-xs text-text-muted">
          Every new hire sees these on their My HR &ldquo;Getting started&rdquo; card, in this order.
          Leave empty to fall back to any Help Center article tagged <code>onboarding</code>.
        </p>
        {current.length ? (
          <div className="space-y-1.5">
            {current.map((id, i) => {
              const a = byId.get(id);
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-text-primary/[0.02] px-3 py-2"
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                    {a ? a.title : id}
                  </span>
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(id, -1)}>
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === current.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    ↓
                  </Button>
                  <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => remove(id)}>
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-text-muted">No articles picked yet — using the automatic tag-based list.</p>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={<Search className="h-4 w-4 text-accent-glow" />}>Help Center articles</SectionTitle>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search articles…"
          className="mb-3 w-full rounded-lg border border-line bg-text-primary/[0.04] p-2 text-sm text-text-primary"
          autoComplete="off"
        />
        {articlesLoading ? (
          <Skeleton className="h-40 rounded-[var(--radius)]" />
        ) : (
          <div className="max-h-[28rem] space-y-1 overflow-y-auto">
            {(articles || []).map((a) => (
              <label
                key={a.article_id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-text-primary/[0.03]"
              >
                <input
                  type="checkbox"
                  checked={current.includes(a.article_id)}
                  onChange={() => toggle(a.article_id)}
                />
                <span className="min-w-0 flex-1 truncate text-text-primary">{a.title}</span>
                {a.category_name && (
                  <span className="shrink-0 text-xs text-text-faint">{a.category_name}</span>
                )}
              </label>
            ))}
            {!articles?.length && <p className="text-sm text-text-muted">No articles found.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
