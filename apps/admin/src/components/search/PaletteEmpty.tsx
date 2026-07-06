/**
 * Palette empty-state: what the user sees when they open ⌘K but haven't typed
 * anything yet. Two blocks:
 *   1. Recent — records they visited from the palette (local, this device).
 *   2. Suggested — freshest server-side records their permissions cover.
 *
 * If both are empty we fall back to the hint row. The list is short by design;
 * the palette shouldn't feel like a dashboard.
 */

import { useEffect, useState } from "react";
import { Clock, Sparkles, X } from "lucide-react";
import type { PaletteRecent } from "@/stores/ui";
import type { Suggestions } from "@/lib/search-api";
import { suggestions as fetchSuggestions } from "@/lib/search-api";

const CATEGORY_ICON: Record<string, string> = {
  sale_order: "🛍",
  invoice: "🧾",
  contact: "👤",
  product: "📦",
  crm_deal: "💼",
  employee: "👥",
  delivery: "🚚",
  expense: "🧾",
  cash_request: "💸",
  sales_campaign: "📣",
  document: "📁",
  help_article: "❓",
  payment: "💳",
  stock_variant: "📦",
  smartcomm_thread: "💬",
};

interface RowProps {
  title: string;
  subtitle: string;
  route: string;
  type: string;
  onGo: (route: string, item: { id: string; type: string; title: string; subtitle: string; route: string }) => void;
  id: string;
}

function EmptyRow({ title, subtitle, route, type, onGo, id }: RowProps) {
  return (
    <button
      onClick={() => onGo(route, { id, type, title, subtitle, route })}
      className="w-full flex items-center gap-3 p-[8px_12px] rounded-[9px] text-left hover:bg-accent/5 transition-colors"
    >
      <span className="w-7 h-7 grid place-items-center rounded-[7px] bg-accent/10 text-[13px]">
        {CATEGORY_ICON[type] || "•"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-text-primary truncate">
          {title}
        </span>
        {subtitle && (
          <span className="block text-[10.5px] text-text-faint truncate">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}

interface Props {
  recents: PaletteRecent[];
  onGo: (route: string, item: { id: string; type: string; title: string; subtitle: string; route: string }) => void;
  recentQueries: string[];
  onQuery: (q: string) => void;
  onClearHistory: () => void;
}

export function PaletteEmpty({
  recents,
  onGo,
  recentQueries,
  onQuery,
  onClearHistory,
}: Props) {
  const [suggested, setSuggested] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSuggestions()
      .then((s) => {
        if (!cancelled) setSuggested(s);
      })
      .catch(() => {
        // Non-fatal: the palette still works without server suggestions.
        if (!cancelled) setSuggested({ orders: [], contacts: [], invoices: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestedFlat = suggested
    ? [
        ...suggested.orders.slice(0, 2),
        ...suggested.contacts.slice(0, 2),
        ...suggested.invoices.slice(0, 2),
      ]
    : [];

  const hasAny = recents.length + recentQueries.length + suggestedFlat.length;

  if (!hasAny && !loading) {
    return (
      <div className="p-8 text-center">
        <p className="text-[12px] text-text-faint">
          Start typing to search records, run commands, or ask Praxis.
        </p>
        <div className="mt-3 flex items-center justify-center gap-2 text-[10.5px] text-text-faint/70">
          <kbd className="font-mono px-1.5 py-0.5 rounded bg-text-primary/5 border border-line">
            &gt;
          </kbd>
          commands
          <kbd className="font-mono px-1.5 py-0.5 rounded bg-text-primary/5 border border-line ml-2">
            #
          </kbd>
          records
          <kbd className="font-mono px-1.5 py-0.5 rounded bg-text-primary/5 border border-line ml-2">
            @
          </kbd>
          people
          <kbd className="font-mono px-1.5 py-0.5 rounded bg-text-primary/5 border border-line ml-2">
            ?
          </kbd>
          help
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-4">
      {recentQueries.length > 0 && (
        <section>
          <div className="flex items-center justify-between px-2 pb-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-faint">
              <Clock className="w-3 h-3" /> Recent queries
            </div>
            <button
              onClick={onClearHistory}
              className="text-[10px] text-text-faint hover:text-text-muted flex items-center gap-1"
              title="Clear palette history"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 px-2">
            {recentQueries.map((q) => (
              <button
                key={q}
                onClick={() => onQuery(q)}
                className="text-[11.5px] px-2.5 py-1 rounded-full bg-text-primary/[0.04] border border-line hover:border-accent/40 hover:text-accent-glow transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      )}

      {recents.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-faint">
            <Clock className="w-3 h-3" /> Recent
          </div>
          {recents.slice(0, 5).map((r) => (
            <EmptyRow
              key={`${r.type}-${r.id}`}
              id={r.id}
              type={r.type}
              title={r.title}
              subtitle={r.subtitle}
              route={r.route}
              onGo={onGo}
            />
          ))}
        </section>
      )}

      {suggestedFlat.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-faint">
            <Sparkles className="w-3 h-3" /> Suggested
          </div>
          {suggestedFlat.map((s) => (
            <EmptyRow
              key={`${s.type}-${s.id}`}
              id={s.id}
              type={s.type}
              title={s.title}
              subtitle={s.subtitle}
              route={s.route}
              onGo={onGo}
            />
          ))}
        </section>
      )}
    </div>
  );
}
