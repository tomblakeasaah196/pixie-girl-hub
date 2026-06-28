# PDF Rendering — Setup & Reference

How to add **server-side PDF generation** (invoices, receipts, payslips,
reports, delivery notes…) to a Node backend, the way Pixie Girl Hub does it —
and, more importantly, how to avoid the trap that made PDFs work locally but
fail on the live server with a bare **"PDF failed"**.

> **The one-sentence lesson:** PDFs are rendered by a real headless **Chrome/
> Chromium binary running on the server**. If that binary isn't installed *on
> the machine that actually runs your app*, every render fails — no matter how
> good the code is. Your laptop has a browser; a fresh VPS does not.

---

## 1. How it works (architecture)

```
HTML string  ──►  Puppeteer (headless Chrome)  ──►  PDF Buffer
                                                      │
                                                      ▼
                            documents.store()  ──►  disk (/media/...) + DB row
                                                      │
                                                      ▼
                              API returns { url }  ──►  browser downloads it
```

1. A module builds a **self-contained HTML string** (inline CSS, no external
   anything — see §4).
2. `pdf.service.renderHtmlToPdf(html)` launches/reuses one Chromium instance and
   prints the HTML to a PDF `Buffer`.
3. `documents.store()` writes the bytes to storage and registers a row, returning
   a `url` (e.g. `/media/<brand>/documents/<number>.pdf`).
4. The frontend fetches that url and saves it as a real download.

Reference files in this repo:

| Concern | File |
| --- | --- |
| Browser launch + render | `src/services/pdf.service.js` |
| Self-contained document templates | `src/services/pdf.brand-docs.js`, `src/services/pdf.templates.js` |
| Persisting + serving the file | `src/shared/documents/documents.service.js`, `src/services/storage.service.js`, `src/server.js` (`/media` static mount) |
| Frontend download helper | `apps/admin/src/lib/api.ts` → `saveFileFromUrl()` |
| Production deploy (installs Chrome) | `.github/workflows/ci.yml` |

---

## 2. The non-negotiable: Chrome must exist on the run host

This is where 90% of "works locally, fails live" PDF bugs come from.

- **Locally** it works because your dev machine has Chrome installed, or
  `npm install` let Puppeteer download its bundled Chromium.
- **On the server** it only works if a Chrome/Chromium binary is present on the
  *exact machine/container that runs the Node process*.

Two ways to guarantee that — pick the one matching your deploy:

### A. Docker (recommended) — install Chromium in the image

```dockerfile
# Alpine: the bundled Puppeteer Chromium is glibc-only and won't run on musl,
# so install the distro package and point Puppeteer at it.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

> Debian/Ubuntu base images: `apt-get install -y chromium` (or
> `google-chrome-stable`) instead.

### B. Bare VPS (SSH + PM2/systemd) — install Chrome on the host once

**This is the trap.** A VPS deploy that runs `npm install` with
`PUPPETEER_SKIP_DOWNLOAD=true` (to keep installs fast) gets **no browser at
all** unless you install one yourself. A `Dockerfile` that installs Chromium
does **nothing** here — it's never built on this path.

Install it once:

```bash
cd /tmp
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get update
sudo apt-get install -y ./google-chrome-stable_current_amd64.deb   # pulls all shared libs
google-chrome-stable --version
```

…and make the deploy self-heal so it never regresses (from
`.github/workflows/ci.yml`):

```bash
echo "--- Ensuring headless Chrome is installed (PDF rendering)"
if command -v google-chrome-stable >/dev/null 2>&1 \
   || command -v chromium >/dev/null 2>&1 \
   || command -v chromium-browser >/dev/null 2>&1; then
  echo "Chrome/Chromium already present ✓"
else
  CHROME_DEB="$(mktemp --suffix=.deb)"
  if curl -fsSL -o "$CHROME_DEB" \
       https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
     && sudo apt-get update -y && sudo apt-get install -y "$CHROME_DEB"; then
    echo "Installed $(google-chrome-stable --version) ✓"
  else
    echo "WARNING: could not install Chrome — PDF rendering will stay disabled."
  fi
  rm -f "$CHROME_DEB"
