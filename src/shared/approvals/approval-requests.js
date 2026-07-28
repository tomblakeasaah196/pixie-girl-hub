/**
 * Approval requests — the one way a module asks someone to approve something,
 * and the one way that ask gets closed out.
 *
 * THE PROBLEM THIS SOLVES
 * Every module grew its own version of "tell the approvers". Stock raised
 * tasks; cash requests sent notifications; the workflow engine did neither and
 * relied on someone opening the approvals queue. None of them carried a link,
 * so an approver was told a decision was waiting but not where, and none of
 * them closed anything, so approving a request left its task open for every
 * approver to tidy up by hand — at two stages, that is two stale tasks per
 * request, forever.
 *
 * THE RULE
 *   requestApproval() when the request goes out — one task + one notification
 *   per approver, both deep-linked to the record itself.
 *   settleApproval() when the decision lands — every open task for that
 *   record closes itself, and the requester is told the outcome with the same
 *   link.
 *
 * Both are BEST-EFFORT by contract: an approval must never fail because a
 * notification could not be written. Callers get a summary; failures are
 * logged, never thrown. Both are idempotent — requestApproval skips an
 * approver who already has an open task for the record (so a resubmit or a
 * redelivered event doesn't stack duplicates), and settleApproval closing
 * nothing is a no-op.
 *
 * The link comes from shared/links/deep-links.js — modules name their record,
 * they never build routes.
 */

"use strict";

const tasksRepo = require("../tasks/tasks.repo");
const tasksEvents = require("../tasks/tasks.events");
const notifications = require("../../services/notifications.service");
const { deepLinkFor, labelFor } = require("../links/deep-links");
const { logger } = require("../../config/logger");

/** Past-tense wording for the requester's outcome notice. */
const OUTCOME_COPY = {
  approved: { verb: "approved", tone: "normal" },
  rejected: { verb: "rejected", tone: "high" },
  changes_requested: { verb: "sent back for changes", tone: "high" },
  cancelled: { verb: "withdrawn", tone: "low" },
};

/**
 * Ask a set of approvers to decide on a record.
 *
 * @param {object}   a
 * @param {string}   a.brand            business key
 * @param {string}   a.reference_type   e.g. 'stock_adjustment' — must be a key
 *                                      in deep-links.js to get a link
 * @param {string}   a.reference_id     the record's id
 * @param {string[]} a.approver_user_ids who must decide
 * @param {string}   a.title            task title — name the document
 * @param {string}   [a.description]    why / how much
 * @param {string}   [a.requested_by]   the submitter (task.created_by)
 * @param {string}   [a.priority]       task + notification priority
 * @param {string}   [a.due_at]         decision deadline
 * @param {string}   [a.notification_type] defaults to 'approval_requested'
 * @returns {Promise<{ tasks: object[], skipped: number }>}
 */
async function requestApproval({
  brand,
  reference_type,
  reference_id,
  approver_user_ids = [],
  title,
  description,
  requested_by,
  priority = "high",
  due_at,
  notification_type = "approval_requested",
}) {
  const created = [];
  let skipped = 0;
  if (!brand || !reference_type || !reference_id) return { tasks: [], skipped };

  const action_url = deepLinkFor(reference_type, reference_id);
  const what = labelFor(reference_type);

  // One read for the whole fan-out: who already has this on their plate.
  let existing = [];
  try {
    existing = await tasksRepo.openTasksForReference({
      brand,
      reference_type,
      reference_id,
    });
  } catch (err) {
    logger.warn(
      { err: err.message, brand, reference_type, reference_id },
      "approvals: could not read existing approval tasks — continuing",
    );
  }
  const alreadyAsked = new Set(
    existing.map((t) => t.assigned_to).filter(Boolean),
  );

  for (const user_id of [...new Set(approver_user_ids)].filter(Boolean)) {
    if (alreadyAsked.has(user_id)) {
      skipped += 1;
      continue;
    }
    try {
      const task = await tasksRepo.createTask({
        task: {
          business: brand,
          title,
          description: description || null,
          status: "to_do",
          priority,
          assigned_to: user_id,
          due_at: due_at || null,
          reference_type,
          reference_id,
          // created_by is NOT NULL; the submitter owns the ask. Falling back to
          // the approver keeps the row valid when a module has no submitter.
          created_by: requested_by || user_id,
        },
      });
      created.push(task);
      tasksEvents.emit("task.created", {
        brand,
        task_id: task.task_id,
        source: reference_type,
      });

      await notifications.notify({
        user_id,
        business: brand,
        type: notification_type,
        priority: priority === "urgent" ? "urgent" : "high",
        title: `Approval needed: ${title}`,
        body: description || `A ${what} is waiting for your decision.`,
        reference_type,
        reference_id,
        action_url,
      });
    } catch (err) {
      // One approver's notification failing must not deny the others theirs,
      // and must never fail the submission that triggered this.
      logger.error(
        { err: err.message, brand, reference_type, reference_id, user_id },
        "approvals: failed to raise an approval request for an approver",
      );
    }
  }

  return { tasks: created, skipped };
}

/**
 * The decision landed — close the request out.
 *
 * Closes every open task raised for the record (whoever holds it: a two-stage
 * approval leaves tasks with both tiers, and the decision retires all of
 * them), then tells the requester the outcome with a link back to the record.
 *
 * @param {object} a
 * @param {string} a.brand
 * @param {string} a.reference_type
 * @param {string} a.reference_id
 * @param {string} a.outcome        approved | rejected | changes_requested | cancelled
 * @param {string} [a.requester_user_id] who to tell; omit to tell no one
 * @param {string} [a.actor_name]   who decided, for the notice body
 * @param {string} [a.title]        document name, for the notice title
 * @param {string} [a.note]         rejection reason / approver's comment
 * @returns {Promise<{ closed: number }>}
 */
async function settleApproval({
  brand,
  reference_type,
  reference_id,
  outcome,
  requester_user_id,
  actor_name,
  title,
  note,
  notification_type = "approval_decided",
}) {
  if (!brand || !reference_type || !reference_id) return { closed: 0 };
  const copy = OUTCOME_COPY[outcome] || { verb: outcome, tone: "normal" };
  const what = labelFor(reference_type);
  let closed = [];

  try {
    closed = await tasksRepo.closeTasksForReference({
      brand,
      reference_type,
      reference_id,
      // A withdrawn request was never decided — its tasks are cancelled, not
      // done, so nobody's completed count is inflated by work that vanished.
      status: outcome === "cancelled" ? "cancelled" : "done",
    });
    for (const t of closed) {
      tasksEvents.emit("task.status_changed", {
        brand,
        task_id: t.task_id,
        status: outcome === "cancelled" ? "cancelled" : "done",
      });
    }
  } catch (err) {
    logger.error(
      { err: err.message, brand, reference_type, reference_id },
      "approvals: failed to close approval tasks after a decision",
    );
  }

  if (requester_user_id) {
    try {
      await notifications.notify({
        user_id: requester_user_id,
        business: brand,
        type: notification_type,
        priority: copy.tone,
        title: `${title || `Your ${what}`} was ${copy.verb}`,
        body:
          note ||
          (actor_name
            ? `${actor_name} ${copy.verb} your ${what}.`
            : `Your ${what} was ${copy.verb}.`),
        reference_type,
        reference_id,
      });
    } catch (err) {
      logger.error(
        { err: err.message, brand, reference_type, reference_id },
        "approvals: failed to notify the requester of a decision",
      );
    }
  }

  return { closed: closed.length };
}

module.exports = { requestApproval, settleApproval };
