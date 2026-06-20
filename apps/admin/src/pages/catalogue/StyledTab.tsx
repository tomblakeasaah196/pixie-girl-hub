import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Sparkles,
  Package,
  ClipboardCheck,
  Ruler,
  Trash2,
  Image as ImageIcon,
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

export function StyledTab() {
  const nav = useNavigate();
  const { can } = useAuthStore();
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

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
        <div className="ml-auto flex gap-2">
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
      ) : (
        <CardGrid>
          {(styled.data ?? []).map((s) => (
            <StyledCard
              key={s.styled_id}
              s={s}
              onOpen={() => nav(`/catalogue/styled/${s.styled_id}`)}
            />
          ))}
        </CardGrid>
      )}

      <AiDraftModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onDrafted={(d) => {
          setAiOpen(false);
          nav(`/catalogue/styled/${d.styled_id}`);
        }}
      />
      <SizeGuideModal open={sizeOpen} onClose={() => setSizeOpen(false)} />
      <TrashModal open={trashOpen} onClose={() => setTrashOpen(false)} />
    </div>
  );
}

function StyledCard({ s, onOpen }: { s: StyledProduct; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="text-left glass rounded-[var(--radius)] shadow-glass p-4 transition-all hover:border-accent/40 hover:-translate-y-0.5 focus:outline-none focus:border-accent/50"
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