fi
```

> **No sudo?** Use `npx puppeteer browsers install chrome` (downloads into
> `~/.cache/puppeteer`, auto-detected by Puppeteer) and install the OS libs
> Chrome needs (`libnss3 libatk-bridge2.0-0 libgbm1 libasound2 fonts-liberation`
> …). The `.deb` route is more reliable because apt resolves those for you.

---

## 3. Launching Chromium reliably

`src/services/pdf.service.js` does three important things:

1. **Auto-detects the binary** instead of trusting one hard-coded path — distro
   paths differ (`/usr/bin/chromium` vs `/usr/bin/chromium-browser` vs
   `/usr/bin/google-chrome-stable` vs `/snap/bin/chromium`):

   ```js
   const candidates = [
     config.PUPPETEER_EXECUTABLE_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
     "/usr/bin/chromium", "/usr/bin/chromium-browser",
     "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome",
     "/snap/bin/chromium",
   ].filter(Boolean);
   const executablePath = candidates.find((p) => fs.existsSync(p)) || undefined;
   ```

2. **Uses server-safe launch flags** (containers/VPS have no GPU and a tiny
   `/dev/shm`):

   ```js
   args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
          "--disable-gpu", "--disable-software-rasterizer"]
   ```

3. **Surfaces the real failure cause** and lets the next request retry:

   ```js
   throw new AppError("PDF_UNAVAILABLE",
     `Could not launch Chromium for PDF rendering: ${cause}`, 503, ...);
   // browserPromise is reset to null on failure, so a later request re-launches
   // (no process restart needed after you install Chrome).
   ```

One browser instance is launched lazily and reused for the whole process;
`page` objects are created/closed per render.

---

## 4. The render must not depend on the network

Headless Chrome will happily wait for a remote font or image. On a locked-down
server with restricted egress, that wait hangs until the render timeout and the
whole PDF fails. Two rules:

1. **Templates are 100% self-contained.** No `<link>`, no `@import`, no
   `<script>`, no Google Fonts. Name brand fonts first and fall back to system
   fonts: `font-family:'Playfair Display',Georgia,serif`.

2. **Don't block on `networkidle0`.** Wait for the DOM, then give images a
   *bounded* chance to load so an unreachable logo can't hang the render:

   ```js
   await page.setContent(html, { waitUntil: "domcontentloaded",
                                 timeout: config.PDF_RENDER_TIMEOUT_MS });
   // let <img> (e.g. a brand logo) load, but never block > 2s on one that
   // will never arrive — a missing logo must not fail the document.
   await page.evaluate(() => new Promise((resolve) => {
     const pending = [...document.images].filter((i) => !i.complete);
     if (!pending.length) return resolve();
     let n = 0; const done = () => { if (++n >= pending.length) resolve(); };
     pending.forEach((i) => { i.addEventListener("load", done);
                              i.addEventListener("error", done); });
     setTimeout(resolve, 2000);
   })).catch(() => {});
   ```

> If you need remote logos to reliably appear, fetch + inline them as a
> `data:` URI **before** rendering (with a short timeout), rather than letting
> Chrome fetch them mid-render.

---

## 5. The frontend download (avoid the silent failure)

Two bugs we hit, both worth copying the fixes for:

1. **Don't `window.open()` after an `await`.** A popup opened outside the
   direct click handler is silently blocked by HTTPS popup blockers — the file
   "just doesn't download" with no error. Fetch the bytes and save via an
   `<a download>` instead (`apps/admin/src/lib/api.ts`):

   ```ts
   export async function saveFileFromUrl(url: string, filename: string) {
     try {
       const res = await fetch(url, { credentials: "include" });
       if (!res.ok) throw new Error(`HTTP ${res.status}`);
       const objectUrl = URL.createObjectURL(await res.blob());
       const a = document.createElement("a");
       a.href = objectUrl; a.download = filename;
       document.body.appendChild(a); a.click(); a.remove();
       URL.revokeObjectURL(objectUrl);
     } catch {
       window.open(url, "_blank", "noopener"); // fallback (e.g. cross-origin CDN)
     }
   }
   ```

2. **Surface the real error** — never swallow it in a bare `catch`. The backend
   already puts the cause in the message (`PDF_UNAVAILABLE`, `Could not launch
   Chromium`, …); show it so failures are diagnosable from the UI:

   ```ts
   catch (err) {
     toast("PDF Failed", err instanceof Error ? err.message : "Failed to generate the PDF.");
   }
   ```

---

## 6. Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `PDF_ENABLED` | `true` | Master switch. When false, renders throw a clean 503 instead of launching Chrome. |
| `PUPPETEER_EXECUTABLE_PATH` | (auto-detect) | Force a specific Chrome binary. Optional — auto-detection covers common paths. |
| `PUPPETEER_SKIP_DOWNLOAD` / `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | — | Set to `true` when you install Chrome via the OS (Docker/VPS) so `npm install` doesn't also download a bundled copy. **If you set these, you MUST install Chrome another way.** |
| `PDF_RENDER_TIMEOUT_MS` | `30000` | Per-render timeout. |
| `STORAGE_LOCAL_ROOT` | `./media` | Where generated files are written. |
| `CDN_BASE_URL` | (unset) | If set, files get absolute CDN urls; if unset, relative `/media/...` served by the app. |

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Could not launch Chromium` / "PDF failed" on live only | No Chrome on the run host | Install Chrome (§2B) or build it into the image (§2A) |
| Render hangs then times out | Template loads a remote font/image; waiting on `networkidle0` | Make template self-contained; use `domcontentloaded` + bounded image wait (§4) |
| "PDF rendering is disabled" | `PDF_ENABLED=false` | Set it true in the server env |
| Generates fine but "doesn't download" | `window.open()` after `await` blocked by popup blocker | Use `saveFileFromUrl()` (§5) |
| Download 404s | File written on one instance, served from another (multi-instance + ephemeral disk) | Use shared storage (volume / object store) or serve via the same instance |
| Chrome installed but still won't launch | Missing shared libs | Install via the `.deb` (resolves deps) or add `libnss3 libgbm1 libasound2 fonts-liberation …` |

### Fastest live diagnosis
Open DevTools → **Network**, trigger the download, click the `…/pdf` request,
read the **Response** body. The backend puts the real reason there — you don't
need server access to find out why.

---

## 8. New-project checklist

- [ ] `puppeteer` in `dependencies`.
- [ ] Chrome/Chromium installed on **every** run target (Docker image **and**
      any VPS/PaaS host) — verify with `which google-chrome-stable || which chromium`.
- [ ] If you skip Puppeteer's bundled download, you installed Chrome another way.
- [ ] Launch with `--no-sandbox --disable-dev-shm-usage` (+ auto-detect path).
- [ ] Templates are self-contained (no external fonts/CSS/JS); render with
      `domcontentloaded` + bounded image wait.
- [ ] Frontend downloads via fetch + `<a download>`, and shows the real error.
- [ ] Deploy step installs/verifies Chrome so it can't regress.
- [ ] Smoke test on the live host, not just locally.
