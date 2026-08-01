"use strict";

/**
 * expenses.ai.service — the inline "receipt → suggested expense" reader.
 *
 * The invariants that matter:
 *   1. The model's category_key is mapped to a REAL category_id; an unknown
 *      key yields null so the UI forces the user to pick (never invents one).
 *   2. Nothing is written — the service only returns a suggestion payload.
 *   3. A voice clip is transcribed and surfaced back as `transcript`.
 *   4. A governance block raises a 503 (staff can still log manually).
 *   5. Amounts + dates are sanitised (no NaN, no hallucinated dates leak).
 *
 * Gemini + Groq + governance are all mocked — this is pure orchestration.
 */

jest.mock("../../../src/services/ai-run.service", () => ({
  runGeminiCall: jest.fn(),
}));
jest.mock("../../../src/services/transcription.service", () => ({
  transcribeBuffer: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  canUseFeature: jest.fn(),
}));
jest.mock("../../../src/modules/expenses/expenses.repo", () => ({
  listCategories: jest.fn(),
}));
// media-compression pulls in the native `sharp` module at import time; the PDF
// path never calls it, so a light mock keeps the suite hermetic.
jest.mock("../../../src/services/media-compression.service", () => ({
  compressImage: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const aiRun = require("../../../src/services/ai-run.service");
const transcription = require("../../../src/services/transcription.service");
const governance = require("../../../src/modules/ai_governance/governance.service");
const repo = require("../../../src/modules/expenses/expenses.repo");
const svc = require("../../../src/modules/expenses/expenses.ai.service");

const USER = { user_id: "u1", is_ceo: false };
// A PDF file skips the sharp/image path entirely — keeps the test hermetic.
const pdfFile = () => ({
  buffer: Buffer.from("%PDF-1.4 fake"),
  mimetype: "application/pdf",
  originalname: "receipt.pdf",
});

const CATS = [
  { category_id: "c-fuel", category_key: "fuel", display_name: "Fuel", is_active: true },
  { category_id: "c-logi", category_key: "logistics", display_name: "Logistics", is_active: true },
  { category_id: "c-off", category_key: "office", display_name: "Office", is_active: false },
];

function modelReturns(obj) {
  aiRun.runGeminiCall.mockResolvedValue({
    text: JSON.stringify(obj),
    model: "gemini-2.5-flash",
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  governance.canUseFeature.mockResolvedValue({ ok: true });
  repo.listCategories.mockResolvedValue(CATS);
  transcription.transcribeBuffer.mockResolvedValue(null);
});

test("maps the model's category_key to a real category_id and returns a suggestion", async () => {
  modelReturns({
    is_receipt: true,
    title: "Fuel — Total",
    vendor_name: "Total Filling Station",
    expense_date: "2026-07-18",
    currency: "NGN",
    total_amount_ngn: 12000,
    vat_amount_ngn: 900,
    confidence: "high",
    lines: [{ description: "Diesel", amount_ngn: 12000, category_key: "fuel" }],
  });

  const out = await svc.extractFromReceipt({ brand: "pixiegirl", user: USER, file: pdfFile() });

  expect(out.title).toBe("Fuel — Total");
  expect(out.expense_date).toBe("2026-07-18");
  expect(out.currency_is_ngn).toBe(true);
  expect(out.lines).toHaveLength(1);
  expect(out.lines[0].category_id).toBe("c-fuel");
  expect(out.lines[0].category_display).toBe("Fuel");
  expect(out.lines[0].amount_ngn).toBe("12000.00");
  // Receipt-level VAT folds onto the first line.
  expect(out.lines[0].vat_amount_ngn).toBe("900.00");
});

test("passes only ACTIVE category keys to the model's enum", async () => {
  modelReturns({
    is_receipt: true,
    title: "x",
    total_amount_ngn: 1,
    confidence: "low",
    lines: [{ description: "x", amount_ngn: 1, category_key: "fuel" }],
  });
  await svc.extractFromReceipt({ brand: "pixiegirl", user: USER, file: pdfFile() });
  const schema = aiRun.runGeminiCall.mock.calls[0][0].gemini.responseSchema;
  const enumKeys = schema.properties.lines.items.properties.category_key.enum;
  expect(enumKeys).toEqual(["fuel", "logistics"]); // 'office' is inactive
});

test("an unmapped category_key yields category_id null (UI must pick)", async () => {
  modelReturns({
    is_receipt: true,
    title: "Mystery",
    total_amount_ngn: 500,
    confidence: "medium",
    lines: [{ description: "??", amount_ngn: 500, category_key: "not_a_real_key" }],
  });
  const out = await svc.extractFromReceipt({ brand: "pixiegirl", user: USER, file: pdfFile() });
  expect(out.lines[0].category_id).toBeNull();
  expect(out.lines[0].category_display).toBeNull();
});

test("transcribes an attached voice note and surfaces it as transcript", async () => {
  transcription.transcribeBuffer.mockResolvedValue({ text: "  fuel for the delivery run  " });
  modelReturns({
    is_receipt: true,
    title: "Fuel",
    total_amount_ngn: 3000,
    confidence: "high",
    lines: [{ description: "Fuel", amount_ngn: 3000, category_key: "fuel" }],
  });
  const out = await svc.extractFromReceipt({
    brand: "pixiegirl",
    user: USER,
    file: pdfFile(),
    audio: { buffer: Buffer.from("clip"), mimetype: "audio/webm", originalname: "c.webm" },
  });
  expect(transcription.transcribeBuffer).toHaveBeenCalledTimes(1);
  expect(out.transcript).toBe("fuel for the delivery run");
  // The transcript rides into the model's system prompt as staff context.
  expect(aiRun.runGeminiCall.mock.calls[0][0].gemini.system).toContain(
    "fuel for the delivery run",
  );
});

test("falls back to a single line when the model returns no line items", async () => {
  modelReturns({
    is_receipt: true,
    title: "Sundry",
    total_amount_ngn: 750,
    confidence: "low",
  });
  const out = await svc.extractFromReceipt({ brand: "pixiegirl", user: USER, file: pdfFile() });
  expect(out.lines).toHaveLength(1);
  expect(out.lines[0].amount_ngn).toBe("750.00");
});

test("sanitises a hallucinated date and a junk amount", async () => {
  modelReturns({
    is_receipt: true,
    title: "x",
    expense_date: "not-a-date",
    total_amount_ngn: "abc",
    confidence: "low",
    lines: [{ description: "x", amount_ngn: -5, category_key: "fuel" }],
  });
  const out = await svc.extractFromReceipt({ brand: "pixiegirl", user: USER, file: pdfFile() });
  expect(out.expense_date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // fell back to today
  expect(out.total_amount_ngn).toBe("0.00");
  expect(out.lines[0].amount_ngn).toBe("0.00"); // negative floored
});

test("flags a non-NGN receipt", async () => {
  modelReturns({
    is_receipt: true,
    title: "Amazon",
    currency: "USD",
    total_amount_ngn: 40,
    confidence: "high",
    lines: [{ description: "cable", amount_ngn: 40, category_key: "office" }],
  });
  const out = await svc.extractFromReceipt({ brand: "pixiegirl", user: USER, file: pdfFile() });
  expect(out.currency).toBe("USD");
  expect(out.currency_is_ngn).toBe(false);
});

test("a governance block raises a 503 and never calls the model", async () => {
  governance.canUseFeature.mockResolvedValue({ ok: false, reason: "FEATURE_DISABLED" });
  await expect(
    svc.extractFromReceipt({ brand: "pixiegirl", user: USER, file: pdfFile() }),
  ).rejects.toMatchObject({ http_status: 503 });
  expect(aiRun.runGeminiCall).not.toHaveBeenCalled();
});

test("requires a receipt file", async () => {
  await expect(
    svc.extractFromReceipt({ brand: "pixiegirl", user: USER, file: null }),
  ).rejects.toMatchObject({ http_status: 400 });
});
