import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { OrgPosition } from "@/lib/org-api";

/**
 * OrgGraph — pure CSS/SVG hierarchical org chart.
 *
 * Renders org_positions as glass nodes connected by SVG lines.
 * Layout: column per depth level derived from reports_to_position_id.
 * Solid lines = reporting chain. Dashed lines = deputy relationship.
 * No external graph library — 0 extra kb, matches glassmorphism canon.
 * Mobile (<768px): falls back to an indented tree list.
 */

interface Props {
  positions: OrgPosition[];
  onSelectPosition?: (pos: OrgPosition) => void;
  selectedId?: string | null;
}

const NODE_W = 192;
const NODE_H = 90;
const COL_GAP = 80;
const ROW_GAP = 20;
const PAD = 32;

interface LayoutNode {
  pos: OrgPosition;
  col: number;
  row: number;
  x: number;
  y: number;
}

function buildLayout(positions: OrgPosition[]): LayoutNode[] {
  if (positions.length === 0) return [];

  const byId = new Map(positions.map((p) => [p.position_id, p]));
  const childrenOf = new Map<string | null, OrgPosition[]>();
  for (const p of positions) {
    const parentId = p.reports_to_position_id;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId)!.push(p);
  }

  // Sort children within each parent by display_order, then name
  for (const [, children] of childrenOf) {
    children.sort(
      (a, b) =>
        a.display_order - b.display_order ||
        a.display_name.localeCompare(b.display_name),
    );
  }

  const layout: LayoutNode[] = [];
  const colRowCount = new Map<number, number>();

  function visit(posId: string, col: number) {
    const pos = byId.get(posId);
    if (!pos) return;
    const row = colRowCount.get(col) ?? 0;
    colRowCount.set(col, row + 1);
    layout.push({
      pos,
      col,
      row,
      x: PAD + col * (NODE_W + COL_GAP),
      y: PAD + row * (NODE_H + ROW_GAP),
    });
    const children = childrenOf.get(posId) ?? [];
    for (const child of children) visit(child.position_id, col + 1);
  }

  const roots = positions.filter((p) => {
    const parent = p.reports_to_position_id;
    return !parent || !byId.has(parent);
  });
  roots.sort(
    (a, b) =>
      a.display_order - b.display_order ||
      a.display_name.localeCompare(b.display_name),
  );
  for (const root of roots) visit(root.position_id, 0);

  return layout;
}

