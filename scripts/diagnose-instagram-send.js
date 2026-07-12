/**
 * Instagram send diagnostics — pins down WHY sends bounce with Meta's
 * opaque "Invalid message id" (code 508, subcode 2534122) by sending a
 * short series of controlled probes through the real brand token and
 * printing Meta's raw verdict for each.
 *
 * What one run tells you, definitively:
 *   - whether ffmpeg is usable (without it every voice note silently
 *     degrades to a TEXT MESSAGE CONTAINING A LINK — see
 *     instagram-processor's transcode fallback — so "voice notes fail"
 *     can actually be "links fail" in disguise);
 *   - whether Meta's crawlers can fetch from YOUR public domain
 *     (Cloudflare bot protection 403s are invisible from a browser);
 *   - whether Instagram refuses ALL links to this recipient (thread /
 *     follow state), or only links to YOUR domain, or audio, or images.
 *
 * SAFE-GUARD: it never messages anyone implicitly. Run without --igsid
 * to LIST recent Instagram threads (name + IGSID + window state), then
 * re-run pointing at your own test account's thread.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/diagnose-instagram-send.js                          # list threads (faitlynhair)
 *   node scripts/diagnose-instagram-send.js --brand=pixiegirl        # list threads (other brand)
 *   node scripts/diagnose-instagram-send.js --igsid=1234567890 --brand=faitlynhair
 *   node scripts/diagnose-instagram-send.js --igsid=... --skip-sends # env checks only
 */

"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const axios = require("axios");
const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { config } = require("../src/config/env");
const instagram = require("../src/services/instagram.service");
const storage = require("../src/services/storage.service");
const ffmpeg = require("../src/jobs/processors/media.ffmpeg");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const BRAND = args.brand || "faitlynhair";
const IGSID = args.igsid || process.env.IG_PROBE_RECIPIENT || null;
const SKIP_SENDS = !!args["skip-sends"];
const GAP_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (c = "─") => console.log(c.repeat(64));

// Meta's link-preview / media crawlers. Cloudflare treats these as bots;
// if your WAF blocks them, Meta can neither scan a link you send nor
// fetch an attachment URL — and the send dies server-side at Meta.
const META_UAS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
];

const results = []; // { name, ok, detail }
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function listThreads() {
  const { rows } = await query(
    `SELECT c.channel_id, c.business, c.external_thread_ref,
            c.ig_window_expires_at, c.last_message_at,
            COALESCE(con.display_name, h.display_name, h.handle, '(unknown)') AS who
       FROM shared.message_channels c
       LEFT JOIN shared.channel_members cm
              ON cm.channel_id = c.channel_id AND cm.contact_id IS NOT NULL
       LEFT JOIN shared.contacts con ON con.contact_id = cm.contact_id
       LEFT JOIN LATERAL (
         SELECT sh.display_name, sh.handle
           FROM shared.contact_social_handles sh
          WHERE sh.contact_id = cm.contact_id AND sh.platform = 'instagram'
          ORDER BY (sh.external_user_id IS NOT NULL) DESC, sh.updated_at DESC
          LIMIT 1
       ) h ON true
      WHERE c.channel_type = 'customer_thread'
        AND c.external_platform = 'instagram'
        AND c.business = $1
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT 15`,
    [BRAND],
  );
  console.log(`\nRecent Instagram threads for brand '${BRAND}':\n`);
  for (const r of rows) {
    const win =
      r.ig_window_expires_at && new Date(r.ig_window_expires_at) > new Date()
        ? `window open until ${new Date(r.ig_window_expires_at).toISOString()}`
        : "window CLOSED";
    console.log(
      `  ${String(r.who).padEnd(28)} IGSID=${r.external_thread_ref || "(none)"}  ${win}`,
    );
  }
  console.log(
    `\nPick YOUR OWN test account's thread and re-run:\n` +
      `  node scripts/diagnose-instagram-send.js --brand=${BRAND} --igsid=<IGSID>\n`,
  );
}

