/**
 * Module domain-event factory.
 *
 * Every module exposes the same tiny event surface from its
 * `<mod>.events.js`: an in-process EventEmitter namespaced as
 * `<module>.<eventType>`, with a `*` fan-out channel that the audit/AI/
 * realtime layers subscribe to. This factory is the single implementation;
 * each module's events file is now just:
 *
 *   module.exports = createModuleEvents("sales");
 *
 * Semantics (identical to the previous per-module copies):
 *   - `emit(type, payload)` emits `<ns>.<type>` and a `*` envelope; a
 *     throwing synchronous listener is caught and logged, never propagated
 *     to the emitting service.
 *   - `on(type, handler)` subscribes to `<ns>.<type>`.
 *   - The raw `emitter` is exported for consumers that need `once`/`off`
 *     or the `*` channel directly.
 *
 * NOTE: these are soft, in-process events (lost on crash/restart). Any
 * stateful or financial consumer must go through the transactional outbox
 * (`src/shared/outbox/outbox.js`), not this emitter.
 */

"use strict";

const { EventEmitter } = require("events");
const { logger } = require("../../config/logger");

/**
 * @param {string} namespace  Event prefix, e.g. "sales" → "sales.order.paid".
 * @returns {{ emit: (eventType: string, payload: any) => void,
 *             on: (eventType: string, handler: (payload: any) => void) => void,
 *             emitter: EventEmitter }}
 */
function createModuleEvents(namespace) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  function emit(eventType, payload) {
    const fullType = `${namespace}.${eventType}`;
    try {
      emitter.emit(fullType, payload);
      emitter.emit("*", { type: fullType, payload });
    } catch (err) {
      logger.error(
        { err, eventType: fullType },
        `${namespace} event emit failed`,
      );
    }
  }

  function on(eventType, handler) {
    emitter.on(`${namespace}.${eventType}`, handler);
  }

  return { emit, on, emitter };
}

module.exports = { createModuleEvents };
