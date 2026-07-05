/**
 * HR Settings → Onboarding editor (meeting §3.7). HR maintains the brand-wide
 * checklist every new hire ticks off, a welcome note, and handy links. Saved
 * through the existing PUT /hr/settings.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Rocket, Plus, Trash2 } from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";
import { updateSettings, type HrSettings } from "@/lib/hr-api";
import { SectionTitle, useNotify, errMsg } from "./hr-shared";

type Item = { key: string; label: string };
type LinkRow = { label: string; url: string };

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "item";

export function OnboardingSettings({ settings }: { settings: HrSettings }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [welcome, setWelcome] = useState("");

  useEffect(() => {
    setItems(Array.isArray(settings.onboarding_checklist) ? settings.onboarding_checklist : []);
    setLinks(Array.isArray(settings.onboarding_links) ? settings.onboarding_links : []);
    setWelcome(settings.onboarding_welcome || "");
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      updateSettings({
        onboarding_checklist: items.filter((i) => i.label.trim()).map((i) => ({ key: i.key || slug(i.label), label: i.label.trim() })),
        onboarding_links: links.filter((l) => l.label.trim() && l.url.trim()),
        onboarding_welcome: welcome.trim() || null,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr", "settings"] }); notify("Onboarding saved"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  const input = "rounded-lg border border-line bg-text-primary/[0.04] p-2 text-sm text-text-primary";

  return (
    <Card className="p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle icon={<Rocket className="h-4 w-4 text-accent-glow" />}>Onboarding pack</SectionTitle>
        <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save onboarding"}
        </Button>
      </div>
      <p className="mb-3 text-xs text-text-muted">
        The checklist, welcome note and links every new hire sees on their My HR “Getting started” card.
        SOPs are pulled automatically from Help Center articles tagged <code>onboarding</code>.
      </p>

      <label className="block text-xs font-medium text-text-muted">
        Welcome note
        <textarea value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={2}
          placeholder="Welcome to the team! Here's how to get set up…"
          className={`mt-1 w-full ${input}`} />
      </label>

      {/* Checklist items */}
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">Checklist items</div>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={it.label}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="e.g. Read the staff handbook"
                className={`flex-1 ${input}`} />
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
        </div>
        <Button size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setItems([...items, { key: "", label: "" }])}>Add item</Button>
      </div>

      {/* Handy links */}
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">Handy links</div>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={l.label}
                onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Label" className={`w-40 ${input}`} />
              <input value={l.url}
                onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                placeholder="https://…" className={`flex-1 ${input}`} />
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setLinks(links.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
        </div>
        <Button size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setLinks([...links, { label: "", url: "" }])}>Add link</Button>
      </div>
    </Card>
  );
}
