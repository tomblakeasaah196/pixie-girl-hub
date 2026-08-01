/**
 * Chief of Staff — multi-round plan building.
 *
 * One completion cannot reliably carry a whole plan: long narration plus a
 * dozen tool-call payloads hits the output-token cap (finish_reason='length')
 * and every remaining step silently vanishes — the "promised 4 milestones and
 * 6 tasks, created only the goal" bug. Some vendors also under-emit parallel
 * tool calls even without truncation.
 *
 * runPlanRounds() therefore loops the model over BOUNDED rounds within one
 * turn: after each round its tool calls are acknowledged with queued-step
 * stubs (so cross-step `{{step:N.field}}` numbering stays global) and the
 * model is asked to continue until it replies with no further tool calls.
 * Two extra guards ride along:
 *
 *   - broken promise: a reply that says "let me fire it all in now" with NO
 *     tool calls gets ONE corrective retry; if the retry still proposes
 *     nothing, the caller is told (broken_promise) so it can append an honest
 *     "nothing was queued" note instead of shipping the empty promise.
 *   - narrated-kind check: when the reply describes milestones/tasks/events/
 *     notes but no tool call of that kind was emitted, a continuation round
 *     is forced even without truncation.
 *
 * When the round/step budget runs out before the model finishes, the caller
 * persists the plan with is_complete=false and the CEO can resume it via
 * POST /cos/plans/:id/continue (which calls this loop again with stepOffset).
 * Pure orchestration — no DB, no HTTP; `chat` is injected (llm-router shaped).
 */

"use strict";

// 1 opening call + up to 9 continuations per invocation (read round-trips
// share the budget). Each call is metered on the governance ledger by the
// caller, so the ceiling also bounds spend. Raised from 6/40/8 — big plans
// (goal + milestones + weekly events for months) were exhausting the budget
// and forcing manual "Continue building" taps.
const MAX_PLAN_ROUNDS = 10;
// Hard ceiling on steps accumulated in one invocation (mirrors the tool cap).
const MAX_PLAN_STEPS = 60;
// Hard ceiling on immediately-executed READ tool calls per invocation.
const MAX_READS = 12;

// First-person commitment with nothing attached — "Let me fire it all in
// now", "I'll set this up", "Let me check the team database". Deliberately
// requires a commitment verb so plain chat ("let me know", "let me think")
// never trips. READ verbs (check/search/look up/find/verify/confirm/pull up)
// are covered too: "Let me check our team database for X" with no tool call
// was shipping as a dead promise — the lookup never ran and the CEO could ask
// again forever (the Samuel-Farounbi bug).
const PROMISE_RE =
  /\b(let me|i(?:'|’)ll|i will|i am going to|i(?:'|’)m going to)\s+(now\s+)?(go ahead and\s+)?(fire|fir(?:e|ing)|set(?:ting)? (?:this|that|it|everything) up|set up|build|start building|creat|draft|add|queue|schedul|put (?:this|that|it) (?:in|together)|lay (?:it|this|that) (?:all )?(?:in|out)|(?:double[- ])?check|search|look\s+(?:(?:\w+)\s+)?(?:up|into|for)|find|verify|confirm (?:whether|if|his|her|their|that)|pull\s+(?:\w+\s+)?up|retriev|quer(?:y|ies)|run a (?:search|lookup|check))/i;

// Narrated step kinds vs the tool calls actually emitted. Tool names are the
// safeName'd catalogue keys (workspace_add_milestone, workspace_create_task,
// workspace_create_event, workspace_create_note, …) so a substring match on
// the kind is enough.
const KINDS = [
  { name: "milestones", narrated: /\bmilestones?\b/i, tool: "milestone" },
  { name: "tasks", narrated: /\btasks?\b/i, tool: "task" },
  { name: "calendar events", narrated: /\bcalendar\b|\bevents?\b|\bcheck-?ins?\b/i, tool: "event" },
  { name: "notes", narrated: /\bnotes?\b/i, tool: "note" },
];

/** True when the reply commits to acting ("let me fire it all in now"). */
function promisesAction(content) {
  return PROMISE_RE.test(String(content || ""));
}

/** Kinds the narration describes but no emitted tool call covers. */
function missingKinds(content, toolCalls) {
  const names = (toolCalls || []).map(
    (c) => (c && c.function && c.function.name) || "",
  );
  return KINDS.filter(
    (k) => k.narrated.test(String(content || "")) && !names.some((n) => n.includes(k.tool)),
  ).map((k) => k.name);
}

/** Copy calls, guaranteeing each has an id (tool replay needs matching ids). */
function normaliseCalls(calls, startIndex) {
  return (calls || [])
    .filter((c) => c && c.function && c.function.name)
    .map((c, i) => ({ ...c, id: c.id || `plan_step_${startIndex + i}` }));
}

