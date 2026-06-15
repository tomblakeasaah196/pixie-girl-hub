import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { HelpCircle, BookOpen, MessageCircleQuestion, LifeBuoy } from "lucide-react";
import { Card } from "@/components/ui/primitives";

/**
 * Help Center — new module home (placeholder).
 *
 * Guides, FAQs and contextual help. Content will be DB-driven and
 * editable (mirrors hub-system's help-editor) in its own PR. This is the
 * landing the Settings "Help Center" tile deep-links to.
 */
const PLANNED = [
  { icon: BookOpen, title: "Guides", body: "Step-by-step walkthroughs per module, authored in-app." },
  { icon: MessageCircleQuestion, title: "FAQs", body: "Searchable answers to common questions." },
  { icon: LifeBuoy, title: "Contact Support", body: "Raise a ticket or reach the team directly." },
];

export function HelpCenterPage() {
  useBreadcrumbs([{ label: "Help Center" }]);
  return (
    <div className="max-w-[900px]">
      <div className="flex items-center gap-3 mb-2">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <HelpCircle className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">Help Center</h2>
          <p className="text-text-muted text-[13px]">
            Guides, FAQs and support. DB-driven content & editor land next.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        {PLANNED.map((p) => {
          const Icon = p.icon;
          return (
            <Card key={p.title} className="p-5">
              <Icon className="w-5 h-5 text-accent-glow mb-2" />
              <div className="font-display text-[15px] mb-1">{p.title}</div>
              <p className="text-text-muted text-[12.5px] leading-relaxed">{p.body}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