async function checkFfmpeg() {
  line();
  console.log(`1) ffmpeg at FFMPEG_PATH=${config.FFMPEG_PATH}`);
  try {
    const out = await ffmpeg.run(config.FFMPEG_PATH, ["-version"]);
    record("ffmpeg runnable", true, out.split("\n")[0]);
    return true;
  } catch (err) {
    record("ffmpeg runnable", false, err.message);
    console.log(
      "     ⚠ Every voice note is being DOWNGRADED to a text message\n" +
        "       containing a link (instagram-processor fallback), so voice\n" +
        "       notes inherit whatever link problem exists. Install ffmpeg\n" +
        "       (e.g. apt-get install -y ffmpeg) or point FFMPEG_PATH at it,\n" +
        "       then restart the WORKER process.",
    );
    return false;
  }
}

async function checkCrawlerAccess() {
  line();
  console.log("2) Can Meta's crawlers fetch from your public domain?");
  const key = `diagnostics/probe-${crypto.randomBytes(6).toString("hex")}.png`;
  // 1×1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await storage.put(png, { key, contentType: "image/png" });
  const url = storage.absoluteUrl(key);
  if (!url) {
    record("public media URL buildable", false, "CDN_BASE_URL/ADMIN_BASE_URL unset");
    return { url: null };
  }
  console.log(`   probe file: ${url}`);
  for (const ua of META_UAS) {
    try {
      const res = await axios.get(url, {
        headers: { "User-Agent": ua },
        timeout: 15000,
        validateStatus: () => true,
        maxRedirects: 3,
      });
      record(
        `fetch as ${ua.split("/")[0]}`,
        res.status === 200,
        `HTTP ${res.status}`,
      );
    } catch (err) {
      record(`fetch as ${ua.split("/")[0]}`, false, err.message);
    }
  }
  return { url };
}

function metaDetail(err) {
  if (err.meta_error) {
    const e = err.meta_error;
    return `${e.message} [code ${e.code}${e.error_subcode ? `, subcode ${e.error_subcode}` : ""}${e.fbtrace_id ? `, fbtrace ${e.fbtrace_id}` : ""}]`;
  }
  return err.message;
}

async function probeSend(name, fn) {
  try {
    const res = await fn();
    record(name, true, res && res.message_id ? `mid ${res.message_id}` : "sent");
    return true;
  } catch (err) {
    record(name, false, metaDetail(err));
    return false;
  } finally {
    await sleep(GAP_MS);
  }
}

async function makeSilentM4a() {
  const stamp = crypto.randomBytes(6).toString("hex");
  const outAbs = path.join(os.tmpdir(), `ig-probe-${stamp}.m4a`);
  await ffmpeg.run(config.FFMPEG_PATH, [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-t", "1", "-acodec", "aac", "-b:a", "96k",
    "-movflags", "+faststart", outAbs,
  ]);
  const buf = await fs.readFile(outAbs);
  await fs.unlink(outAbs).catch(() => {});
  const key = `diagnostics/probe-${stamp}.m4a`;
  await storage.put(buf, { key, contentType: "audio/mp4" });
  return storage.absoluteUrl(key);
}

