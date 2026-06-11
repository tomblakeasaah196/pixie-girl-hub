/**
 * Dashboards (V2.2 §6.20) — business logic.
 *
 * Role-based KPI dashboards. The overview composes the live spine (sales +
 * ops aggregates) with the AI Insights open-counts (the cross-module
 * connection) and the latest AI briefing. Briefings are produced by the AI
 * layer; here they are read + marked read.
 */

"use strict";

const repo = require("./dashboards.repo");
const insights = require("../ai_insights/insights.service");
const { NotFoundError } = require("../../utils/errors");

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function overview({ brand, user, from, to }) {
  const range = {
    from: from || defaultRange().from,
    to: to || defaultRange().to,
  };
  const [sales, ops, insightCounts, briefings] = await Promise.all([
    repo.salesKpis({ brand, from: range.from, to: range.to }),
    repo.opsKpis({ brand }),
    insights.summary({ brand }),
    repo.listBriefings({ brand, recipient_user_id: user.user_id, limit: 1 }),
  ]);
  return {
    period: range,
    sales,
    operations: ops,
    insights: insightCounts,
    latest_briefing: briefings[0] || null,
  };
}

function salesKpis({ brand, from, to }) {
  return repo.salesKpis({ brand, from, to });
}
function opsKpis({ brand }) {
  return repo.opsKpis({ brand });
}
function listBriefings({ brand, user }) {
  return repo.listBriefings({ brand, recipient_user_id: user.user_id });
}
async function getBriefing({ id }) {
  const b = await repo.getBriefing({ id });
  if (!b) throw new NotFoundError("Briefing");
  return b;
}
async function markBriefingRead({ id }) {
  const b = await repo.markBriefingRead({ id });
  if (!b) throw new NotFoundError("Briefing");
  return b;
}

module.exports = {
  overview,
  salesKpis,
  opsKpis,
  listBriefings,
  getBriefing,
  markBriefingRead,
};
