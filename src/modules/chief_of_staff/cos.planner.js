/**
 * Chief of Staff (PR3) — planner.
 *
 * Post-processes the model's multi-tool output for one turn into a BATCH PLAN:
 * one ai_pending_plans row + ordered ai_pending_actions (plan_step). The CEO
 * approves the whole plan once; the plan executor then runs the steps in order.
 *
 * Cross-step references use the token syntax `{{step:N.field}}` inside a step's
 * payload — e.g. a milestone step sets `id` to `{{step:0.goal_id}}` to point at
 * the goal created in step 0. Tokens are stored verbatim and resolved at
 * execution time (resolveTokens) from prior steps' execution_result.
 */

"use strict";

const repo = require("./cos.repo");
const { AppError } = require("../../utils/errors");

// {{step:0.goal_id}} / {{ step:12.data.event_id }}
const TOKEN_RE = /\{\{\s*step:(\d+)\.([a-zA-Z0-9_.]+)\s*\}\}/g;
const FULL_TOKEN_RE = /^\{\{\s*step:(\d+)\.([a-zA-Z0-9_.]+)\s*\}\}$/;

/** Walk a dotted path against the raw result AND its `{data:…}` envelope. */
function pickField(result, path) {
  if (result === null || result === undefined) return undefined;
  const roots = [result, result.data];
  const segments = String(path).split(".");
  for (const root of roots) {
    let cur = root;
    let ok = cur !== null && cur !== undefined;
    for (const seg of segments) {
      if (cur !== null && typeof cur === "object" && seg in cur) {
        cur = cur[seg];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

/**
 * Resolve `{{step:N.field}}` tokens in a payload against prior step results.
 * Pure — returns a new value; unresolved tokens are left verbatim so the caller
 * can detect them (hasUnresolvedTokens) and fail the step with a clear error.
 * `priorResults` is an array indexed by plan_step (each = that step's
 * execution_result, i.e. the endpoint's response body).
 */
function resolveTokens(value, priorResults) {
  if (typeof value === "string") {
    const full = value.match(FULL_TOKEN_RE);
    if (full) {
      const resolved = pickField(priorResults[Number(full[1])], full[2]);
      return resolved === undefined ? value : resolved; // keep token if unresolved
    }
    return value.replace(TOKEN_RE, (tok, n, field) => {
      const resolved = pickField(priorResults[Number(n)], field);
      return resolved === undefined ? tok : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveTokens(v, priorResults));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTokens(v, priorResults);
    return out;
  }
  return value;
}

/** True when any `{{step:N.field}}` token survives in the (resolved) payload. */
function hasUnresolvedTokens(value) {
  if (typeof value === "string") return FULL_TOKEN_RE.test(value) || TOKEN_RE.test(value);
  if (Array.isArray(value)) return value.some(hasUnresolvedTokens);
  if (value && typeof value === "object") return Object.values(value).some(hasUnresolvedTokens);
  return false;
}

function parseArgs(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    return {};
  }
}

/** A short human-readable line for a step, shown on the plan card. */
function summariseStep(action, payload) {
  const label = action.title || action.action_key;
  const name = payload && (payload.title || payload.body);
  const when = payload && (payload.target_date || payload.due_at || payload.start_at);
  const bits = [label];
  if (name) bits.push(`“${String(name).slice(0, 80)}”`);
  if (when) bits.push(`(${String(when).slice(0, 16)})`);
  return bits.join(" ");
}

/**
 * Turn a completion's tool_calls into ordered step descriptors, validated
 * against the CoS allowlist. `byName` maps a tool name → catalogue action
 * (built ONLY from surface='workspace' rows, so a non-workspace action is
 * structurally impossible — this is the belt-and-braces guardrail check).
 * @returns {Array<{action_id,action_key,method,route,payload,human_summary,confidence}>}
 */
function buildSteps({ toolCalls, byName }) {
  const steps = [];
  for (const call of toolCalls || []) {
    const fn = call && call.function;
    if (!fn || !fn.name) continue;
    const action = byName.get(fn.name);
    if (!action) {
      throw new AppError(
        "COS_ACTION_NOT_ALLOWED",
        `Chief of Staff proposed an action outside its workspace scope: ${fn.name}`,
        422,
        { user_message: "That request is outside the Chief of Staff's remit." },
      );
    }
    if (action.surface !== "workspace" && action.surface !== "both") {
      throw new AppError(
        "COS_ACTION_NOT_ALLOWED",
        `Non-workspace action reached the CoS planner: ${action.action_key} (surface=${action.surface})`,
        422,
      );
    }
    const payload = parseArgs(fn.arguments);
    steps.push({
      action_id: action.action_id,
      action_key: action.action_key,
      method: action.method,
      route: action.route,
      payload,
      human_summary: summariseStep(action, payload),
      confidence:
        action.min_confidence !== null && action.min_confidence !== undefined
          ? Number(action.min_confidence)
          : 0.8,
    });
  }
  return steps;
}

/**
 * Persist a plan + its steps inside the caller's transaction. Returns
 * { plan, steps, superseded } or null when the completion proposed no actions
 * (a plain chat reply). `completion.content` becomes the plan summary.
 *
 * Proposing a plan CANCELS every other still-proposed plan in the same
 * conversation (superseded ids are returned so the caller can emit events):
 * stale duplicate cards staying approvable is how the CEO ended up with two
 * identical goals. `complete=false` marks a plan whose build budget ran out —
 * the CEO can append the owed steps via POST /cos/plans/:id/continue.
 */
async function planFromCompletion({
  client,
  completion,
  byName,
  conversation,
  userMsg,
  user,
  brand,
  complete = true,
}) {
  const steps = buildSteps({ toolCalls: completion.tool_calls, byName });
  if (!steps.length) return null;

  const summary =
    (completion.content && completion.content.trim()) ||
    `A ${steps.length}-step plan across your goals, tasks, calendar and notes.`;
  const title = summary.split("\n")[0].slice(0, 120) || "Proposed plan";

  const plan = await repo.createPlan({
    client,
    p: {
      conversation_id: conversation.conversation_id,
      business: brand,
      proposed_by_user_id: user.user_id,
      title,
      summary,
      is_complete: complete,
    },
  });

  const superseded = await repo.supersedeOtherProposedPlans({
    client,
    conversation_id: conversation.conversation_id,
    except_plan_id: plan.plan_id,
  });

  const persisted = await persistSteps({
    client,
    plan_id: plan.plan_id,
    conversation_id: conversation.conversation_id,
    message_id: userMsg ? userMsg.message_id : null,
    user,
    brand,
    steps,
    startIndex: 0,
  });
  return { plan, steps: persisted, superseded };
}

/**
 * Persist built steps under an existing plan, numbering from `startIndex` —
 * shared by the fresh-plan path (startIndex 0) and /continue (append).
 */
async function persistSteps({
  client,
  plan_id,
  conversation_id,
  message_id,
  user,
  brand,
  steps,
  startIndex,
}) {
  const persisted = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    persisted.push(
      await repo.createPlanStep({
        client,
        s: {
          conversation_id,
          message_id: message_id || null,
          proposed_by_user_id: user.user_id,
          business: brand,
          action_id: s.action_id,
          action_key: s.action_key,
          method: s.method,
          route: s.route,
          payload: s.payload,
          human_summary: s.human_summary,
          confidence: s.confidence,
          plan_id,
          plan_step: startIndex + i,
        },
      }),
    );
  }
  return persisted;
}

module.exports = {
  resolveTokens,
  hasUnresolvedTokens,
  pickField,
  buildSteps,
  summariseStep,
  planFromCompletion,
  persistSteps,
  TOKEN_RE,
};
