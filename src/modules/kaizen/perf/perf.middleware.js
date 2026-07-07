/**
 * Kaizen perf middleware — times every request and feeds the in-memory
 * reservoir (perf.service). Install EARLY in server.js (after request-id, before
 * routers) so it wraps the whole handler chain. Keep it cheap: it only reads the
 * clock and derives a route pattern on 'finish'; the heavy rollup work happens
 * on the self-flush timer.
 */

"use strict";

const service = require("./perf.service");
const { routePatternOf } = require("../errors/errors.capture");

function perfMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      // req.route is populated by the time 'finish' fires on a matched route.
      const routePattern = routePatternOf(req);
      service.record({
        method: req.method,
        routePattern,
        durationMs,
        status: res.statusCode,
      });
    } catch {
      /* never let perf accounting break a response */
    }
  });
  next();
}

module.exports = { perfMiddleware, startAutoFlush: service.startAutoFlush };
