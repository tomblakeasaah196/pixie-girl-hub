"use strict";

/**
 * Truncation continuation (cut-off fixes). A completion that stops with
 * finish_reason 'length' is continued and the parts stitched, so a long answer
 * (e.g. a 27-row table) is never shipped half-written.
 */

const mockLlm = { chat: jest.fn() };
jest.mock("../../../src/services/llm.service", () => mockLlm);

const {
  extendIfTruncated,
} = require("../../../src/modules/praxis_ai/continuation");

beforeEach(() => jest.clearAllMocks());

const vendor = { vendor: "deepseek" };
const baseMessages = [{ role: "user", content: "list the 27 orders" }];

test("returns the text unchanged when it wasn't truncated", async () => {
  const out = await extendIfTruncated({
    vendor,
    baseMessages,
    text: "All done.",
    finishReason: "stop",
    usage: {},
  });
  expect(out).toBe("All done.");
  expect(mockLlm.chat).not.toHaveBeenCalled();
});

test("continues once and stitches when the answer was cut off", async () => {
  mockLlm.chat.mockResolvedValueOnce({
    content: " row 21…row 27. Done.",
    finish_reason: "stop",
    usage: { prompt_tokens: 5, completion_tokens: 20, total_tokens: 25 },
  });
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const out = await extendIfTruncated({
    vendor,
    baseMessages,
    text: "row 1…row 20,",
    finishReason: "length",
    usage,
  });
  expect(out).toBe("row 1…row 20, row 21…row 27. Done.");
  expect(mockLlm.chat).toHaveBeenCalledTimes(1);
  // usage is accumulated in place
  expect(usage.total_tokens).toBe(27);
});

test("keeps continuing while the vendor keeps hitting the cap, up to the guard", async () => {
  mockLlm.chat
    .mockResolvedValueOnce({ content: "B", finish_reason: "length", usage: {} })
    .mockResolvedValueOnce({ content: "C", finish_reason: "length", usage: {} })
    .mockResolvedValueOnce({ content: "D", finish_reason: "length", usage: {} })
    .mockResolvedValueOnce({
      content: "E",
      finish_reason: "length",
      usage: {},
    });
  const out = await extendIfTruncated({
    vendor,
    baseMessages,
    text: "A",
    finishReason: "length",
    usage: {},
  });
  // MAX_CONTINUATIONS = 4 → A + B + C + D + E, then stops even though still 'length'.
  expect(out).toBe("ABCDE");
  expect(mockLlm.chat).toHaveBeenCalledTimes(4);
});

test("stops (never throws) if a continuation call fails", async () => {
  mockLlm.chat.mockRejectedValueOnce(new Error("boom"));
  const out = await extendIfTruncated({
    vendor,
    baseMessages,
    text: "partial",
    finishReason: "length",
    usage: {},
  });
  expect(out).toBe("partial");
});
