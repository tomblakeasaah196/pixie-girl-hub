/**
 * Retention strategy engine service (Module 6.23). Business logic for the
 * no-code strategy builder: CRUD, template instantiation, the self-describing
 * catalogue, plain-language summaries, and preview/test-send so the UI is
 * friendly and safe for a non-technical owner.
 */

"use strict";

const repo = require("./strategy.repo");
const catalogue = require("./strategy.catalogue");
const templates = require("./strategy.templates");
const conditions = require("./strategy.conditions");
const facts = require("./strategy.facts");
const actions = require("./strategy.actions");
const engine = require("./strategy.engine");
const email = require("../../services/email.service");
const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { NotFoundError, AppError } = require("../../utils/errors");

const TRIGGER_LABELS = Object.fromEntries(
  catalogue.TRIGGERS.map((t) => [t.key, t.label.toLowerCase()]),
);

function humanWait(minutes) {
  if (!minutes) return "immediately";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `after ${d} day${d === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `after ${h} hour${h === 1 ? "" : "s"}`;
  }
  return `after ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function stepPhrase(step) {
  if (step.description) return `${humanWait(step.wait_minutes)}, ${step.description.toLowerCase()}`;
  const map = {
    send_email: "send an email",
    issue_coupon: "give a coupon",
    award_points: "award loyalty points",
    add_to_segment: "tag the customer",
    assign_to_user: "assign a follow-up",
    create_task: "create a task",
    notify_team: "notify the team",
  };
  return `${humanWait(step.wait_minutes)}, ${map[step.action_type] || step.action_type}`;
}

/** Compose a plain-language sentence describing the whole strategy. */
function summarize(strategy, steps) {
  const trig = TRIGGER_LABELS[strategy.trigger_type] || strategy.trigger_type;
  const cond = conditions.describe(strategy.trigger_conditions || {});
  const when = cond ? `When ${trig} and ${cond}` : `When ${trig}`;
  const body = (steps || []).map(stepPhrase).join("; then ");
  return body ? `${when}, ${body}.` : `${when}.`;
}

// ── CRUD ──────────────────────────────────────────────────
async function list({ brand, status }) {
  return repo.listStrategies({ brand, status });
}

async function getOne({ brand, id }) {
  const strategy = await repo.getStrategy({ brand, id });
  if (!strategy) throw new NotFoundError("Retention strategy");
  const steps = await repo.listSteps({ brand, strategy_id: id });
  return { ...strategy, steps };
}

async function create({ brand, user, request_id, input }) {
  const { steps = [], ...strategyInput } = input;
  const result = await transaction(async (client) => {
    const strategy = await repo.createStrategy({
      client,
      brand,
      input: strategyInput,
      user_id: user.user_id,
    });
    const savedSteps = await repo.replaceSteps({
      client,
      brand,
      strategy_id: strategy.strategy_id,
      steps,
    });
    return { strategy, steps: savedSteps };
  });
  // Persist the generated summary.
  const summary = summarize(result.strategy, result.steps);
  await repo.updateStrategy({ brand, id: result.strategy.strategy_id, patch: { summary } });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.strategy.create",
    target_type: "retention_strategy",
    target_id: result.strategy.strategy_id,
    after: { strategy_key: result.strategy.strategy_key },
    request_id,
  });
  return { ...result.strategy, summary, steps: result.steps };
}

async function update({ brand, user, request_id, id, patch }) {
  const { steps, ...rest } = patch;
  const existing = await repo.getStrategy({ brand, id });
  if (!existing) throw new NotFoundError("Retention strategy");

  const saved = await transaction(async (client) => {
    if (Object.keys(rest).length) await repo.updateStrategy({ brand, id, patch: rest });
    if (Array.isArray(steps))
      await repo.replaceSteps({ client, brand, strategy_id: id, steps });
    const strategy = await repo.getStrategy({ client, brand, id });
    const stepRows = await repo.listSteps({ client, brand, strategy_id: id });
    return { strategy, steps: stepRows };
  });

  const summary = summarize(saved.strategy, saved.steps);
  await repo.updateStrategy({ brand, id, patch: { summary } });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.strategy.update",
    target_type: "retention_strategy",
    target_id: id,
    after: rest,
    request_id,
  });
  return { ...saved.strategy, summary, steps: saved.steps };
}

