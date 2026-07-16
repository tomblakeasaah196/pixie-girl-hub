"use strict";

/**
 * Chief of Staff multi-round plan building (cos.plan-rounds.js) — truncation
 * continuation, narrated-kind enforcement, broken-promise retry, budget caps.
 * Pure orchestration: `chat` is injected, so no LLM/DB/HTTP loads.
 */

const rounds = require("../../../src/modules/chief_of_staff/cos.plan-rounds");

const call = (name, args = {}, id) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const completion = (over = {}) => ({
  content: "",
  tool_calls: [],
  finish_reason: "stop",
  reasoning_content: null,
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  ...over,
});

const MESSAGES = [{ role: "system", content: "persona" }, { role: "user", content: "plan it" }];

describe("runPlanRounds", () => {
  test("plain chat: one call, no steps, complete", async () => {
    const chat = jest.fn().mockResolvedValue(completion({ content: "What dates suit you?" }));
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(out.tool_calls).toEqual([]);
    expect(out.complete).toBe(true);
    expect(out.broken_promise).toBe(false);
    expect(out.content).toBe("What dates suit you?");
  });

  test("emits progress per round and reports reads count (PR2-D)", async () => {
    const chat = jest.fn().mockResolvedValue(
      completion({
        content: "The goal and its milestones.",
        tool_calls: [call("workspace_create_goal", { title: "G" }, "a")],
      }),
    );
    const onProgress = jest.fn();
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES, onProgress });
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls[0][0]).toEqual(
      expect.objectContaining({ round: 0, queued: 1, reads: 0, had_reads: false }),
    );
    expect(out.reads).toBe(0);
  });

  test("a full plan in one round needs no continuation", async () => {
    const chat = jest.fn().mockResolvedValue(
      completion({
        content: "The goal plus its milestones, tasks, calendar events and notes.",
        tool_calls: [
          call("workspace_create_goal", { title: "G" }, "a"),
          call("workspace_add_milestone", { title: "M" }, "b"),
          call("workspace_create_task", { title: "T" }, "c"),
          call("workspace_create_event", { title: "E" }, "d"),
          call("workspace_create_note", { body: "N" }, "e"),
        ],
      }),
    );
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(out.tool_calls).toHaveLength(5);
    expect(out.complete).toBe(true);
  });

  test("truncation (finish_reason=length) forces a continuation round and merges calls", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        completion({
          content: "Goal first.",
          tool_calls: [call("workspace_create_goal", { title: "G" }, "a")],
          finish_reason: "length",
        }),
      )
      .mockResolvedValueOnce(
        completion({
          tool_calls: [call("workspace_create_task", { title: "T" }, "b")],
        }),
      );
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(out.tool_calls.map((c) => c.function.name)).toEqual([
      "workspace_create_goal",
      "workspace_create_task",
    ]);
    expect(out.complete).toBe(true);

    // The continuation call replayed the assistant turn + queued-step stubs.
    const msgs = chat.mock.calls[1][0];
    const assistant = msgs.find((m) => m.role === "assistant" && m.tool_calls);
    expect(assistant.tool_calls).toHaveLength(1);
    const stub = msgs.find((m) => m.role === "tool");
    expect(stub.content).toContain('"plan_step":0');
    expect(msgs[msgs.length - 1].role).toBe("user");
    expect(msgs[msgs.length - 1].content).toMatch(/DONE/);
  });

  test("narrated kinds with no matching tool call force a continuation even without truncation", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        completion({
          content: "Goal: X. Milestones: four of them. Tasks: six. Plus calendar events and a note.",
          tool_calls: [call("workspace_create_goal", { title: "X" }, "a")],
        }),
      )
      .mockResolvedValueOnce(
        completion({
          tool_calls: [
            call("workspace_add_milestone", { title: "M" }, "b"),
            call("workspace_create_task", { title: "T" }, "c"),
            call("workspace_create_event", { title: "E" }, "d"),
            call("workspace_create_note", { body: "N" }, "e"),
          ],
        }),
      );
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(out.tool_calls).toHaveLength(5);
    expect(out.complete).toBe(true);
    // The nudge names what is still owed.
    const nudge = chat.mock.calls[1][0].at(-1);
    expect(nudge.content).toMatch(/milestones/);
    expect(nudge.content).toMatch(/tasks/);
  });

  test("DONE with no tool calls ends the loop as complete", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        completion({
          content: "Goal plus tasks.",
          tool_calls: [call("workspace_create_goal", { title: "G" }, "a")],
          finish_reason: "length",
        }),
      )
      .mockResolvedValueOnce(completion({ content: "DONE" }));
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(out.tool_calls).toHaveLength(1);
    expect(out.complete).toBe(true);
  });

  test("a continuation-round failure salvages the gathered steps as an incomplete plan", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        completion({
          content: "Goal first.",
          tool_calls: [call("workspace_create_goal", { title: "G" }, "a")],
          finish_reason: "length",
        }),
      )
      .mockRejectedValueOnce(new Error("all vendors down"));
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(out.tool_calls).toHaveLength(1); // round-0 steps survive
    expect(out.complete).toBe(false); // resumable via /continue
  });

  test("a round-0 failure still throws (the caller's stub path)", async () => {
    const chat = jest.fn().mockRejectedValue(new Error("all vendors down"));
    await expect(rounds.runPlanRounds({ chat, messages: MESSAGES })).rejects.toThrow(
      "all vendors down",
    );
  });

  test("budget exhaustion returns complete=false (resumable via /continue)", async () => {
    const chat = jest.fn().mockImplementation(async () =>
      completion({
        content: "keeps going",
        tool_calls: [call("workspace_create_task", { title: "T" })],
        finish_reason: "length",
      }),
    );
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(chat).toHaveBeenCalledTimes(rounds.MAX_PLAN_ROUNDS);
    expect(out.tool_calls).toHaveLength(rounds.MAX_PLAN_ROUNDS);
    expect(out.complete).toBe(false);
  });

  test("broken promise: 'let me fire it all in now' with no calls gets ONE retry; retry success builds the plan", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(completion({ content: "Perfect. Let me fire it all in now." }))
      .mockResolvedValueOnce(
        completion({ tool_calls: [call("workspace_create_goal", { title: "G" }, "a")] }),
      );
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(out.tool_calls).toHaveLength(1);
    expect(out.broken_promise).toBe(false);
    // The corrective nudge told the model nothing was queued.
    const retryMsgs = chat.mock.calls[1][0];
    expect(retryMsgs.at(-1).content).toMatch(/NOTHING was queued/);
  });

  test("broken promise twice is reported so the caller can be honest about it", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(completion({ content: "Let me set this up now." }))
      .mockResolvedValueOnce(completion({ content: "I'll build everything out now!" }));
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(out.tool_calls).toEqual([]);
    expect(out.broken_promise).toBe(true);
  });

  test("an honest retry rephrase clears the broken-promise flag", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(completion({ content: "Let me set this up now." }))
      .mockResolvedValueOnce(
        completion({ content: "Which of the two salons should I plan around?" }),
      );
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES });
    expect(out.broken_promise).toBe(false);
    expect(out.content).toBe("Which of the two salons should I plan around?");
  });

  test("stepOffset numbers stubs globally (the /continue path)", async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        completion({
          tool_calls: [call("workspace_create_task", { title: "T" }, "a")],
          finish_reason: "length",
        }),
      )
      .mockResolvedValueOnce(completion({ content: "DONE" }));
    const out = await rounds.runPlanRounds({
      chat,
      messages: MESSAGES,
      stepOffset: 3,
      detectFromContent: false,
    });
    expect(out.tool_calls).toHaveLength(1);
    const stub = chat.mock.calls[1][0].find((m) => m.role === "tool");
    expect(stub.content).toContain('"plan_step":3');
    expect(stub.content).toContain("{{step:3.field}}");
  });
});

