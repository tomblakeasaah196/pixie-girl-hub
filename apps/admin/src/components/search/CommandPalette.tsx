import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  CornerDownLeft,
  Sparkles,
  Loader2,
  Globe,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import { useBusinessStore } from "@/stores/business";
import {
  MODULES,
  MODULE_BY_KEY,
  GROUP_LABELS,
  type ModuleGroup,
} from "@/lib/modules";
import { usePermittedModuleKeys } from "@/hooks/useModuleAccess";
import {
  search as apiSearch,
  type SearchGroup,
  type SearchHit,
  type ResultType,
} from "@/lib/search-api";
import {
  permittedActions,
  scoreAction,
  type PaletteAction,
} from "@/lib/search-actions";
import {
  permittedTabs,
  scoreTab,
  type ModuleTab,
} from "@/lib/module-tabs";
import { highlight } from "@/lib/search-highlight";
import { PaletteEmpty } from "./PaletteEmpty";

/**
 * Command palette (canon §3.2/§3.4) — hub-wide search & action bar.
 *
 * Modes selected by leading operator:
 *   >   commands only        (theme, brand switch, "new order"…)
 *   #   records only         (contacts, orders, invoices, …)
 *   @   people only          (contacts + employees)
 *   ?   help articles only
 *   !   pages — modules and their tabs (Catalogue › Shades, …)
 *   (none) — everything (records + apps + tabs + top actions + Ask Praxis)
 *
 * Modules, tabs and record groups are all RBAC-gated: a user who can't reach a
 * module never sees the module, its tabs, or its records in the palette.
 *
 * The palette debounces record-search API calls to 200ms and swallows the
 * pending response when a newer keystroke lands (AbortController).
 */

type Row =
  | { kind: "action"; action: PaletteAction }
  | { kind: "record"; hit: SearchHit; groupLabel: string; groupIcon: string }
  | { kind: "app"; label: string; sub: string; route: string; icon: string }
  | { kind: "tab"; tab: ModuleTab }
  | { kind: "praxis"; label: string; query: string };

interface OperatorMode {
  key: "any" | "commands" | "records" | "people" | "help" | "apps";
  prefix: string | null;
}