async function setStatus({ brand, user, request_id, id, status }) {
  const existing = await repo.getStrategy({ brand, id });
  if (!existing) throw new NotFoundError("Retention strategy");
  if (status === "active") {
    const steps = await repo.listSteps({ brand, strategy_id: id });
    if (steps.length === 0)
      throw new AppError("NO_STEPS", "Add at least one step before activating.", 409);
  }
  const strategy = await repo.setStatus({ brand, id, status });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: `retention.strategy.${status}`,
    target_type: "retention_strategy",
    target_id: id,
    request_id,
  });
  return strategy;
}

async function createFromTemplate({ brand, user, request_id, template_key, overrides = {} }) {
  const tpl = templates.get(template_key);
  if (!tpl) throw new NotFoundError("Strategy template");
  const strategy_key =
    overrides.strategy_key || `${template_key}_${Math.random().toString(36).slice(2, 7)}`;
  const input = {
    strategy_key,
    display_name: overrides.display_name || tpl.name,
    description: overrides.description || tpl.description,
    template_key: tpl.template_key,
    trigger_type: tpl.trigger_type,
    trigger_conditions: tpl.trigger_conditions || {},
    status: "draft",
    ...(tpl.defaults || {}),
    steps: tpl.steps,
  };
  return create({ brand, user, request_id, input });
}

// ── Catalogue + preview + test ────────────────────────────
function getCatalogue() {
  return catalogue.build();
}

async function buildSampleFacts({ brand, contact_id }) {
  const f = await facts.build({ brand, contact_id: contact_id || null });
  if (!contact_id) {
    // Friendly placeholder so a preview always renders.
    f.first_name = f.first_name === "there" ? "Ada" : f.first_name;
    f.email = f.email || "sample.customer@example.com";
  }
  return f;
}

/**
 * Dry-run a strategy against a (real or sample) customer: would they enrol,
 * which steps fire, and what each email would say.
 */
async function preview({ brand, id, contact_id }) {
  const strategy = await repo.getStrategy({ brand, id });
  if (!strategy) throw new NotFoundError("Retention strategy");
  const steps = await repo.listSteps({ brand, strategy_id: id });
  const sample = await buildSampleFacts({ brand, contact_id });

  const wouldEnrol = conditions.evaluate(strategy.trigger_conditions || {}, sample);
  const stepPreviews = steps.map((step) => {
    const passes = conditions.evaluate(step.step_conditions || {}, sample);
    const out = {
      step_order: step.step_order,
      action_type: step.action_type,
      wait: humanWait(step.wait_minutes),
      condition_met: passes,
      description: step.description || null,
    };
    if (step.action_type === "send_email") {
      out.rendered = {
        subject: actions.renderTokens(step.action_config.subject || "", sample),
        html: actions.renderTokens(step.action_config.html || step.action_config.body || "", sample),
      };
    }
    return out;
  });

  return {
    summary: strategy.summary || summarize(strategy, steps),
    would_enroll: wouldEnrol,
    facts_used: sample,
    steps: stepPreviews,
  };
}

/** Send one step's email to the requesting staff member for a sanity check. */
async function testSend({ brand, id, step_order, user }) {
  if (!user || !user.email)
    throw new AppError("NO_EMAIL", "Your account has no email to send the test to.", 409);
  const strategy = await repo.getStrategy({ brand, id });
  if (!strategy) throw new NotFoundError("Retention strategy");
  const steps = await repo.listSteps({ brand, strategy_id: id });
  const step = steps.find((s) => s.step_order === (step_order || steps[0]?.step_order));
  if (!step) throw new NotFoundError("Strategy step");
  if (step.action_type !== "send_email")
    throw new AppError("NOT_EMAIL", "That step does not send an email.", 409);

  const sample = await buildSampleFacts({ brand });
  const subject = `[TEST] ${actions.renderTokens(step.action_config.subject || "", sample)}`;
  const html = actions.renderTokens(step.action_config.html || step.action_config.body || "", sample);
  await email.send({ to: user.email, subject, html, brand });
  return { sent_to: user.email, subject };
}

// ── Engine passthrough (used by subscribers, scanner, controller) ──
const trigger = engine.trigger;
const tick = engine.tick;

async function listEnrollments({ brand, id }) {
  return repo.listEnrollments({ brand, strategy_id: id });
}

module.exports = {
  list,
  getOne,
  create,
  update,
  setStatus,
  createFromTemplate,
  getCatalogue,
  preview,
  testSend,
  summarize,
  listEnrollments,
  trigger,
  tick,
};
