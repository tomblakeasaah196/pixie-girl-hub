/**
 * Expense Receipt AI (V2.2 §6.7 + §6.31) — inline Praxis capture.
 *
 * "Upload a receipt/invoice photo or PDF + an optional voice note → a suggested
 * draft expense you review before it's created." Everything lives INSIDE the
 * Expenses module — this never bounces the user out to the Praxis chat.
 *
 * Pipeline per scan (one endpoint, one round-trip):
 *   1. LISTEN   — if a voice clip is attached, Groq Whisper transcribes it
 *                 (transcription.service). The transcript + any typed note are
 *                 the staff's own words about what the money was for.
 *   2. PERCEIVE — Gemini Flash vision reads the receipt into strict JSON:
 *                 vendor, date, total, VAT, and line items — each mapped to
 *                 ONE of the brand's REAL expense categories (closed enum, the
 *                 same "never invent a value" guard the Shade Finder uses).
 *   3. SUGGEST  — the parsed draft is returned to the client. NOTHING is
 *                 written to the DB here: the user reviews/edits the card, then
 *                 the existing create → submit path does the actual write with
 *                 all its normal workflow + GL controls intact.
 *
 * Governance: gated by the `expense_receipt_ai` feature flag and metered per
 * brand + user through ai-run.service (success AND failure both hit the
 * ledger). Cost dies on the internal budget cap like every other staff AI
 * feature. The receipt/voice bytes are processed in memory and never persisted
 * by this service — persistence only happens later, if the user creates the
 * expense and the existing addReceipt flow stores the file.
 */

"use strict";

const repo = require("./expenses.repo");
const aiRun = require("../../services/ai-run.service");
const transcription = require("../../services/transcription.service");
const { compressImage } = require("../../services/media-compression.service");
const governance = require("../ai_governance/governance.service");
const { money, toCurrencyString } = require("../../utils/money");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const FEATURE_KEY = "expense_receipt_ai";
const MAX_DOC_BYTES = 15 * 1024 * 1024; // Gemini inline request ceiling headroom.

/** Africa/Lagos is a fixed UTC+1 (no DST) — the businesses' local "today". */
function lagosToday() {
  return new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
}

/** A yyyy-mm-dd string, or null. Guards against a model hallucinating a date. */
function normaliseDate(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : iso;
}

/** Non-negative money string ("0.00" floor), or "0.00" for junk input. */
function safeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return toCurrencyString(money(n));
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text || "").match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Prepare the uploaded receipt for the vision call, in memory only.
 *   - image → HEIC-decode + EXIF-strip via the shared compressor, then
 *     downscale to ≤1600px JPEG so token cost stays sane.
 *   - PDF   → passed through as inline application/pdf (Gemini reads it
 *     natively; no rasterising needed).
 * Returns a Gemini content part ({ type, mime_type, data }).
 */
async function prepareDocumentPart({ buffer, mime, filename }) {
  if (!buffer || !buffer.length) {
    throw new AppError("NO_FILE", "The receipt file is empty.", 400, {
      user_message: "That file looked empty — try uploading the receipt again.",
    });
  }
  if (buffer.length > MAX_DOC_BYTES) {
    throw new AppError("FILE_TOO_LARGE", "receipt exceeds inline ceiling", 413, {
      user_message:
        "That file is a bit large for Praxis to read — please upload a smaller photo or PDF (under 15MB).",
    });
  }
  if (mime === "application/pdf") {
    return { type: "file", mime_type: "application/pdf", data: buffer.toString("base64") };
  }
  // Everything else is treated as an image (covers jpeg/png/webp/heic/…).
  // sharp is a native module lazy-loaded only on the image path — a PDF receipt
  // never needs it, and the module loads fine in environments without it built.
  const sharp = require("sharp");
  const pre = await compressImage(buffer, mime, filename);
  const out = await sharp(pre.buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { type: "image", mime_type: "image/jpeg", data: out.toString("base64") };
}

function buildSchema(categoryKeys) {
  const lineProps = {
    description: { type: "STRING" },
    amount_ngn: { type: "NUMBER" },
    vendor_name: { type: "STRING" },
  };
  // An empty enum is invalid — only constrain the category when the brand has
  // some. With none, the model returns a free string we simply won't match,
  // and the UI forces the user to pick one (or create one) before submit.
  if (categoryKeys.length) {
    lineProps.category_key = { type: "STRING", enum: categoryKeys };
  } else {
    lineProps.category_key = { type: "STRING" };
  }
  return {
    type: "OBJECT",
    properties: {
      is_receipt: { type: "BOOLEAN" },
      title: { type: "STRING" },
      vendor_name: { type: "STRING" },
      expense_date: { type: "STRING" },
      currency: { type: "STRING", enum: ["NGN", "USD", "GBP", "EUR", "OTHER"] },
      total_amount_ngn: { type: "NUMBER" },
      vat_amount_ngn: { type: "NUMBER" },
      lines: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: lineProps,
          required: ["description", "amount_ngn"],
        },
      },
      confidence: { type: "STRING", enum: ["low", "medium", "high"] },
      notes: { type: "STRING" },
    },
    required: ["is_receipt", "title", "total_amount_ngn", "confidence"],
  };
}