function parseOperator(raw: string): { mode: OperatorMode; q: string } {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("> ") || trimmed === ">") {
    return { mode: { key: "commands", prefix: ">" }, q: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith("# ") || trimmed === "#") {
    return { mode: { key: "records", prefix: "#" }, q: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith("@ ") || trimmed === "@") {
    return { mode: { key: "people", prefix: "@" }, q: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith("? ") || trimmed === "?") {
    return { mode: { key: "help", prefix: "?" }, q: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith("! ") || trimmed === "!") {
    return { mode: { key: "apps", prefix: "!" }, q: trimmed.slice(1).trim() };
  }
  return { mode: { key: "any", prefix: null }, q: trimmed };
}

/** Which entity types are relevant for a given operator. */
function typesForMode(mode: OperatorMode["key"]): ResultType[] | undefined {
  switch (mode) {
    case "records":
      return [
        "sale_order",
        "invoice",
        "product",
        "stock_variant",
        "crm_deal",
        "sales_campaign",
        "delivery",
        "expense",
        "cash_request",
        "payment",
        "document",
      ];
    case "people":
      return ["contact", "employee"];
    case "help":
      return ["help_article"];
    case "any":
      return undefined; // let backend fan out over everything
    default:
      return undefined;
  }
}

function formatNaira(n: unknown): string | null {
  if (typeof n !== "number") return null;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(n);
}

function Meta({ meta }: { meta: Record<string, unknown> }) {
  const amount =
    formatNaira(meta.amount_ngn) ||
    formatNaira(meta.paid_ngn) ||
    formatNaira(meta.price_ngn);
  const status = typeof meta.status === "string" ? meta.status : null;
  if (!amount && !status) return null;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {amount && (
        <span className="font-mono text-[11px] text-text-primary/80">
          {amount}
        </span>
      )}
      {status && (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-[1px] rounded bg-text-primary/[0.06] text-text-muted">
          {status}
        </span>
      )}
    </div>
  );
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const paletteRecents = useUiStore((s) => s.paletteRecents);
  const paletteRecentQueries = useUiStore((s) => s.paletteRecentQueries);
  const logPaletteVisit = useUiStore((s) => s.logPaletteVisit);
  const logPaletteQuery = useUiStore((s) => s.logPaletteQuery);
  const clearPaletteHistory = useUiStore((s) => s.clearPaletteHistory);

  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const signOut = useAuthStore((s) => s.signOut);
  const activeBrand = useBusinessStore((s) => s.activeKey);
  const setActiveBrand = useBusinessStore((s) => s.setActive);

  const [raw, setRaw] = useState("");
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [remoteGroups, setRemoteGroups] = useState<SearchGroup[]>([]);
  const [crossBrand, setCrossBrand] = useState(false);
  const permitted = usePermittedModuleKeys();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const availableBrands = useMemo(
    () => user?.availableBusinesses ?? [],
    [user?.availableBusinesses],
  );
  const canCrossBrand = (user?.isCeo ?? false) || availableBrands.length > 1;

  useEffect(() => {
    if (open) {
      setRaw("");
      setSel(0);
      setRemoteGroups([]);
      setCrossBrand(false);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const { mode, q } = useMemo(() => parseOperator(raw), [raw]);

  // ── Actions (client-side) ────────────────────────────
  const allowedActions = useMemo(
    () =>
      user
        ? permittedActions(can, availableBrands, activeBrand, theme)
        : [],
    [user, can, availableBrands, activeBrand, theme],
  );
  const matchedActions = useMemo(() => {
    if (mode.key === "records" || mode.key === "help" || mode.key === "people") {
      return [];
    }
    return allowedActions
      .map((a) => ({ a, score: scoreAction(a, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, mode.key === "commands" ? 20 : 6)
      .map(({ a }) => a);
  }, [allowedActions, q, mode.key]);

  // ── Apps (client-side; filters MODULES) ──────────────
  const matchedApps = useMemo(() => {
    if (mode.key === "commands" || mode.key === "people" || mode.key === "help") {
      return [];
    }
    if (mode.key !== "apps" && !q) return [];
    const needle = q.toLowerCase();
    return MODULES.filter((m) => {
      if (m.hidden) return false;
      if (!permitted.has(m.key)) return false; // never surface a locked module
      if (mode.key === "apps" && !needle) return true;
      if (!needle) return false;
      return (
        m.label.toLowerCase().includes(needle) ||
        m.description.toLowerCase().includes(needle) ||
        m.key.toLowerCase().includes(needle)
      );
    }).slice(0, mode.key === "apps" ? 20 : 5);
  }, [q, mode.key, permitted]);

  // ── Module tabs (client-side; RBAC-gated by parent module) ──
  // A tab is never shown unless its module is permitted (same `permitted` set
  // the sidebar uses), plus any per-tab action / CEO gate. Tabs only surface
  // once the user types — they'd flood the empty "!" jump view otherwise.
  const allowedTabs = useMemo(
    () =>
      user ? permittedTabs(permitted, can, user.isCeo ?? false) : [],
    [user, permitted, can],
  );
  const matchedTabs = useMemo(() => {
    if (mode.key === "commands" || mode.key === "people" || mode.key === "help") {
      return [];
    }
    if (!q) return [];
    return allowedTabs
      .map((t) => ({ t, score: scoreTab(t, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, mode.key === "apps" ? 20 : 6)
      .map(({ t }) => t);
  }, [allowedTabs, q, mode.key]);

  // ── Records (server) ─────────────────────────────────
  useEffect(() => {
    if (mode.key === "commands" || mode.key === "apps") {
      setRemoteGroups([]);
      setLoading(false);
      return;
    }
    const trimmed = q.trim();
    if (!trimmed) {
      setRemoteGroups([]);
      setLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      apiSearch(trimmed, {
        types: typesForMode(mode.key),
        limit: 5,
        scope: crossBrand && canCrossBrand ? "all" : "brand",
        signal: ctrl.signal,
      })
        .then((res) => {
          if (ctrl.signal.aborted) return;
          // Guard against an unexpected response shape — never let the palette
          // crash on a malformed / envelope-wrapped payload.
          setRemoteGroups(Array.isArray(res?.groups) ? res.groups : []);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setRemoteGroups([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, mode.key, crossBrand, canCrossBrand]);

  // ── Flatten to Row[] for keyboard nav ────────────────
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const action of matchedActions) {
      out.push({ kind: "action", action });
    }
    for (const app of matchedApps) {
      out.push({
        kind: "app",
        label: app.label,
        sub: `${GROUP_LABELS[app.group as ModuleGroup] ?? app.group} · ${app.description}`,
        route: app.route,
        icon: app.key,
      });
    }
    for (const tab of matchedTabs) {
      out.push({ kind: "tab", tab });
    }
    for (const g of remoteGroups) {
      for (const hit of g.hits) {
        out.push({
          kind: "record",
          hit,
          groupLabel: g.label,
          groupIcon: g.icon,
        });
      }
    }
    // Ask Praxis — always last, only if the user has Praxis access.
    const hasPraxis =
      user?.isCeo || user?.permissions.includes("praxis:view") || can("praxis", "view");
    if (q.trim() && hasPraxis && mode.key !== "commands") {
      out.push({ kind: "praxis", label: `Ask Praxis: “${q.trim()}”`, query: q.trim() });
    }
    return out;
  }, [matchedActions, matchedApps, matchedTabs, remoteGroups, q, user, can, mode.key]);

  useEffect(() => {
    // Reset selection when the row set changes so highlight doesn't dangle.
    setSel(0);
  }, [rows.length]);

  function activate(i: number) {
    const r = rows[i];
    if (!r) return;
    if (r.kind === "action") {
      r.action.run({
        navigate,
        close: () => setOpen(false),
        toggleTheme,
        switchBrand: setActiveBrand,
        signOut,
        availableBrands,
      });
      return;
    }
    if (r.kind === "app") {
      setOpen(false);
      navigate(r.route);
      return;
    }
    if (r.kind === "tab") {
      setOpen(false);
      navigate(r.tab.route);
      return;
    }
    if (r.kind === "record") {
      setOpen(false);
      logPaletteVisit({
        id: r.hit.id,
        type: r.hit.type,
        title: r.hit.title,
        subtitle: r.hit.subtitle,
        route: r.hit.route,
      });
      logPaletteQuery(q);
      navigate(r.hit.route);
      return;
    }
    if (r.kind === "praxis") {
      setOpen(false);
      logPaletteQuery(q);
      navigate(`/praxis?q=${encodeURIComponent(r.query)}`);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, rows.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        activate(sel);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, rows, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const showEmptyState = raw.trim() === "";

  return (
    <>
      <div
        className="fixed inset-0 z-[91] bg-black/50 backdrop-blur-[3px] animate-fade-in"
        onClick={() => setOpen(false)}
      />
      <div className="fixed top-[8vh] max-md:top-0 left-1/2 -translate-x-1/2 w-[min(620px,96vw)] max-md:w-full max-md:h-full max-md:top-0 max-h-[80vh] max-md:max-h-full z-[92] rounded-[18px] max-md:rounded-none overflow-hidden flex flex-col dropglass animate-fade-in">
        <div className="flex items-center gap-3 p-[14px_18px] border-b hairline">
          {loading ? (
            <Loader2 className="w-[18px] h-[18px] text-text-faint animate-spin shrink-0" />
          ) : (
            <Search className="w-[18px] h-[18px] text-text-faint shrink-0" />
          )}
          {mode.prefix && (
            <span className="font-mono text-[12px] px-1.5 py-0.5 rounded bg-accent/10 text-accent-glow shrink-0">
              {mode.prefix}
            </span>
          )}
          <input
            ref={inputRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={
              mode.key === "commands"
                ? "Run a command…"
                : mode.key === "records"
                  ? "Search records…"
                  : mode.key === "people"
                    ? "Find a person…"
                    : mode.key === "help"
                      ? "Search help articles…"
                      : mode.key === "apps"
                        ? "Jump to a page…"
                        : "Search anything — records, actions, help…"
            }
            className="flex-1 bg-transparent border-0 outline-none text-base text-text-primary min-w-0" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
          {canCrossBrand && (
            <button
              onClick={() => setCrossBrand((v) => !v)}
              title={
                crossBrand
                  ? "Searching all your brands"
                  : "Search across all your brands"
              }
              className={cn(
                "flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-[7px] border transition-colors shrink-0",
                crossBrand
                  ? "border-accent/40 bg-accent/10 text-accent-glow"
                  : "border-line text-text-faint hover:text-text-muted",
              )}
            >
              <Globe className="w-3 h-3" />
              {crossBrand ? "All brands" : activeBrand}
            </button>
          )}
          {raw && (
            <button
              onClick={() => setRaw("")}
              className="text-text-faint hover:text-text-muted shrink-0"
              aria-label="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="font-mono text-[10px] text-text-faint hidden sm:inline">
            esc
          </kbd>
        </div>

        <div className="overflow-y-auto flex-1">
          {showEmptyState ? (
            <PaletteEmpty
              recents={paletteRecents}
              recentQueries={paletteRecentQueries}
              onQuery={(v) => setRaw(v)}
              onClearHistory={clearPaletteHistory}
              onGo={(route, item) => {
                setOpen(false);
                logPaletteVisit(item);
                navigate(route);
              }}
            />
          ) : rows.length === 0 && !loading ? (
            <div className="p-8 text-center text-text-faint">
              <p className="text-[13px]">No matches for “{q}”.</p>
              <p className="text-[11px] mt-1 opacity-70">
                Try a shorter word, or press{" "}
                <kbd className="font-mono bg-text-primary/5 border border-line rounded px-1.5">
                  ↵
                </kbd>{" "}
                to Ask Praxis.
              </p>
            </div>
          ) : (
            <div className="p-2">
              {rows.map((r, i) => {
                const isActive = sel === i;
                return (
                  <Row
                    key={rowKey(r, i)}
                    row={r}
                    q={q}
                    isActive={isActive}
                    onEnter={() => setSel(i)}
                    onActivate={() => activate(i)}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t hairline px-3 py-2 flex items-center justify-between text-[10.5px] text-text-faint">
          <div className="flex items-center gap-2">
            <span>
              <kbd className="font-mono bg-text-primary/5 border border-line rounded px-1">
                ↑↓
              </kbd>{" "}
              navigate
            </span>
            <span className="hidden sm:inline">
              <kbd className="font-mono bg-text-primary/5 border border-line rounded px-1">
                ↵
              </kbd>{" "}
              select
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            <kbd className="font-mono bg-text-primary/5 border border-line rounded px-1">
              &gt;
            </kbd>
            <kbd className="font-mono bg-text-primary/5 border border-line rounded px-1">
              #
            </kbd>
            <kbd className="font-mono bg-text-primary/5 border border-line rounded px-1">
              @
            </kbd>
            <kbd className="font-mono bg-text-primary/5 border border-line rounded px-1">
              ?
            </kbd>
            <kbd className="font-mono bg-text-primary/5 border border-line rounded px-1">
              !
            </kbd>
            <span>operators</span>
          </div>
        </div>
      </div>
    </>
  );
}

function rowKey(r: Row, i: number) {
  if (r.kind === "action") return `a:${r.action.key}`;
  if (r.kind === "app") return `p:${r.route}`;
  if (r.kind === "tab") return `t:${r.tab.route}`;
  if (r.kind === "record") return `r:${r.hit.type}:${r.hit.id}`;
  return `x:${i}`;
}

// ── Row ──────────────────────────────────────────────────
interface RowProps {
  row: Row;
  q: string;
  isActive: boolean;
  onEnter: () => void;
  onActivate: () => void;
}

function Row({ row, q, isActive, onEnter, onActivate }: RowProps) {
  const commonCls = cn(
    "flex items-center gap-3 p-[10px_12px] rounded-[11px] cursor-pointer",
    isActive && "bg-accent/10",
  );
  if (row.kind === "action") {
    const Icon = row.action.icon;
    return (
      <div
        onMouseEnter={onEnter}
        onClick={onActivate}
        className={commonCls}
        role="option"
        aria-selected={isActive}
      >
        <span className="w-8 h-8 rounded-[9px] grid place-items-center text-accent-glow bg-accent/10 shrink-0">
          <Icon className="w-[17px] h-[17px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[13.5px] truncate">
            {highlight(row.action.label, q)}
          </span>
          <span className="block text-[11px] text-text-faint truncate">
            {row.action.section}
            {row.action.hint ? ` · ${row.action.hint}` : ""}
          </span>
        </span>
        {isActive && (
          <CornerDownLeft className="w-3.5 h-3.5 text-text-faint shrink-0" />
        )}
      </div>
    );
  }
  if (row.kind === "app") {
    return (
      <div
        onMouseEnter={onEnter}
        onClick={onActivate}
        className={commonCls}
        role="option"
        aria-selected={isActive}
      >
        <span className="w-8 h-8 rounded-[9px] grid place-items-center text-accent-glow bg-accent/10 shrink-0 text-[15px]">
          •
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[13.5px] truncate">
            {highlight(row.label, q)}
          </span>
          <span className="block text-[11px] text-text-faint truncate">
            {row.sub}
          </span>
        </span>
        {isActive && (
          <CornerDownLeft className="w-3.5 h-3.5 text-text-faint shrink-0" />
        )}
      </div>
    );
  }
  if (row.kind === "tab") {
    const mod = MODULE_BY_KEY[row.tab.moduleKey];
    const Icon = mod?.icon;
    return (
      <div
        onMouseEnter={onEnter}
        onClick={onActivate}
        className={commonCls}
        role="option"
        aria-selected={isActive}
      >
        <span className="w-8 h-8 rounded-[9px] grid place-items-center text-accent-glow bg-accent/10 shrink-0">
          {Icon ? (
            <Icon className="w-[16px] h-[16px]" />
          ) : (
            <span className="text-[15px]">•</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[13.5px] truncate">
            <span className="text-text-muted">{mod?.label ?? row.tab.moduleKey}</span>
            <span className="text-text-faint px-1">›</span>
            {highlight(row.tab.label, q)}
          </span>
          <span className="block text-[11px] text-text-faint truncate">
            {mod ? `${GROUP_LABELS[mod.group as ModuleGroup]} · ` : ""}Tab
          </span>
        </span>
        {isActive && (
          <CornerDownLeft className="w-3.5 h-3.5 text-text-faint shrink-0" />
        )}
      </div>
    );
  }
  if (row.kind === "record") {
    return (
      <div
        onMouseEnter={onEnter}
        onClick={onActivate}
        className={commonCls}
        role="option"
        aria-selected={isActive}
      >
        <span className="w-8 h-8 rounded-[9px] grid place-items-center text-accent-glow bg-accent/10 shrink-0 text-[10.5px] font-semibold uppercase">
          {row.groupLabel.slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[13.5px] truncate">
            {highlight(row.hit.title, q)}
          </span>
          <span className="block text-[11px] text-text-faint truncate">
            {row.groupLabel} · {row.hit.subtitle}
            {row.hit.brand ? ` · ${row.hit.brand}` : ""}
          </span>
        </span>
        <Meta meta={row.hit.meta} />
        {isActive && (
          <CornerDownLeft className="w-3.5 h-3.5 text-text-faint shrink-0 ml-2" />
        )}
      </div>
    );
  }
  return (
    <div
      onMouseEnter={onEnter}
      onClick={onActivate}
      className={commonCls}
      role="option"
      aria-selected={isActive}
    >
      <span className="w-8 h-8 rounded-[9px] grid place-items-center bg-accent/15 text-accent-glow shrink-0">
        <Sparkles className="w-[17px] h-[17px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[13.5px] truncate">
          {row.label}
        </span>
        <span className="block text-[11px] text-text-faint">
          Ask Praxis to answer this
        </span>
      </span>
      {isActive && (
        <CornerDownLeft className="w-3.5 h-3.5 text-text-faint shrink-0" />
      )}
    </div>
  );
}