describe("immediate reads", () => {
  const isRead = (c) => c.function.name.startsWith("workspace_list") || c.function.name.startsWith("workspace_search");

  test("read calls execute now, results feed the next round, and only writes queue", async () => {
    const executeRead = jest.fn().mockResolvedValue({ data: [{ goal_id: "g-1", title: "Existing" }] });
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        completion({
          content: "Let me check the current goals.",
          tool_calls: [call("workspace_list_goals", { status: "active" }, "r1")],
        }),
      )
      .mockResolvedValueOnce(
        completion({
          tool_calls: [call("workspace_create_goal", { title: "New goal" }, "w1")],
        }),
      );

    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES, isRead, executeRead });

    expect(executeRead).toHaveBeenCalledTimes(1);
    expect(out.tool_calls.map((c) => c.function.name)).toEqual(["workspace_create_goal"]);
    expect(out.complete).toBe(true);
    // The second call saw the REAL read result, not a queued stub.
    const msgs = chat.mock.calls[1][0];
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg.content).toContain("Existing");
    expect(toolMsg.content).not.toContain("queued");
  });

  test("a failing read feeds an error back instead of killing the turn", async () => {
    const executeRead = jest.fn().mockRejectedValue(new Error("403 nope"));
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        completion({ tool_calls: [call("workspace_list_tasks", {}, "r1")] }),
      )
      .mockResolvedValueOnce(completion({ content: "DONE" }));

    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES, isRead, executeRead });

    expect(out.complete).toBe(true);
    expect(out.tool_calls).toEqual([]);
    const toolMsg = chat.mock.calls[1][0].find((m) => m.role === "tool");
    expect(toolMsg.content).toContain("403 nope");
  });

  test("without an executeRead, read-looking calls are treated as ordinary queued writes", async () => {
    const chat = jest.fn().mockResolvedValue(
      completion({ tool_calls: [call("workspace_list_goals", {}, "r1")] }),
    );
    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES, isRead });
    expect(out.tool_calls).toHaveLength(1); // queued, since nothing can run it now
    expect(chat).toHaveBeenCalledTimes(1);
  });

  test("mixed round: writes get stubs with correct global numbering alongside read results", async () => {
    const executeRead = jest.fn().mockResolvedValue({ data: [] });
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        completion({
          tool_calls: [
            call("workspace_create_goal", { title: "G" }, "w1"),
            call("workspace_list_goals", {}, "r1"),
            call("workspace_create_task", { title: "T" }, "w2"),
          ],
        }),
      )
      .mockResolvedValueOnce(completion({ content: "DONE" }));

    const out = await rounds.runPlanRounds({ chat, messages: MESSAGES, isRead, executeRead });

    expect(out.tool_calls.map((c) => c.id)).toEqual(["w1", "w2"]);
    const toolMsgs = chat.mock.calls[1][0].filter((m) => m.role === "tool");
    const byId = Object.fromEntries(toolMsgs.map((m) => [m.tool_call_id, m.content]));
    expect(byId.w1).toContain('"plan_step":0');
    expect(byId.w2).toContain('"plan_step":1');
    expect(byId.r1).not.toContain("plan_step");
  });
});

describe("helpers", () => {
  test("promisesAction matches commitment language, not plain chat", () => {
    expect(rounds.promisesAction("Let me fire it all in now.")).toBe(true);
    expect(rounds.promisesAction("I'll set this up right away")).toBe(true);
    expect(rounds.promisesAction("Let me start building.")).toBe(true);
    expect(rounds.promisesAction("Let me know what you decide.")).toBe(false);
    expect(rounds.promisesAction("What does a good day look like?")).toBe(false);
  });

  test("missingKinds compares narration against emitted tool names", () => {
    const content = "A goal with milestones, tasks, calendar events and a note.";
    const calls = [call("workspace_create_goal"), call("workspace_add_milestone")];
    expect(rounds.missingKinds(content, calls)).toEqual(["tasks", "calendar events", "notes"]);
    expect(rounds.missingKinds("just chatting about london", calls)).toEqual([]);
  });
});