function formatNgn(n: number): string {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}k`;
  return `₦${n}`;
}

// ── Desktop: SVG + absolute-positioned nodes ──────────────────────────────

function GraphDesktop({ positions, onSelectPosition, selectedId }: Props) {
  const layout = useMemo(() => buildLayout(positions), [positions]);
  const byId = useMemo(
    () => new Map(layout.map((n) => [n.pos.position_id, n])),
    [layout],
  );

  if (layout.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[rgb(var(--text-faint))] text-sm">
        No positions in this department yet.
      </div>
    );
  }

  const maxX = Math.max(...layout.map((n) => n.x)) + NODE_W + PAD;
  const maxY = Math.max(...layout.map((n) => n.y)) + NODE_H + PAD;

  // Build connector lines
  const lines: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    deputy: boolean;
  }> = [];
  for (const node of layout) {
    const parentId = node.pos.reports_to_position_id;
    if (!parentId) continue;
    const parent = byId.get(parentId);
    if (!parent) continue;
    lines.push({
      x1: parent.x + NODE_W,
      y1: parent.y + NODE_H / 2,
      x2: node.x,
      y2: node.y + NODE_H / 2,
      deputy: node.pos.is_deputy,
    });
  }

  return (
    <div className="overflow-auto" style={{ minHeight: 200 }}>
      <div className="relative" style={{ width: maxX, height: maxY }}>
        {/* SVG connector layer */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={maxX}
          height={maxY}
          style={{ overflow: "visible" }}
        >
          {lines.map((l, i) => (
            <g key={i}>
              {/* Elbow: horizontal then vertical then horizontal */}
              <polyline
                points={`${l.x1},${l.y1} ${l.x1 + (l.x2 - l.x1) / 2},${l.y1} ${l.x1 + (l.x2 - l.x1) / 2},${l.y2} ${l.x2},${l.y2}`}
                fill="none"
                stroke="rgb(var(--accent))"
                strokeOpacity={0.4}
                strokeWidth={1.5}
                strokeDasharray={l.deputy ? "5 3" : undefined}
              />
            </g>
          ))}
        </svg>

        {/* Nodes */}
        {layout.map(({ pos, x, y }) => {
          const selected = selectedId === pos.position_id;
          return (
            <div
              key={pos.position_id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectPosition?.(pos)}
              onKeyDown={(e) => e.key === "Enter" && onSelectPosition?.(pos)}
              style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
              className={cn(
                "absolute cursor-pointer transition-all duration-200",
                "backdrop-blur-[22px] saturate-150",
                "bg-[rgb(var(--panel-2)/0.75)] border rounded-[13px] p-3",
                "hover:shadow-[0_4px_24px_rgb(var(--accent)/0.15)]",
                selected
                  ? "border-[rgb(var(--accent)/0.6)] ring-1 ring-[rgb(var(--accent)/0.4)] shadow-[0_4px_24px_rgb(var(--accent)/0.2)]"
                  : "border-[rgb(var(--border-c))]",
              )}
            >
              <div className="font-sans text-[12.5px] font-semibold leading-tight line-clamp-2 mb-1">
                {pos.display_name}
              </div>
              <div className="font-mono text-[9.5px] text-[rgb(var(--text-faint))] truncate mb-1.5">
                {pos.position_key}
              </div>
              <div className="flex flex-wrap gap-1">
                {pos.is_management && (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[rgb(var(--accent)/0.15)] text-[rgb(var(--accent-glow))]">
                    Mgmt
                  </span>
                )}
                {pos.is_deputy && (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[rgb(var(--info)/0.15)] text-[rgb(var(--info))]">
                    Deputy
                  </span>
                )}
                {pos.approval_threshold_ngn != null && (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[rgb(var(--success)/0.15)] text-[rgb(var(--success))]">
                    ≤{formatNgn(pos.approval_threshold_ngn)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mobile: indented tree list ─────────────────────────────────────────────

function TreeNode({
  pos,
  depth,
  positions,
  onSelectPosition,
  selectedId,
}: {
  pos: OrgPosition;
  depth: number;
  positions: OrgPosition[];
  onSelectPosition?: (p: OrgPosition) => void;
  selectedId?: string | null;
}) {
  const children = positions.filter(
    (p) => p.reports_to_position_id === pos.position_id,
  );
  const selected = selectedId === pos.position_id;

  return (
    <li>
      <button
        onClick={() => onSelectPosition?.(pos)}
        style={{ paddingLeft: depth * 16 + 12 }}
        className={cn(
          "w-full text-left py-2.5 pr-3 rounded-[10px] transition-colors",
          selected
            ? "bg-[rgb(var(--accent)/0.12)] text-[rgb(var(--accent-glow))]"
            : "hover:bg-[rgb(var(--text)/0.04)]",
        )}
      >
        <div className="text-[13px] font-semibold">{pos.display_name}</div>
        <div className="text-[10px] text-[rgb(var(--text-faint))] font-mono">
          {pos.position_key}
        </div>
      </button>
      {children.length > 0 && (
        <ul className="space-y-0.5">
          {children.map((c) => (
            <TreeNode
              key={c.position_id}
              pos={c}
              depth={depth + 1}
              positions={positions}
              onSelectPosition={onSelectPosition}
              selectedId={selectedId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function GraphMobile({ positions, onSelectPosition, selectedId }: Props) {
  const roots = positions.filter((p) => {
    const parentId = p.reports_to_position_id;
    return !parentId || !positions.some((q) => q.position_id === parentId);
  });

  if (roots.length === 0 && positions.length > 0) {
    // Fallback: flat list
    return (
      <ul className="space-y-1">
        {positions.map((p) => (
          <TreeNode
            key={p.position_id}
            pos={p}
            depth={0}
            positions={positions}
            onSelectPosition={onSelectPosition}
            selectedId={selectedId}
          />
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-1">
      {roots.map((p) => (
        <TreeNode
          key={p.position_id}
          pos={p}
          depth={0}
          positions={positions}
          onSelectPosition={onSelectPosition}
          selectedId={selectedId}
        />
      ))}
    </ul>
  );
}

// ── Public export ──────────────────────────────────────────────────────────

export function OrgGraph(props: Props) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  return isMobile ? <GraphMobile {...props} /> : <GraphDesktop {...props} />;
}
