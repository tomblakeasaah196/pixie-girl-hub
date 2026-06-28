# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
# chromium + shared libs/fonts: PDF rendering (invoices, reports, payslips) goes
# through src/services/pdf.service.js (Puppeteer) from both the API process
# (runtime) and the BullMQ worker (report-processor.js), so both stages need a
# working headless Chromium. Alpine's puppeteer-bundled Chromium download is
# glibc-only and fails to launch on musl, so we install the distro package
# instead and point Puppeteer at it (PUPPETEER_EXECUTABLE_PATH below) while
# skipping its own download during `npm ci`. ttf-freefont gives PDF output
# (e.g. the ₦ Naira sign in pdf.templates.js) broad glyph coverage.
RUN apk add --no-cache \
      ffmpeg postgresql-client tini \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont
# Alpine's chromium package installs the binary at /usr/bin/chromium (the legacy
# /usr/bin/chromium-browser name no longer exists on current Alpine). pdf.service
# also auto-detects the real path, so a mismatch here no longer breaks rendering.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]

FROM base AS worker
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV ENABLE_WORKERS=true
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/jobs/worker.js"]
