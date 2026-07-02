/**
 * Contacts (V2.2 §6.12) — domain events. CRM/Sales/Smartcomm subscribe.
 */

"use strict";

const { createModuleEvents } = require("../events/module-events");

module.exports = createModuleEvents("contacts");