/** The queued-step acknowledgement for one WRITE call at global index N. */
function queuedStub(stepIndex) {
  return JSON.stringify({
    queued: true,
    plan_step: stepIndex,
    note:
      `Queued for the CEO's approval as plan step ${stepIndex}. ` +
      `Reference its future result with {{step:${stepIndex}.field}} tokens ` +
      `(e.g. {{step:${stepIndex}.goal_id}}).`,
  });
}

/**
 * The replayed assistant turn + per-call tool results + continue nudge
 * appended between rounds. WRITE calls are acknowledged with queued-step
 * stubs carrying the GLOBAL step index (so `{{step:N.field}}` tokens written
 * in later rounds point at the right earlier step); READ calls carry the
 * real data returned by the immediately-executed endpoint.
 */
function continuationMessages({ completion, calls, results, missing, hadReads }) {
  const assistant = {
    role: "assistant",
    content: completion.content || "",
    tool_calls: calls,
  };
  // DeepSeek reasoner models 400 unless reasoning_content is round-tripped.
  if (completion.reasoning_content) assistant.reasoning_content = completion.reasoning_content;

  const toolMsgs = calls.map((call, i) => ({
    role: "tool",
    tool_call_id: call.id,
    content: results[i],
  }));

  const nudge = {
    role: "user",
    content:
      (hadReads
        ? "The read results are above. Use them now: if the CEO's request needs work queued, emit the remaining WRITE steps as tool calls; if she asked a question, ANSWER it in plain text from these results — never reply with a bare acknowledgement"
        : "Continue building the SAME plan: emit the remaining steps as tool calls now") +
      (missing && missing.length
        ? ` — you described ${missing.join(", ")} that are not queued yet`
        : "") +
      ". Never repeat a step that is already queued; keep using the step numbering above for cross-step tokens. " +
      "If every step is queued and nothing needs answering, reply with exactly DONE and no tool calls.",
  };

  return [assistant, ...toolMsgs, nudge];
}

const RETRY_NUDGE =
  "You said you would do that, but your reply contained no tool calls, so NOTHING was checked or queued. " +
  "If you promised to check, search or look something up, call the matching READ tool now and answer from its results. " +
  "If you promised to set work up, emit the tool calls for the WHOLE plan now. " +
  "If you are genuinely still missing information, ask for it plainly instead — without promising action.";

/**
 * Run the bounded plan-building loop.
 *
 * @param {object}  args
 * @param {(messages: Array) => Promise<object>} args.chat
 *        One llm-router-shaped completion call ({content, tool_calls,
 *        finish_reason, reasoning_content, usage, …}).
 * @param {Array}   args.messages     the turn's opening messages
 * @param {number}  [args.stepOffset=0]
 *        Global index of the first step this invocation will queue — 0 for a
 *        fresh turn, `existing step count` when continuing a saved plan.
 * @param {boolean} [args.detectFromContent=true]
 *        Apply the narrated-kind check (on for chat turns, off for /continue
 *        where the narration lives in an earlier turn).
 * @param {(call: object) => boolean} [args.isRead]
 *        True for a tool call that is a READ (immediately executable). No
 *        isRead/executeRead → every call is treated as a write (queued).
 * @param {(call: object) => Promise<any>} [args.executeRead]
 *        Execute a READ call now (loopback as the CEO, RBAC applies) and
 *        return the endpoint's response body. Errors are caught per call.
 * @returns {Promise<{content:string, tool_calls:Array, complete:boolean,
 *                    completions:Array, broken_promise:boolean}>}
 *          `tool_calls` is the ACCUMULATED, id-normalised list of WRITE calls
 *          across rounds (reads never queue); `complete=false` means the
 *          budget ran out with steps still owed; every entry of `completions`
 *          must be usage-metered by the caller.
 */
