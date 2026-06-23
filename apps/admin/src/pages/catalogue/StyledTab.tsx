import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Sparkles,
  Package,
  ClipboardCheck,
  Ruler,
  Trash2,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
} from "lucide-react";
import {
  Button,
  Card,
  MoneyText,
  EmptyState,
  Pill,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import {
  useStyledProducts,
  useStockRealtime,
  type StyledProduct,
  type StyledStatus,
} from "@/lib/catalogue";
import {
  Tabs,
  SearchBox,
  AvailabilityPill,
  StyledStatusBadge,
  CardGrid,
  CardGridSkeleton,
} from "./parts";
import { AiDraftModal } from "./AiDraftModal";
import { SizeGuideModal } from "./SizeGuideModal";
import { TrashModal } from "./TrashModal";
import { ImportExportControls } from "@/components/catalogue/ImportExportControls";

/**
 * Styled products — storefront skins over a base. Card grid + status filter;
 * drafts (AI or human) surface here AND in a "Needs review" widget. Live
 * availability reacts to stock changes elsewhere via the stock socket room.
 */
const STATUS_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "live", label: "Live" },
  { key: "archived", label: "Archived" },
];

const VIEW_KEY = "pgh_catalogue_styled_view";
const RETURN_KEY = "pgh_catalogue_return_styled";

export function StyledTab() {
  const nav = useNavigate();
  const { can } = useAuthStore();
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [view, setView] = useState<"thumbnail" | "list">(
    () =>
      (localStorage.getItem(VIEW_KEY) as "thumbnail" | "list") || "thumbnail",
  );
  const setViewPersist = (v: "thumbnail" | "list") => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  // Remembers which card to scroll back to + highlight when we return from
  // a styled product's edit page, so "back" doesn't dump you at the top.
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const openProduct = (id: string) => {
    sessionStorage.setItem(RETURN_KEY, id);
    nav(`/catalogue/styled/${id}`);
  };

  // Keep availability fresh while this tab is mounted.
  useStockRealtime();

  const filters = useMemo(
    () => ({
      status: status === "all" ? undefined : (status as StyledStatus),
      q: q.trim() || undefined,
    }),
    [status, q],
  );
  const styled = useStyledProducts(filters);
  // Separate query (unfiltered drafts) powers the review widget regardless of
  // the active filter.
  const drafts = useStyledProducts({ status: "draft" });

  const canCreate = can("catalogue", "create");
  const pending = drafts.data ?? [];
  const aiPending = pending.filter((s) => s.ai_drafted);

  useEffect(() => {
    const data = styled.data;
    if (!data) return;
    const returnId = sessionStorage.getItem(RETURN_KEY);
    if (!returnId || !data.some((s) => s.styled_id === returnId)) return;
    sessionStorage.removeItem(RETURN_KEY);
    const el = cardRefs.current[returnId];
    if (!el) return;
    el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" });
    setHighlightId(returnId);
    const t = setTimeout(() => setHighlightId(null), 1800);
    return () => clearTimeout(t);
  }, [styled.data]);

  return (
    <div className="space-y-5">
      {/* Review widget — pending drafts to publish (Ops) */}
      {pending.length > 0 && (
        <Card className="p-4 flex items-center gap-4 border-l-[3px]">
          <span className="grid place-items-center w-11 h-11 rounded-[13px] bg-warn/12 text-warn shrink-0">
            <ClipboardCheck className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-display text-[15px]">
              {pending.length} draft{pending.length === 1 ? "" : "s"} awaiting
              review
            </div>
            <div className="text-[12px] text-text-muted">
              {aiPending.length > 0
                ? `${aiPending.length} drafted by AI · review the copy, then publish.`
                : "Review and publish when ready."}
            </div>
          </div>
          <Button size="sm" onClick={() => setStatus("draft")}>
            Review drafts
          </Button>
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Tabs tabs={STATUS_TABS} active={status} onChange={setStatus} />
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="Search styled products…"
        />
        <div className="ml-auto flex gap-2 flex-wrap items-center">
          <div className="flex items-center rounded-[10px] border border-line overflow-hidden">
            <button
              onClick={() => setViewPersist("thumbnail")}
              className={cn(
                "grid place-items-center w-[34px] h-[34px] transition-colors",
                view === "thumbnail"
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              )}
              aria-label="Thumbnail view"
              title="Thumbnail view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewPersist("list")}
              className={cn(
                "grid place-items-center w-[34px] h-[34px] transition-colors",
                view === "list"
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              )}
              aria-label="List view"
              title="List view"
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
          {canCreate && (
            <ImportExportControls
              label="Styled products"
              templatePath="/catalogue/styled-products/import-template"
              exportPath="/catalogue/styled-products/export"
              importPath="/catalogue/styled-products/import"
              onImported={() => styled.refetch()}
            />
          )}
          {can("catalogue", "edit") && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Ruler className="w-3.5 h-3.5" />}
              onClick={() => setSizeOpen(true)}
            >
              Size &amp; guide
            </Button>
          )}
          {can("catalogue", "edit") && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => setTrashOpen(true)}
            >
              Trash
            </Button>
          )}
          {canCreate && (
            <Button
              size="sm"
              icon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={() => setAiOpen(true)}
            >
              Draft with AI
            </Button>
          )}
          {canCreate && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => nav("/catalogue/styled/new")}
            >
              New styled
            </Button>
          )}
        </div>
      </div>

      {/* Grid + states */}
      {styled.isLoading ? (
        <CardGridSkeleton />
      ) : styled.isError ? (
        <ErrorState onRetry={() => styled.refetch()} />
      ) : (styled.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package className="w-8 h-8" />}
            title="No styled products"
            message="Create a storefront skin over a base product, or let AI draft one."
            action={
              canCreate ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => nav("/catalogue/styled/new")}
                >
                  New styled product
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : view === "list" ? (
        <div className="space-y-2">
          {(styled.data ?? []).map((s) => (
            <StyledListRow
              key={s.styled_id}
              s={s}
              onOpen={() => openProduct(s.styled_id)}
              highlighted={highlightId === s.styled_id}
              cardRef={(el) => (cardRefs.current[s.styled_id] = el)}
            />
          ))}
        </div>
      ) : (
        <CardGrid>
          {(styled.data ?? []).map((s) => (
            <StyledCard
              key={s.styled_id}
              s={s}
              onOpen={() => openProduct(s.styled_id)}
              highlighted={highlightId === s.styled_id}
              cardRef={(el) => (cardRefs.current[s.styled_id] = el)}
            />
          ))}
        </CardGrid>
      )}

      <AiDraftModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onDrafted={(d) => {
          setAiOpen(false);
          openProduct(d.styled_id);
        }}
      />
      <SizeGuideModal open={sizeOpen} onClose={() => setSizeOpen(false)} />
      <TrashModal open={trashOpen} onClose={() => setTrashOpen(false)} />
    </div>
  );
}

