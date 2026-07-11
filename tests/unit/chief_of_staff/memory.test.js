"use strict";

/**
 * Chief of Staff RAG memory (cos.memory.js) — pure chunk-text builders, the
 * owner-scoping metadata that keeps one CEO's memory out of another's retrieval,
 * and graceful degradation when no embeddings vendor is configured.
 */

jest.mock("../../../src/services/embeddings.service", () => ({ isConfigured: jest.fn() }));
jest.mock("../../../src/ai/rag-pipeline", () => ({ embedText: jest.fn() }));
jest.mock("../../../src/modules/chief_of_staff/cos.memory.repo", () => ({
  upsertChunk: jest.fn(),
  deleteChunksForSubject: jest.fn(),
  retrieveCosChunks: jest.fn(),
}));
jest.mock("../../../src/jobs/queue-producer", () => ({ enqueue: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const embeddings = require("../../../src/services/embeddings.service");
const rag = require("../../../src/ai/rag-pipeline");
const repo = require("../../../src/modules/chief_of_staff/cos.memory.repo");
const { enqueue } = require("../../../src/jobs/queue-producer");
const memory = require("../../../src/modules/chief_of_staff/cos.memory");

beforeEach(() => jest.clearAllMocks());

describe("pure chunk-text builders", () => {
  test("goalChunkText carries status/health/progress + milestones", () => {
    const text = memory.goalChunkText({
      goal: { title: "Launch accessories", status: "active", priority: "high", health: "at_risk", progress_pct: 40, target_date: "2026-08-31" },
      milestones: [{ status: "done", title: "Supplier", target_date: "2026-06-15" }],
    });
    expect(text).toMatch(/Launch accessories/);
    expect(text).toMatch(/at_risk/);
    expect(text).toMatch(/40%/);
    expect(text).toMatch(/\[done\] Supplier/);
  });

  test("chunkMetadata stamps the owner as the retrieval scope key", () => {
    const a = memory.chunkMetadata({ user_id: "U1", subject_type: "goal", subject_id: "g1" });
    const b = memory.chunkMetadata({ user_id: "U2", subject_type: "goal", subject_id: "g1" });
    expect(a.user_id).toBe("U1");
    expect(b.user_id).toBe("U2");
    expect(a.user_id).not.toBe(b.user_id); // isolation key differs per user
  });
});

describe("retrieve — graceful degradation", () => {
  test("returns [] when no embeddings vendor is configured", async () => {
    embeddings.isConfigured.mockReturnValue(false);
    const out = await memory.retrieve({ user: { user_id: "U1" }, brand: "pixiegirl", queryText: "how is X" });
    expect(out).toEqual([]);
    expect(rag.embedText).not.toHaveBeenCalled();
  });

  test("returns [] when the query can't be embedded", async () => {
    embeddings.isConfigured.mockReturnValue(true);
    rag.embedText.mockResolvedValue(null);
    const out = await memory.retrieve({ user: { user_id: "U1" }, brand: "pixiegirl", queryText: "how is X" });
    expect(out).toEqual([]);
  });

  test("scopes retrieval to the requesting user + brand", async () => {
    embeddings.isConfigured.mockReturnValue(true);
    rag.embedText.mockResolvedValue([0.1, 0.2, 0.3]);
    repo.retrieveCosChunks.mockResolvedValue([{ content: "mem" }]);
    await memory.retrieve({ user: { user_id: "U1" }, brand: "pixiegirl", queryText: "how is X", topK: 5 });
    expect(repo.retrieveCosChunks).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "U1", business: "pixiegirl", topK: 5 }),
    );
  });
});

describe("indexGoal", () => {
  test("upserts a cos_goal chunk owned by the goal owner and enqueues an embed", async () => {
    repo.upsertChunk.mockResolvedValue({ chunk_id: "c1", changed: true });
    await memory.indexGoal({
      goal: { goal_id: "g1", title: "G", status: "active", priority: "normal", health: "on_track", owner_user_id: "OWNER" },
      milestones: [],
      brand: "pixiegirl",
    });
    expect(repo.upsertChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: "cos_goal",
        source_ref: "g1",
        business: "pixiegirl",
        metadata: expect.objectContaining({ user_id: "OWNER" }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith("ai-embed", "embed", expect.objectContaining({ source_id: "c1", sensitivity: "restricted" }));
  });

  test("skips the embed when content is unchanged", async () => {
    repo.upsertChunk.mockResolvedValue({ chunk_id: "c1", changed: false });
    await memory.indexGoal({
      goal: { goal_id: "g1", title: "G", status: "active", priority: "normal", health: "on_track", created_by: "OWNER" },
      milestones: [],
      brand: "pixiegirl",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
