"use strict";

/**
 * CoS feedback service (cos.feedback.service.js) — ownership enforcement, and a
 * 👎-with-comment becoming a durable correction. Repos + memory are mocked.
 */

jest.mock("../../../src/modules/praxis_ai/praxis.repo");
jest.mock("../../../src/modules/chief_of_staff/cos.feedback.repo");
jest.mock("../../../src/modules/chief_of_staff/cos.memory");
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const praxisRepo = require("../../../src/modules/praxis_ai/praxis.repo");
const feedbackRepo = require("../../../src/modules/chief_of_staff/cos.feedback.repo");
const memory = require("../../../src/modules/chief_of_staff/cos.memory");
const service = require("../../../src/modules/chief_of_staff/cos.feedback.service");

const USER = { user_id: "u1", is_ceo: true };

beforeEach(() => {
  jest.clearAllMocks();
  feedbackRepo.upsertFeedback.mockResolvedValue({});
  memory.indexCorrection.mockResolvedValue("chunk-1");
});

function wireOwnedAssistantMessage() {
  praxisRepo.findMessage.mockResolvedValue({ message_id: "m1", conversation_id: "c1", role: "assistant" });
  praxisRepo.findConversation.mockResolvedValue({ conversation_id: "c1", user_id: "u1", kind: "chief_of_staff" });
}

test("a 👎 with a comment is stored AND indexed as a correction", async () => {
  wireOwnedAssistantMessage();
  const out = await service.recordFeedback({
    user: USER,
    brand: "pixiegirl",
    request_id: "r1",
    message_id: "m1",
    rating: "down",
    comment: "Stop scheduling meetings before 10am.",
  });
  expect(out).toEqual({ ok: true, rating: "down", learned: true });
  expect(memory.indexCorrection).toHaveBeenCalledWith(
    expect.objectContaining({ message_id: "m1", user_id: "u1", brand: "pixiegirl" }),
  );
  expect(feedbackRepo.upsertFeedback).toHaveBeenCalledWith(
    expect.objectContaining({ rating: "down", comment: "Stop scheduling meetings before 10am.", taught_chunk_id: "chunk-1" }),
  );
});

test("a plain 👍 records the signal without indexing a correction", async () => {
  wireOwnedAssistantMessage();
  const out = await service.recordFeedback({ user: USER, brand: "pixiegirl", message_id: "m1", rating: "up" });
  expect(out.learned).toBe(false);
  expect(memory.indexCorrection).not.toHaveBeenCalled();
  expect(feedbackRepo.upsertFeedback).toHaveBeenCalledWith(
    expect.objectContaining({ rating: "up", comment: null }),
  );
});

test("another user's conversation is not rateable (ownership enforced)", async () => {
  praxisRepo.findMessage.mockResolvedValue({ message_id: "m1", conversation_id: "c1", role: "assistant" });
  praxisRepo.findConversation.mockResolvedValue({ conversation_id: "c1", user_id: "someone-else", kind: "chief_of_staff" });
  await expect(
    service.recordFeedback({ user: USER, brand: "pixiegirl", message_id: "m1", rating: "up" }),
  ).rejects.toThrow(/message/i);
  expect(feedbackRepo.upsertFeedback).not.toHaveBeenCalled();
});

test("a user message (not an assistant reply) cannot be rated", async () => {
  praxisRepo.findMessage.mockResolvedValue({ message_id: "m1", conversation_id: "c1", role: "user" });
  praxisRepo.findConversation.mockResolvedValue({ conversation_id: "c1", user_id: "u1", kind: "chief_of_staff" });
  await expect(
    service.recordFeedback({ user: USER, brand: "pixiegirl", message_id: "m1", rating: "up" }),
  ).rejects.toThrow(/assistant/i);
});

test("a correction-index hiccup never loses the rating signal", async () => {
  wireOwnedAssistantMessage();
  memory.indexCorrection.mockRejectedValue(new Error("embed down"));
  const out = await service.recordFeedback({
    user: USER,
    brand: "pixiegirl",
    message_id: "m1",
    rating: "down",
    comment: "Wrong tone.",
  });
  expect(out.ok).toBe(true);
  expect(feedbackRepo.upsertFeedback).toHaveBeenCalled(); // signal still stored
});
