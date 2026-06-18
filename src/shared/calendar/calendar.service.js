/**
 * Calendar (V2.2 §6.18) — business logic.
 *
 * One shared calendar per business. Events can be standalone or reference
 * another module's record (service booking, stylist assignment, delivery,
 * CRM deal) via reference_type/id, so all scheduled work surfaces in one
 * place. `createForReference` is the hook other modules use to put their
 * dated records on the calendar.
 */

"use strict";

const repo = require("./calendar.repo");
const events = require("./calendar.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

// PRD §6.18 event vocabulary (schema column is free text; this is the UI list).
const VALID_EVENT_TYPES = [
  "meeting",
  "viewing",
  "follow_up",
  "delivery",
  "task_deadline",
  "leave",
  "reminder",
  "appointment",
  "service_booking",
  "production_milestone",
  "stylist_appointment",
];

function listEvents(args) {
  return repo.listEvents(args);
}
function listForReference({ brand, reference_type, reference_id }) {
  return repo.listEvents({ brand, reference_type, reference_id });
}
async function getEvent({ brand, id }) {
  const event = await repo.findEvent({ brand, id });
  if (!event) throw new NotFoundError("Event");
  const [participants, resources] = await Promise.all([
    repo.listParticipants({ event_id: id }),
    repo.listResources({ event_id: id }),
  ]);
  return { ...event, participants, resources };
}
async function createEvent({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    // Clash detection: check for overlapping events at the same location
    if (input.location && !input.force) {
      const clashes = await repo.findClashes({
        client,
        brand,
        location: input.location,
        start_at: input.start_at,
        end_at: input.end_at,
      });
      if (clashes.length > 0) {
        throw new AppError(
          "CLASH_DETECTED",
          `${clashes.length} overlapping event(s) at this location`,
          409,
          {
            user_message: `There are ${clashes.length} event(s) already scheduled at "${input.location}" during this time. Set force=true to override.`,
            metadata: { clashes },
          },
        );
      }
    }
    const event = await repo.createEvent({
      client,
      e: { ...input, business: brand, created_by: user.user_id },
    });
    for (const p of input.participants || [])
      await repo.addParticipant({
        client,
        p: { ...p, event_id: event.event_id },
      });
    for (const r of input.resources || [])
      await repo.addResource({ client, r: { ...r, event_id: event.event_id } });
    await A(
      brand,
      user,
      "calendar.event.create",
      "calendar_event",
      event.event_id,
      { event_type: event.event_type },
      request_id,
    );
    events.emit("event.created", { brand, event_id: event.event_id });
    return event;
  });
}
async function updateEvent({ brand, user, request_id, id, patch }) {
  const before = await repo.findEvent({ brand, id });
  if (!before) throw new NotFoundError("Event");
  const updated = await repo.updateEvent({ brand, id, patch });
  await A(
    brand,
    user,
    "calendar.event.update",
    "calendar_event",
    id,
    updated,
    request_id,
  );
  return updated;
}
async function deleteEvent({ brand, user, request_id, id }) {
  const ok = await repo.softDeleteEvent({ brand, id });
  if (!ok) throw new NotFoundError("Event");
  await A(
    brand,
    user,
    "calendar.event.delete",
    "calendar_event",
    id,
    null,
    request_id,
  );
}

async function addParticipant({ brand, user, request_id, id, input }) {
  const event = await repo.findEvent({ brand, id });
  if (!event) throw new NotFoundError("Event");
  const p = await repo.addParticipant({ p: { ...input, event_id: id } });
  await A(
    brand,
    user,
    "calendar.participant.add",
    "calendar_event",
    id,
    { participant_id: p.participant_id },
    request_id,
  );
  return p;
}
async function respondParticipant({
  brand,
  user,
  request_id,
  id,
  participant_id,
  status,
}) {
  const event = await repo.findEvent({ brand, id });
  if (!event) throw new NotFoundError("Event");
  const p = await repo.respondParticipant({
    event_id: id,
    participant_id,
    status,
  });
  if (!p) throw new NotFoundError("Participant");
  await A(
    brand,
    user,
    "calendar.participant.respond",
    "calendar_event",
    id,
    { participant_id, status },
    request_id,
  );
  return p;
}

async function removeParticipant({
  brand,
  user,
  request_id,
  id,
  participant_id,
}) {
  const event = await repo.findEvent({ brand, id });
  if (!event) throw new NotFoundError("Event");
  const ok = await repo.removeParticipant({ event_id: id, participant_id });
  if (!ok) throw new NotFoundError("Participant");
  await A(
    brand,
    user,
    "calendar.participant.remove",
    "calendar_event",
    id,
    { participant_id },
    request_id,
  );
}

/**
 * Events starting within `within_minutes` (default 24h) — the reminder cron
 * reads this to dispatch nudges. Pass event_type='reminder' to limit to
 * explicit reminder events.
 */
function findUpcomingForReminders({
  brand,
  within_minutes = 1440,
  event_type,
}) {
  const now = new Date();
  const to = new Date(now.getTime() + within_minutes * 60 * 1000);
  return repo.upcoming({
    brand,
    from: now.toISOString(),
    to: to.toISOString(),
    event_type,
  });
}

/**
 * Cross-module hook: drop another module's dated record onto the calendar.
 * Best-effort — callers pass the reference so the event links back.
 */
async function createForReference({
  brand,
  title,
  event_type,
  start_at,
  end_at,
  reference_type,
  reference_id,
  created_by,
}) {
  return repo.createEvent({
    e: {
      business: brand,
      title,
      event_type,
      start_at,
      end_at: end_at || start_at,
      reference_type,
      reference_id,
      created_by: created_by || null,
    },
  });
}

module.exports = {
  listEvents,
  listForReference,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  addParticipant,
  respondParticipant,
  removeParticipant,
  findUpcomingForReminders,
  createForReference,
  VALID_EVENT_TYPES,
};
