/**
 * Chief of Staff (PR3) — domain events.
 *
 * A thin EventEmitter, mirroring praxis.events. Realtime + accountability
 * subscribers (PR4) listen here; the service/executor emit. Kept side-effect
 * free so unit tests can require the module without a socket/DB.
 */

"use strict";

const { EventEmitter } = require("events");

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

module.exports = {
  emit: (event, payload) => emitter.emit(event, payload),
  on: (event, handler) => emitter.on(event, handler),
  off: (event, handler) => emitter.off(event, handler),
  emitter,
};
