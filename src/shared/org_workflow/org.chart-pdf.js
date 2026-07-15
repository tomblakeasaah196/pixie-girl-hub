/**
 * Full organigramme (V2.2 §6.27) — every department's positions rendered as
 * one connected chart and exported to PDF via the shared Puppeteer pipeline.
 *
 * The layout algorithm mirrors `apps/admin/src/components/hub/OrgGraph.tsx`
 * (`buildLayout`) exactly — column = depth in the reporting chain
 * (`reports_to_position_id`), row = sibling order — so the printed chart
 * matches what the operator sees on screen, just spanning every unit instead
 * of one selected department.
 */

"use strict";

const repo = require("./org.repo");
const pdf = require("../../services/pdf.service");
const { audit } = require("../../middleware/audit");
const { formatDate } = require("../../utils/dates");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const brandLabel = (b) =>
  b === "faitlynhair"
    ? "Faitlyn Hair"
    : b === "pixiegirl"
      ? "Pixie Girl Global"
      : "Pixie Girl Hub";

// ── Layout (port of OrgGraph.tsx buildLayout — keep in sync) ──────────────

const NODE_W = 158;
const NODE_H = 88;
const COL_GAP = 46;
const ROW_GAP = 14;
const PAD = 20;

function buildLayout(positions) {
  if (!positions.length) return [];

  const byId = new Map(positions.map((p) => [p.position_id, p]));
  const childrenOf = new Map();
  for (const p of positions) {
    const parentId = p.reports_to_position_id;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(p);
  }
  for (const [, children] of childrenOf) {
    children.sort(
      (a, b) =>
        a.display_order - b.display_order ||
        a.display_name.localeCompare(b.display_name),
    );
  }

  const layout = [];
  const colRowCount = new Map();

  function visit(posId, col) {
    const pos = byId.get(posId);
    if (!pos) return;
    const row = colRowCount.get(col) ?? 0;
    colRowCount.set(col, row + 1);
    layout.push({
      pos,
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

// ── HTML ────────────────────────────────────────────────────────────────

// A3 landscape, matched to the margin/format passed to pdf.renderHtmlToPdf.
const PAGE_W_MM = 420;
const PAGE_H_MM = 297;
const MARGIN_MM = 10;
const PX_PER_MM = 3.7795;
const HEADER_H_PX = 150;

const DEPT_COLORS = [
  "#690909",
  "#8a4b08",
  "#2f6b3f",
  "#1f5f74",
  "#5b3a8a",
  "#8a2f5b",
  "#3a5b8a",
  "#7a7a1f",
  "#0f766e",
  "#9d4edd",
];

function assignDeptColors(units) {
  const map = new Map();
  units.forEach((u, i) => map.set(u.unit_id, DEPT_COLORS[i % DEPT_COLORS.length]));
  return map;
}

function renderChart(layout, colorByUnit) {
  const byId = new Map(layout.map((n) => [n.pos.position_id, n]));
  const maxX = Math.max(...layout.map((n) => n.x)) + NODE_W + PAD;
  const maxY = Math.max(...layout.map((n) => n.y)) + NODE_H + PAD;

  const availW = (PAGE_W_MM - MARGIN_MM * 2) * PX_PER_MM;
  const availH = (PAGE_H_MM - MARGIN_MM * 2) * PX_PER_MM - HEADER_H_PX;
  const scale = Math.min(1, availW / maxX, availH / maxY);

  const lines = [];
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
      deputy: Boolean(node.pos.is_deputy),
    });
  }
  const svgLines = lines
    .map((l) => {
      const midX = l.x1 + (l.x2 - l.x1) / 2;
      return `<polyline points="${l.x1},${l.y1} ${midX},${l.y1} ${midX},${l.y2} ${l.x2},${l.y2}" fill="none" stroke="#690909" stroke-opacity="0.45" stroke-width="1.5"${l.deputy ? ' stroke-dasharray="5 3"' : ""} />`;
    })
    .join("");

  const nodes = layout
    .map(({ pos, x, y }) => {
      const color = colorByUnit.get(pos.unit_id) || DEPT_COLORS[0];
      const tags = [
        pos.is_management ? `<span class="tag mgmt">Mgmt</span>` : "",
        pos.is_deputy ? `<span class="tag deputy">Deputy</span>` : "",
      ].join("");
      return `<div class="node" style="left:${x}px;top:${y}px;width:${NODE_W}px;height:${NODE_H}px;border-left-color:${color}">
        <div class="name">${esc(pos.display_name)}</div>
        <div class="dept">${esc(pos.unit_name || "")}</div>
        <div class="holder">${esc(pos.holder_name || "Vacant")}</div>
        ${tags ? `<div class="tags">${tags}</div>` : ""}
      </div>`;
    })
    .join("");

  return `<div class="stage" style="width:${maxX * scale}px;height:${maxY * scale}px;">
    <div class="scaler" style="width:${maxX}px;height:${maxY}px;transform:scale(${scale});">
      <svg width="${maxX}" height="${maxY}" style="position:absolute;top:0;left:0;overflow:visible;">${svgLines}</svg>
      ${nodes}
    </div>
  </div>`;
}

/** @returns {string} full HTML document for the full-organigramme PDF. */
function chartHtml({ brand, units, positions }) {
  const label = brandLabel(brand);
  const colorByUnit = assignDeptColors(units);
  const layout = buildLayout(positions);
  const unitsWithPositions = units.filter((u) =>
    positions.some((p) => p.unit_id === u.unit_id),
  );

  const legendChips = unitsWithPositions
    .map((u) => {
      const c = colorByUnit.get(u.unit_id);
      return `<span class="chip" style="background:${c}1a;color:${c};border-color:${c}66">${esc(u.display_name)}</span>`;
    })
    .join("");

  const bodyInner =
    layout.length === 0
      ? `<div class="empty">No organisation structure yet.</div>`
      : renderChart(layout, colorByUnit);

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color:#1A1816; }
  .head { border-bottom:2px solid #690909; padding-bottom:10px; margin-bottom:14px; }
  .co { font-family:Arial, sans-serif; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:#690909; }
  .h1 { font-size:22px; font-weight:700; margin-top:2px; }
  .meta { font-family:Arial, sans-serif; font-size:10.5px; color:#666; margin-top:6px; }
  .legend { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
  .chip { font-family:Arial, sans-serif; font-size:9.5px; font-weight:600; padding:2px 9px; border-radius:999px; border:1px solid; }
  .lines-legend { font-family:Arial, sans-serif; font-size:9.5px; color:#777; margin-top:6px; }
  .stage { position:relative; overflow:hidden; }
  .scaler { position:relative; transform-origin: top left; }
  .node { position:absolute; background:#fff; border:1px solid #ddd6cf; border-left-width:4px; border-radius:8px; padding:8px 10px; box-shadow:0 1px 3px rgba(0,0,0,.06); overflow:hidden; }
  .node .name { font-family:Arial, sans-serif; font-size:10.5px; font-weight:700; line-height:1.25; color:#1A1816; }
  .node .dept { font-family:Arial, sans-serif; font-size:8px; color:#999; text-transform:uppercase; letter-spacing:.04em; margin-top:3px; }
  .node .holder { font-family:Arial, sans-serif; font-size:9px; color:#690909; margin-top:4px; }
  .node .tags { margin-top:4px; display:flex; gap:3px; flex-wrap:wrap; }
  .tag { font-family:Arial, sans-serif; font-size:7px; font-weight:700; text-transform:uppercase; padding:1px 5px; border-radius:999px; }
  .tag.mgmt { background:#69090922; color:#690909; }
  .tag.deputy { background:#1f5f7422; color:#1f5f74; }
  .empty { padding:60px 0; text-align:center; font-family:Arial, sans-serif; color:#999; }
  .foot { margin-top:14px; padding-top:8px; border-top:1px solid #E8E4E0; font-family:Arial, sans-serif; font-size:8px; color:#9a9490; }
</style></head>
<body>
  <div class="head">
    <div class="co">${esc(label)}</div>
    <div class="h1">Full Organigramme</div>
    <div class="meta">${unitsWithPositions.length} department${unitsWithPositions.length === 1 ? "" : "s"} · ${positions.length} position${positions.length === 1 ? "" : "s"} · Generated ${formatDate(new Date())}</div>
    <div class="legend">${legendChips}</div>
    <div class="lines-legend">— Solid line = reports to &nbsp;&nbsp; ┄ Dashed line = deputy</div>
  </div>
  ${bodyInner}
  <div class="foot">Generated ${formatDate(new Date())} · Pixie Girl Hub Org &amp; Workflow</div>
</body></html>`;
}

/** Render + store the full-organigramme PDF (all departments, one chart). */
async function exportFullChartPdf({ brand, user, request_id }) {
  const unitsResult = await repo.findAll({
    brand,
    filters: {},
    page: 1,
    page_size: 500,
  });
  const positions = await repo.listPositions({ brand });

  const html = chartHtml({ brand, units: unitsResult.data, positions });
  const stored = await pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html,
    title: `Full Organigramme — ${brandLabel(brand)}`,
    document_type: "org_chart",
    reference_type: "org_chart",
    reference_id: null,
    pdfOptions: { format: "A3", landscape: true },
  });
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    request_id,
    action_key: "org_workflow.export_chart_pdf",
    target_type: "org_units",
    target_id: null,
  });
  return { document_id: stored.document_id, title: stored.title };
}

module.exports = { exportFullChartPdf, chartHtml, buildLayout };