function StyledCard({
  s,
  onOpen,
  highlighted,
  cardRef,
}: {
  s: StyledProduct;
  onOpen: () => void;
  highlighted?: boolean;
  cardRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={cardRef}
      onClick={onOpen}
      className={cn(
        "text-left glass rounded-[var(--radius)] shadow-glass p-4 transition-all hover:border-accent/40 hover:-translate-y-0.5 focus:outline-none focus:border-accent/50",
        highlighted &&
          "ring-2 ring-accent ring-offset-2 ring-offset-bg shadow-[0_0_0_4px_rgb(var(--accent)/0.18)]",
      )}
    >
      <div className="aspect-[4/3] -mx-4 -mt-4 mb-3 overflow-hidden rounded-t-[var(--radius)] bg-text-primary/[0.04]">
        {s.primary_image_url ? (
          <img
            src={s.primary_image_url}
            alt={s.name}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-text-faint">
            <ImageIcon className="w-7 h-7" />
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-mono text-[10.5px] text-accent-glow">
          {s.styled_code}
        </span>
        <StyledStatusBadge status={s.status} />
      </div>
      <div className="font-display text-[16px] leading-tight mb-1 truncate">
        {s.name}
      </div>
      <div className="text-[11.5px] text-text-faint mb-3 truncate">
        on {s.base_name} · {s.base_product_code}
      </div>
      <div className="flex items-center justify-between gap-2">
        <AvailabilityPill availability={s.availability} />
        {s.effective_price_ngn != null && (
          <MoneyText ngn={s.effective_price_ngn} className="text-[15px]" />
        )}
      </div>
      {s.ai_drafted && (
        <div className="mt-3 pt-3 border-t hairline">
          <Pill tone="accent" dot={false}>
            <Sparkles className="w-3 h-3" /> AI draft
            {s.ai_confidence != null
              ? ` · ${Math.round(s.ai_confidence * 100)}%`
              : ""}
          </Pill>
        </div>
      )}
    </button>
  );
}

function StyledListRow({
  s,
  onOpen,
  highlighted,
  cardRef,
}: {
  s: StyledProduct;
  onOpen: () => void;
  highlighted?: boolean;
  cardRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={cardRef}
      onClick={onOpen}
      className={cn(
        "w-full text-left glass rounded-[var(--radius)] shadow-glass p-3 flex items-center gap-4 transition-all hover:border-accent/40 focus:outline-none focus:border-accent/50",
        highlighted &&
          "ring-2 ring-accent ring-offset-2 ring-offset-bg shadow-[0_0_0_4px_rgb(var(--accent)/0.18)]",
      )}
    >
      <div className="w-16 h-16 shrink-0 overflow-hidden rounded-[10px] bg-text-primary/[0.04]">
        {s.primary_image_url ? (
          <img
            src={s.primary_image_url}
            alt={s.name}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-text-faint">
            <ImageIcon className="w-5 h-5" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-mono text-[10.5px] text-accent-glow">
            {s.styled_code}
          </span>
          <StyledStatusBadge status={s.status} />
          {s.ai_drafted && (
            <Pill tone="accent" dot={false}>
              <Sparkles className="w-3 h-3" /> AI draft
            </Pill>
          )}
        </div>
        {/* Full name, unlike the card grid — this is the point of list view. */}
        <div className="font-display text-[15px] leading-snug">{s.name}</div>
        <div className="text-[11.5px] text-text-faint truncate">
          on {s.base_name} · {s.base_product_code}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <AvailabilityPill availability={s.availability} />
        {s.effective_price_ngn != null && (
          <MoneyText ngn={s.effective_price_ngn} className="text-[14px]" />
        )}
      </div>
    </button>
  );
}