function verdict({ ffmpegOk, p }) {
  line("═");
  console.log("VERDICT");
  if (p.text === false) {
    console.log(
      "  Even plain text fails → recipient/thread/token problem (wrong IGSID,\n" +
        "  closed window, or wrong brand account connected). Fix that first —\n" +
        "  nothing content-related can be concluded yet.",
    );
    return;
  }
  if (p.text && p.extLink === false && p.hubLink === false) {
    console.log(
      "  Plain text delivers but EVERY link is refused → Instagram is\n" +
        "  blocking links on this thread (typical when the recipient doesn't\n" +
        "  follow the account / thread still counts as a message request).\n" +
        "  Product fix: don't DM raw links here — ask the customer to follow\n" +
        "  the account first, or deliver the form via WhatsApp/email/'link in\n" +
        "  bio' instead.",
    );
  } else if (p.text && p.extLink && p.hubLink === false) {
    console.log(
      "  Links deliver EXCEPT yours → hub.pixiegirlglobal.com itself is the\n" +
        "  problem (domain blocked/flagged). Check section 2: if Meta's\n" +
        "  crawler UAs got 403, allow Cloudflare 'verified bots' (or add a\n" +
        "  WAF skip rule for facebookexternalhit / meta-externalagent), then\n" +
        "  re-run this script.",
    );
  }
  if (p.image === false) {
    console.log(
      "  Image attachment refused → Meta cannot fetch media from your\n" +
        "  domain (see section 2) — same Cloudflare/WAF fix.",
    );
  }
  if (!ffmpegOk) {
    console.log(
      "  ffmpeg is unusable → voice notes are currently sent as LINK TEXTS\n" +
        "  and fail for the link reason above. Install ffmpeg + restart the\n" +
        "  worker to make voice notes real audio again.",
    );
  } else if (p.audio === false && p.image !== false) {
    console.log(
      "  Audio refused while image delivers → audio-specific rejection;\n" +
        "  send the fbtrace_id above to Meta support / re-check account\n" +
        "  message settings.",
    );
  }
  if (p.text && p.extLink && p.hubLink && p.image && (p.audio || !ffmpegOk)) {
    console.log(
      "  All probes delivered — the environment is healthy. If the inbox\n" +
        "  still shows 508s, the app processes are running STALE code:\n" +
        "  git pull + restart BOTH the web app AND the worker (pm2 restart).",
    );
  }
}

(async () => {
  try {
    await initDatabase();
    console.log(`Brand: ${BRAND}`);
    if (!(await instagram.isConfigured({ brand: BRAND }))) {
      console.error(`No active Instagram account configured for '${BRAND}'.`);
      process.exitCode = 1;
      return;
    }
    if (!IGSID) {
      await listThreads();
      return;
    }

    const ffmpegOk = await checkFfmpeg();
    const { url: probeImageUrl } = await checkCrawlerAccess();

    const p = {};
    if (!SKIP_SENDS) {
      line();
      console.log(`3) Send probes → IGSID ${IGSID} (brand ${BRAND})`);
      p.text = await probeSend("P1 plain text", () =>
        instagram.sendText({
          brand: BRAND,
          recipient_id: IGSID,
          text: "Probe 1/5 — plain text (diagnostics, please ignore)",
        }),
      );
      p.extLink = await probeSend("P2 text + external link", () =>
        instagram.sendText({
          brand: BRAND,
          recipient_id: IGSID,
          text: "Probe 2/5 — link test: https://www.google.com",
        }),
      );
      const hubBase = (config.ADMIN_BASE_URL || "").replace(/\/+$/, "");
      p.hubLink = await probeSend("P3 text + hub link", () =>
        instagram.sendText({
          brand: BRAND,
          recipient_id: IGSID,
          text: `Probe 3/5 — link test: ${hubBase}/welcome/${BRAND}/probe-token`,
        }),
      );
      if (probeImageUrl) {
        p.image = await probeSend("P4 image attachment (your domain)", () =>
          instagram.sendMedia({
            brand: BRAND,
            recipient_id: IGSID,
            kind: "image",
            media_url: probeImageUrl,
          }),
        );
      }
      if (ffmpegOk) {
        const audioUrl = await makeSilentM4a();
        console.log(`   audio probe file: ${audioUrl}`);
        p.audio = await probeSend("P5 audio attachment (m4a, your domain)", () =>
          instagram.sendMedia({
            brand: BRAND,
            recipient_id: IGSID,
            kind: "audio",
            media_url: audioUrl,
          }),
        );
      } else {
        console.log("   (P5 audio skipped — ffmpeg unusable, see section 1)");
      }
    }
    verdict({ ffmpegOk, p });
  } catch (err) {
    console.error("diagnostics crashed:", err.message);
    process.exitCode = 1;
  } finally {
    await closeDatabase().catch(() => {});
  }
})();