function buildSystemPrompt({ categories, staffNote }) {
  const catBlock = categories.length
    ? categories
        .map(
          (c) =>
            `- ${c.category_key}: ${c.display_name}` +
            (c.description ? ` — ${c.description}` : ""),
        )
        .join("\n")
    : "(no categories are configured yet — leave category_key empty)";
  return [
    "You are Praxis, reading a business expense receipt or invoice for a",
    "Nigerian company so a staff member can log it as an expense. Extract the",
    "spend into strict JSON matching the schema.",
    "",
    "RULES:",
    "- Amounts are in Nigerian Naira (₦) unless the receipt clearly shows a",
    "  different currency; put the numeric amount in the *_ngn fields and set",
    "  `currency` to what you actually saw. Do NOT convert currencies.",
    "- `total_amount_ngn` is the grand total actually paid. `vat_amount_ngn` is",
    "  the VAT/tax portion if the receipt breaks it out, else 0.",
    "- `expense_date` is the receipt/invoice date as YYYY-MM-DD. If none is",
    "  legible, use today's date given below.",
    "- Split into `lines` only when the receipt is clearly itemised; otherwise",
    "  return a single line whose amount equals the total.",
    "- Map each line to the SINGLE best-fitting category_key from the list",
    "  below. Only use a key from the list — never invent one. If nothing fits,",
    "  leave category_key empty.",
    "- Write a short human `title` (e.g. 'Fuel — Total filling station').",
    "- Set `is_receipt` false if the image is clearly NOT a receipt, invoice,",
    "  or proof of payment, and briefly say why in `notes`.",
    "- Lower `confidence` when the image is blurry, cropped, or ambiguous.",
    "",
    `Today is ${lagosToday()} (Africa/Lagos).`,
    "",
    "AVAILABLE EXPENSE CATEGORIES (key: name — meaning):",
    catBlock,
    staffNote
      ? "\nThe staff member also described this spend in their own words " +
        "(use it to pick the title, description and category, but never let it " +
        `override numbers you can read on the receipt):\n"${staffNote}"`
      : "",
    "\nRespond with JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Read a receipt (+ optional voice note / typed note) into a suggested draft
 * expense. Writes NOTHING — returns a payload the client renders for review.
 *
 * @param {object} args
 * @param {string} args.brand
 * @param {object} args.user            { user_id, is_ceo }
 * @param {object} args.file            multer file (image or PDF), required
 * @param {object} [args.audio]         multer file (voice note), optional
 * @param {string} [args.note]          typed note, optional
 */
async function extractFromReceipt({ brand, user, file, audio, note }) {
  if (!file || !file.buffer) {
    throw new AppError("NO_FILE", "A receipt file is required.", 400, {
      user_message: "Attach a receipt photo or PDF for Praxis to read.",
    });
  }

  // Governance gate — flag enabled, per-brand toggle, grant (CEO bypass),
  // per-user daily cap, internal budget cap. Staff see the technical reason.
  const guard = await governance.canUseFeature({
    user_id: user.user_id,
    feature_key: FEATURE_KEY,
    is_ceo: user.is_ceo,
    business: brand,
  });
  if (!guard.ok) {
    throw new AppError("AI_UNAVAILABLE", `expense receipt AI gated: ${guard.reason}`, 503, {
      user_message:
        "Receipt reading is unavailable right now — you can still record the expense manually.",
    });
  }

  // 1. LISTEN — transcribe the voice note if one was attached. A transcription
  // miss is non-fatal: we fall back to the typed note (or nothing).
  let transcript = null;
  if (audio && audio.buffer && audio.buffer.length) {
    try {
      const result = await transcription.transcribeBuffer({
        buffer: audio.buffer,
        contentType: audio.mimetype,
        filename: audio.originalname || "voice-note",
      });
      transcript = result && result.text ? result.text.trim() : null;
    } catch (err) {
      logger.warn({ err: err.message }, "expense receipt: voice transcription failed");
    }
  }
  const staffNote = [transcript, note && note.trim()].filter(Boolean).join("\n");

  // 2. PERCEIVE — Gemini vision → strict JSON.
  const categories = (await repo.listCategories({ brand })).filter(
    (c) => c.is_active,
  );
  const categoryKeys = categories.map((c) => c.category_key);
  const docPart = await prepareDocumentPart({
    buffer: file.buffer,
    mime: file.mimetype,
    filename: file.originalname,
  });

  const completion = await aiRun.runGeminiCall({
    feature_key: FEATURE_KEY,
    business: brand,
    user_id: user.user_id,
    call_type: "chat_completion",
    gemini: {
      system: buildSystemPrompt({ categories, staffNote }),
      messages: [
        {
          role: "user",
          content: [
            docPart,
            {
              type: "text",
              text: staffNote
                ? "Read this receipt and log the expense."
                : "Read this receipt and log the expense (no staff note provided).",
            },
          ],
        },
      ],
      temperature: 0.15,
      maxOutputTokens: 2048,
      responseSchema: buildSchema(categoryKeys),
      // Structured extraction, not reasoning — without this Gemini 2.5's default
      // thinking can eat the whole output budget and return an empty reply.
      thinkingBudget: 0,
    },
  });

  const parsed = parseModelJson(completion.text);
  if (!parsed) {
    logger.warn(
      { model: completion.model, len: (completion.text || "").length },
      "expense receipt: model reply empty or unparseable",
    );
    throw new AppError("AI_UNAVAILABLE", "receipt parse failed", 503, {
      user_message:
        "Praxis couldn't read that receipt — try a clearer photo, or record the expense manually.",
    });
  }

  // 3. SUGGEST — map the extraction to the brand's real categories and return a
  // draft-shaped payload. No DB write.
  const byKey = new Map(categories.map((c) => [c.category_key, c]));
  const rawLines = Array.isArray(parsed.lines) && parsed.lines.length
    ? parsed.lines
    : [
        {
          description: parsed.title || "Expense",
          amount_ngn: parsed.total_amount_ngn,
          category_key: null,
          vendor_name: parsed.vendor_name,
        },
      ];

  const lines = rawLines.map((l) => {
    const cat = l.category_key ? byKey.get(l.category_key) : null;
    return {
      description: (l.description || parsed.title || "Expense").slice(0, 500),
      amount_ngn: safeAmount(l.amount_ngn),
      vat_amount_ngn: "0.00",
      vendor_name: (l.vendor_name || parsed.vendor_name || "").slice(0, 200) || null,
      category_id: cat ? cat.category_id : null,
      category_key: cat ? cat.category_key : null,
      category_display: cat ? cat.display_name : null,
    };
  });

  // Fold the receipt-level VAT onto the first line so the create contract
  // (VAT is per-line) stays balanced.
  if (lines.length) lines[0].vat_amount_ngn = safeAmount(parsed.vat_amount_ngn);

  const currency =
    typeof parsed.currency === "string" ? parsed.currency.toUpperCase() : "NGN";

  return {
    is_receipt: parsed.is_receipt !== false,
    title: (parsed.title || "Expense").slice(0, 200),
    vendor_name: (parsed.vendor_name || "").slice(0, 200) || null,
    expense_date: normaliseDate(parsed.expense_date) || lagosToday(),
    currency,
    currency_is_ngn: currency === "NGN",
    total_amount_ngn: safeAmount(parsed.total_amount_ngn),
    vat_amount_ngn: safeAmount(parsed.vat_amount_ngn),
    confidence: ["low", "medium", "high"].includes(parsed.confidence)
      ? parsed.confidence
      : "low",
    notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 1000) : null,
    transcript: transcript || null,
    lines,
  };
}

module.exports = {
  extractFromReceipt,
  FEATURE_KEY,
  // exported for unit tests
  _internal: { normaliseDate, safeAmount, parseModelJson, buildSchema, lagosToday },
};
