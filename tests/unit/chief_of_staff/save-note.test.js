"use strict";

/**
 * Chief of Staff — "Save conversation to Notes".
 *
 * Covers the LLM-response parser (title/body extraction with graceful
 * degradation) and the save-note service path: empty guard, upsert wiring,
 * and the created/updated action passthrough. Heavy deps are mocked so no
 * DB/HTTP/LLM loads.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(() => jest.fn()),
  transaction: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/transcription.service", () => ({ transcribe: jest.fn() }));
jest.mock("../../../src/services/llm-router", () => ({ chatWithFailover: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  listActions: jest.fn(),
  canUseFeature: jest.fn(),
  recordUsage: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/model-catalogue.repo", () => ({
  resolveActiveModel: jest.fn(),
  computeCost: jest.fn(() => "0"),
}));
jest.mock("../../../src/modules/praxis_ai/praxis.repo", () => ({
  findConversation: jest.fn(),
  listMessages: jest.fn(),
}));
jest.mock("../../../src/shared/goals/notes.repo", () => ({
  findNoteByCosConversation: jest.fn(),
  upsertCosNote: jest.fn(),
}));

const llmRouter = require("../../../src/services/llm-router");
const governance = require("../../../src/modules/ai_governance/governance.service");
const praxisRepo = require("../../../src/modules/praxis_ai/praxis.repo");
const notesRepo = require("../../../src/shared/goals/notes.repo");
const cos = require("../../../src/modules/chief_of_staff/cos.service");

beforeEach(() => jest.clearAllMocks());

// ── parseNoteResponse ─────────────────────────────────────
describe("parseNoteResponse", () => {
  test("splits a well-formed TITLE / BODY response", () => {
    const raw = [
      "### TITLE",
      "London popup feasibility",
      "",
      "### BODY",
      "## Overview",
      "- Considering a UK popup while travelling.",
    ].join("\n");
    const { title, body } = cos.parseNoteResponse(raw);
    expect(title).toBe("London popup feasibility");
    expect(body).toContain("## Overview");
    expect(body).toContain("Considering a UK popup");
    // The TITLE marker must not bleed into the body.
    expect(body).not.toContain("### TITLE");
  });

  test("strips surrounding quotes and clamps the title length", () => {
    const long = "x".repeat(200);
    const raw = `### TITLE\n"${long}"\n\n### BODY\nbody text`;
    const { title } = cos.parseNoteResponse(raw);
    expect(title.startsWith('"')).toBe(false);
    expect(title.length).toBeLessThanOrEqual(80);
  });

  test("falls back to the whole text as body when the shape is missing", () => {
    const { title, body } = cos.parseNoteResponse("just some freeform summary");
    expect(body).toBe("just some freeform summary");
    expect(title).toBe("Chief of Staff note");
  });

  test("never returns an empty title", () => {
    const { title } = cos.parseNoteResponse("### TITLE\n\n### BODY\nb");
    expect(title).toBe("Chief of Staff note");
  });
});

// ── saveConversationAsNote ────────────────────────────────
describe("saveConversationAsNote", () => {
  const user = { user_id: "u1", is_ceo: true };
  const conv = { conversation_id: "c1", user_id: "u1", kind: "chief_of_staff" };

  test("rejects an empty conversation before spending an LLM call", async () => {
    praxisRepo.findConversation.mockResolvedValue(conv);
    praxisRepo.listMessages.mockResolvedValue([]);
    await expect(
      cos.saveConversationAsNote({ user, brand: "pixiegirl", request_id: "r", id: "c1" }),
    ).rejects.toMatchObject({ code: "COS_NOTE_EMPTY" });
    expect(llmRouter.chatWithFailover).not.toHaveBeenCalled();
  });

  test("blocks when the feature guard is closed", async () => {
    praxisRepo.findConversation.mockResolvedValue(conv);
    praxisRepo.listMessages.mockResolvedValue([
      { role: "user", content: "hi" },
    ]);
    governance.canUseFeature.mockResolvedValue({ ok: false, reason: "BUDGET_HARD_CAP" });
    await expect(
      cos.saveConversationAsNote({ user, brand: "pixiegirl", request_id: "r", id: "c1" }),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(llmRouter.chatWithFailover).not.toHaveBeenCalled();
  });

  test("summarises and upserts, passing the action through", async () => {
    praxisRepo.findConversation.mockResolvedValue(conv);
    praxisRepo.listMessages.mockResolvedValue([
      { role: "user", content: "I want a UK popup." },
      { role: "assistant", content: "Here are the feasibility angles." },
    ]);
    governance.canUseFeature.mockResolvedValue({ ok: true });
    llmRouter.chatWithFailover.mockResolvedValue({
      content: "### TITLE\nUK popup\n\n### BODY\n## Overview\n- popup plan",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      vendor: "deepseek",
      model: "deepseek-chat",
    });
    notesRepo.upsertCosNote.mockResolvedValue({
      note: { note_id: "n1", title: "UK popup" },
      action: "updated",
    });

    const out = await cos.saveConversationAsNote({
      user,
      brand: "pixiegirl",
      request_id: "r",
      id: "c1",
    });

    expect(out.action).toBe("updated");
    expect(out.note.note_id).toBe("n1");
    expect(notesRepo.upsertCosNote).toHaveBeenCalledWith(
      expect.objectContaining({
        business: "pixiegirl",
        user_id: "u1",
        conversation_id: "c1",
        title: "UK popup",
      }),
    );
  });

  test("404s a conversation that isn't the caller's CoS thread", async () => {
    praxisRepo.findConversation.mockResolvedValue({
      conversation_id: "c1",
      user_id: "someone-else",
      kind: "chief_of_staff",
    });
    await expect(
      cos.saveConversationAsNote({ user, brand: "pixiegirl", request_id: "r", id: "c1" }),
    ).rejects.toThrow();
  });
});