async function runPlanRounds({
  chat,
  messages,
  stepOffset = 0,
  detectFromContent = true,
  isRead = () => false,
  executeRead = null,
  onProgress = null,
}) {
  const progress = (info) => {
    if (typeof onProgress === "function") {
      try {
        onProgress(info);
      } catch {
        /* progress is best-effort — never break a turn */
      }
    }
  };
  const completions = [];
  const allCalls = []; // accumulated WRITE calls only
  let msgs = [...messages];
  let content = "";
  let complete = true;
  let seenCalls = 0; // uniqueness seed for fallback tool_call ids
  let readsDone = 0;
  // The most recent substantive text across ALL rounds. Round 0's narration
  // is a promise ("Let me check the team database…") when the turn starts
  // with reads — the real answer only arrives in the round AFTER the read
  // results. Dropping it shipped the promise instead of the answer (the
  // Samuel-Farounbi bug); this keeps it so the reply can prefer it.
  let lastText = "";
  const noteText = (c) => {
    const t = String((c && c.content) || "").trim();
    if (t && !/^done[.!]?$/i.test(t)) lastText = t;
  };

  for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
    let completion;
    try {
      completion = await chat(msgs);
    } catch (err) {
      // Round 0 failing is the caller's stub path. A CONTINUATION round
      // failing must not torch the steps already gathered — salvage them as
      // an incomplete (resumable) plan instead.
      if (round === 0 || !allCalls.length) throw err;
      complete = false;
      break;
    }
    completions.push(completion);
    noteText(completion);

    if (round === 0) {
      content = String(completion.content || "").trim();

      // Broken-promise retry: committed to act, attached nothing.
      if (!(completion.tool_calls || []).length && promisesAction(content)) {
        msgs = [
          ...msgs,
          { role: "assistant", content },
          { role: "user", content: RETRY_NUDGE },
        ];
        const retry = await chat(msgs);
        completions.push(retry);
        noteText(retry);
        if ((retry.tool_calls || []).length) {
          completion = retry;
          const t = String(retry.content || "").trim();
          if (t && t.toUpperCase() !== "DONE") content = t;
        } else {
          const t = String(retry.content || "").trim();
          if (t) content = t; // the retry was asked to rephrase honestly
          return {
            content,
            tool_calls: [],
            complete: true,
            completions,
            reads: readsDone,
            broken_promise: promisesAction(content),
          };
        }
      }
    }

    const calls = normaliseCalls(completion.tool_calls, seenCalls);
    seenCalls += calls.length;
    if (!calls.length) break; // plain chat turn (round 0) or DONE (later)

    // Partition: READS execute now (real data back to the model); WRITES
    // queue as plan steps. Reads never consume the step budget.
    const canRead = typeof executeRead === "function";
    const reads = canRead ? calls.filter((c) => isRead(c)) : [];
    let writes = canRead ? calls.filter((c) => !isRead(c)) : calls;

    let droppedByCap = false;
    if (allCalls.length + writes.length > MAX_PLAN_STEPS) {
      writes = writes.slice(0, MAX_PLAN_STEPS - allCalls.length);
      droppedByCap = true; // steps were cut — the plan cannot be complete
    }

    // Per-call tool results, in the completion's call order.
    const kept = new Set(writes);
    const readResults = new Map();
    for (const call of reads) {
      if (readsDone >= MAX_READS) {
        readResults.set(call, JSON.stringify({ error: "Read budget for this turn is spent — plan with what you already know." }));
        continue;
      }
      readsDone++;
      try {
        const data = await executeRead(call);
        readResults.set(call, JSON.stringify(data === undefined ? null : data));
      } catch (err) {
        readResults.set(call, JSON.stringify({ error: String(err.user_message || err.message).slice(0, 500) }));
      }
    }
    let nextStep = stepOffset + allCalls.length;
    const results = calls.map((call) => {
      if (readResults.has(call)) return readResults.get(call);
      if (kept.has(call)) return queuedStub(nextStep++);
      return JSON.stringify({ dropped: true, note: "Step budget exhausted — not queued." });
    });

    // Live progress for the chat UI (replaces the dead spinner): what this
    // round did — looked things up, or queued more steps.
    progress({
      round,
      queued: allCalls.length + writes.length,
      reads: readsDone,
      had_reads: reads.length > 0,
    });

    const owed =
      droppedByCap ||
      completion.finish_reason === "length" ||
      (detectFromContent && missingKinds(content, [...allCalls, ...writes]).length > 0);

    if (!owed && !reads.length) {
      allCalls.push(...writes);
      break;
    }
    if (round === MAX_PLAN_ROUNDS - 1 || allCalls.length + writes.length >= MAX_PLAN_STEPS) {
      // Budget spent — persist what we have; resumable when steps are owed.
      allCalls.push(...writes);
      complete = !owed;
      break;
    }

    msgs = [
      ...msgs,
      ...continuationMessages({
        completion,
        calls,
        results,
        missing: detectFromContent ? missingKinds(content, [...allCalls, ...writes]) : [],
        hadReads: reads.length > 0,
      }),
    ];
    allCalls.push(...writes);
  }

  // Reply selection: a plan turn keeps round 0's narration (it describes what
  // the CEO is approving; later rounds are ack noise). A turn that queued
  // nothing — pure Q&A, usually read-grounded — prefers the LAST substantive
  // text, which is the answer written after the read results came back.
  const finalContent = allCalls.length ? content || lastText : lastText || content;
  return {
    content: finalContent,
    tool_calls: allCalls,
    complete,
    completions,
    reads: readsDone,
    broken_promise: false,
  };
}

module.exports = {
  runPlanRounds,
  // internals exposed for tests
  promisesAction,
  missingKinds,
  continuationMessages,
  normaliseCalls,
  queuedStub,
  MAX_PLAN_ROUNDS,
  MAX_PLAN_STEPS,
  MAX_READS,
};
