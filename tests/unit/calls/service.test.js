"use strict";

/**
 * Unit tests for the calls state machine (calls.service): ring routing
 * (owner-first vs brand-wide), idempotent connect, terminate settlement,
 * claim contention, accept failure recovery, and the missed-call
 * follow-up trio. Repo + integrations are mocked; the module event bus
 * is real so ring/stop emissions can be asserted.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (cb) => cb({ query: jest.fn() })),
  query: jest.fn(),
  ex: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/calls/calls.repo", () => ({
  createFromConnect: jest.fn(),
  insertEvent: jest.fn(),
  findById: jest.fn(),
  findByWaCallId: jest.fn(),
  findByCallIdUnscoped: jest.fn(),
  getChannelOwner: jest.fn(),
  getUserName: jest.fn(),
  claim: jest.fn(),
  releaseClaim: jest.fn(),
  markEnded: jest.fn(),
  setEscalated: jest.fn(),
  setTimelineMessage: jest.fn(),
  setMissedFollowups: jest.fn(),
  setOutcome: jest.fn(),
  list: jest.fn(),
  findStaleRinging: jest.fn(),
  findFallbackTaskCreator: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({
  findMessagingAccount: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.service", () => ({
  findOrCreateCustomerThread: jest.fn(),
  recordCallActivity: jest.fn(),
  updateCallActivity: jest.fn(),
  assertPlatformAccess: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.subscribers", () => ({
  resolveOrCreateContact: jest.fn(),
}));
jest.mock("../../../src/services/whatsapp-calling.service", () => ({
  accept: jest.fn(),
  reject: jest.fn(),
  terminate: jest.fn(),
  getIceServers: jest.fn(() => [{ urls: "stun:stun.example.org" }]),
}));
jest.mock("../../../src/services/whatsapp.service", () => ({
  sendText: jest.fn(),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(),
}));
jest.mock("../../../src/shared/tasks/tasks.repo", () => ({
  createTask: jest.fn(),
}));
jest.mock("../../../src/jobs/queue-producer", () => ({
  enqueue: jest.fn(),
}));

const repo = require("../../../src/modules/calls/calls.repo");
const smartcommRepo = require("../../../src/modules/smartcomm/smartcomm.repo");
const smartcommService = require("../../../src/modules/smartcomm/smartcomm.service");
const smartcommSubscribers = require("../../../src/modules/smartcomm/smartcomm.subscribers");
const callingApi = require("../../../src/services/whatsapp-calling.service");
const whatsapp = require("../../../src/services/whatsapp.service");
const notifications = require("../../../src/services/notifications.service");
const tasksRepo = require("../../../src/shared/tasks/tasks.repo");
const { enqueue } = require("../../../src/jobs/queue-producer");
const events = require("../../../src/modules/calls/calls.events");
const service = require("../../../src/modules/calls/calls.service");

const CONNECT_EVT = {
  external_account_id: "PHONE_ID_123",
  wa_call_id: "wacid.ABC",
  event: "connect",
  direction: "USER_INITIATED",
  from: "2348012345678",
  to: "2348010000000",
  caller_name: "Ada",
  timestamp: "2026-07-10T10:00:00.000Z",
  sdp: "v=0 fake-offer",
  raw: { id: "wacid.ABC", event: "connect" },
};

const BASE_CALL = {
  call_id: "11111111-1111-4111-8111-111111111111",
  business: "pixiegirl",
  wa_call_id: "wacid.ABC",
  contact_id: "22222222-2222-4222-8222-222222222222",
  channel_id: "33333333-3333-4333-8333-333333333333",
  status: "ringing",
  from_number: "2348012345678",
  caller_name: "Ada",
  started_at: "2026-07-10T10:00:00.000Z",
  answered_by: null,
  duration_seconds: null,
};

function captureEvent(name) {
  const seen = [];
  events.on(name, (p) => seen.push(p));
  return seen;
}

function primeConnectHappyPath({ assigned_to }) {
  smartcommRepo.findMessagingAccount.mockResolvedValue({
    business: "pixiegirl",
    platform: "whatsapp",
  });
  smartcommSubscribers.resolveOrCreateContact.mockResolvedValue({
    contact: { contact_id: BASE_CALL.contact_id, display_name: "Ada Obi" },
  });
  smartcommService.findOrCreateCustomerThread.mockResolvedValue({
    channel_id: BASE_CALL.channel_id,
    assigned_to,
  });
  repo.createFromConnect.mockResolvedValue({
    call: { ...BASE_CALL, caller_name: "Ada Obi" },
    duplicate: false,
  });
}

describe("handleConnect — ring routing", () => {
  test("assigned thread rings the owner first and schedules escalation", async () => {
    const rings = captureEvent("call.ringing");
    primeConnectHappyPath({ assigned_to: "owner-uuid" });

    await service.handleConnect(CONNECT_EVT);

    expect(repo.createFromConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        call: expect.objectContaining({
          business: "pixiegirl",
          wa_call_id: "wacid.ABC",
          contact_id: BASE_CALL.contact_id,
          channel_id: BASE_CALL.channel_id,
          sdp_offer: "v=0 fake-offer",
        }),
      }),
    );
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({
      scope: "owner",
      owner_user_id: "owner-uuid",
      brand: "pixiegirl",
    });
    // escalation at +15s AND the stale sweep are both scheduled
    const jobNames = enqueue.mock.calls.map((c) => c[1]);
    expect(jobNames).toEqual(
      expect.arrayContaining(["escalate", "sweep-stale"]),
    );
    expect(repo.setEscalated).not.toHaveBeenCalled();
  });

  test("unassigned thread rings the whole brand immediately (no escalation job)", async () => {
    const rings = captureEvent("call.ringing");
    primeConnectHappyPath({ assigned_to: null });
    repo.setEscalated.mockResolvedValue({ ...BASE_CALL });

    await service.handleConnect(CONNECT_EVT);

    expect(rings).toHaveLength(1);
    expect(rings[0].scope).toBe("brand");
    expect(repo.setEscalated).toHaveBeenCalled();
    const jobNames = enqueue.mock.calls.map((c) => c[1]);
    expect(jobNames).toContain("sweep-stale");
    expect(jobNames).not.toContain("escalate");
  });

  test("webhook redelivery (duplicate wa_call_id) does not re-ring", async () => {
    const rings = captureEvent("call.ringing");
    primeConnectHappyPath({ assigned_to: "owner-uuid" });
    repo.createFromConnect.mockResolvedValue({
      call: BASE_CALL,
      duplicate: true,
    });

    await service.handleConnect(CONNECT_EVT);

    expect(rings).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("unknown phone_number_id drops the call quietly", async () => {
    smartcommRepo.findMessagingAccount.mockResolvedValue(null);
    const result = await service.handleConnect(CONNECT_EVT);
    expect(result).toBeNull();
    expect(repo.createFromConnect).not.toHaveBeenCalled();
  });
});

describe("handleTerminate — settlement", () => {
  function primeFinalise() {
    repo.getUserName.mockResolvedValue("Chidinma");
    smartcommService.recordCallActivity.mockResolvedValue({
      channel_id: BASE_CALL.channel_id,
      message: { message_id: "msg-1" },
    });
    repo.getChannelOwner.mockResolvedValue("owner-uuid");
    tasksRepo.createTask.mockResolvedValue({ task_id: "task-1" });
  }

  test("ringing call → missed: card + auto-reply + CRM task + notification", async () => {
    const endedEvents = captureEvent("call.ended");
    primeFinalise();
    repo.findByWaCallId.mockResolvedValue({ ...BASE_CALL });
    repo.markEnded.mockResolvedValue({ ...BASE_CALL, status: "missed" });

    await service.handleTerminate({
      wa_call_id: "wacid.ABC",
      event: "terminate",
      status: "MISSED",
      raw: {},
    });

    expect(repo.markEnded).toHaveBeenCalledWith(
      expect.objectContaining({ status: "missed" }),
    );
    // timeline card
    expect(smartcommService.recordCallActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "pixiegirl",
        contact_id: BASE_CALL.contact_id,
        content: expect.stringContaining("Missed"),
      }),
    );
    // missed-call trio (option 4a)
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ brand: "pixiegirl", to: "2348012345678" }),
    );
    expect(tasksRepo.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          assigned_to: "owner-uuid",
          created_by: "owner-uuid",
          priority: "high",
          reference_type: "whatsapp_call",
        }),
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "owner-uuid", priority: "high" }),
    );
    expect(repo.setMissedFollowups).toHaveBeenCalledWith(
      expect.objectContaining({ auto_reply_sent: true, missed_task_id: "task-1" }),
    );
    expect(endedEvents).toHaveLength(1);
    expect(endedEvents[0].status).toBe("missed");
  });

  test("in-progress call → completed with Meta's duration; no missed follow-ups", async () => {
    primeFinalise();
    repo.findByWaCallId.mockResolvedValue({
      ...BASE_CALL,
      status: "in_progress",
      answered_by: "agent-uuid",
    });
    repo.markEnded.mockResolvedValue({
      ...BASE_CALL,
      status: "completed",
      answered_by: "agent-uuid",
      duration_seconds: 280,
    });

    await service.handleTerminate({
      wa_call_id: "wacid.ABC",
      event: "terminate",
      status: "COMPLETED",
      end_time: "2026-07-10T10:05:00.000Z",
      duration: 280,
      raw: {},
    });

    expect(repo.markEnded).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", duration_seconds: 280 }),
    );
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(tasksRepo.createTask).not.toHaveBeenCalled();
    expect(smartcommService.recordCallActivity).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("4m 40s") }),
    );
  });

  test("already-settled call is a no-op (hangup won the race)", async () => {
    repo.findByWaCallId.mockResolvedValue({ ...BASE_CALL, status: "completed" });
    await service.handleTerminate({
      wa_call_id: "wacid.ABC",
      event: "terminate",
      status: "COMPLETED",
      raw: {},
    });
    expect(repo.markEnded).not.toHaveBeenCalled();
  });

  test("terminate for an unknown call is ignored", async () => {
    repo.findByWaCallId.mockResolvedValue(null);
    await service.handleTerminate({
      wa_call_id: "wacid.NOPE",
      event: "terminate",
      raw: {},
    });
    expect(repo.markEnded).not.toHaveBeenCalled();
  });
});

describe("claim / accept — exactly one winner", () => {
  const user = { user_id: "agent-uuid", display_name: "Chidinma", is_ceo: false };

  test("winner gets the SDP offer + ICE servers; stop-ring is broadcast", async () => {
    const claims = captureEvent("call.claimed");
    repo.claim.mockResolvedValue({
      ...BASE_CALL,
      status: "in_progress",
      answered_by: "agent-uuid",
      sdp_offer: "v=0 fake-offer",
    });

    const result = await service.claimCall({
      user,
      brand: "pixiegirl",
      id: BASE_CALL.call_id,
    });

    expect(smartcommService.assertPlatformAccess).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "whatsapp", action: "reply" }),
    );
    expect(result.sdp_offer).toBe("v=0 fake-offer");
    expect(result.ice_servers).toEqual([{ urls: "stun:stun.example.org" }]);
    expect(result.call.sdp_offer).toBeUndefined(); // never in the public shape
    expect(claims).toHaveLength(1);
  });

  test("loser gets a clean 409 when a colleague answered first", async () => {
    repo.claim.mockResolvedValue(null);
    repo.findById.mockResolvedValue({
      ...BASE_CALL,
      status: "in_progress",
      answered_by: "other-agent",
    });

    await expect(
      service.claimCall({ user, brand: "pixiegirl", id: BASE_CALL.call_id }),
    ).rejects.toMatchObject({ code: "CALL_NOT_RINGING", http_status: 409 });
  });

  test("accept requires the claim to be yours", async () => {
    repo.findById.mockResolvedValue({
      ...BASE_CALL,
      status: "in_progress",
      answered_by: "someone-else",
    });
    await expect(
      service.acceptCall({
        user,
        brand: "pixiegirl",
        id: BASE_CALL.call_id,
        sdp: "v=0 answer",
      }),
    ).rejects.toMatchObject({ code: "CALL_NOT_CLAIMED" });
    expect(callingApi.accept).not.toHaveBeenCalled();
  });

  test("Graph accept failure releases the claim and re-rings the brand", async () => {
    const reRings = captureEvent("call.claim_released");
    repo.findById.mockResolvedValue({
      ...BASE_CALL,
      status: "in_progress",
      answered_by: "agent-uuid",
    });
    callingApi.accept.mockRejectedValue(new Error("Meta 500"));
    repo.releaseClaim.mockResolvedValue({ ...BASE_CALL });

    await expect(
      service.acceptCall({
        user,
        brand: "pixiegirl",
        id: BASE_CALL.call_id,
        sdp: "v=0 answer",
      }),
    ).rejects.toThrow("Meta 500");

    expect(repo.releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "agent-uuid" }),
    );
    expect(reRings).toHaveLength(1);
  });
});

describe("reject / hangup / outcome", () => {
  const user = { user_id: "agent-uuid", display_name: "Chidinma", is_ceo: false };

  test("reject settles as rejected and still runs missed follow-ups", async () => {
    repo.findById.mockResolvedValue({ ...BASE_CALL });
    repo.markEnded.mockResolvedValue({ ...BASE_CALL, status: "rejected" });
    repo.getUserName.mockResolvedValue(null);
    smartcommService.recordCallActivity.mockResolvedValue({
      channel_id: BASE_CALL.channel_id,
      message: { message_id: "msg-2" },
    });
    repo.getChannelOwner.mockResolvedValue(null);
    repo.findFallbackTaskCreator.mockResolvedValue("ceo-uuid");
    tasksRepo.createTask.mockResolvedValue({ task_id: "task-2" });

    await service.rejectCall({ user, brand: "pixiegirl", id: BASE_CALL.call_id });

    expect(callingApi.reject).toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalled();
    // unassigned thread: CEO fallback creates the task, assigned to nobody
    expect(tasksRepo.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          created_by: "ceo-uuid",
          assigned_to: null,
        }),
      }),
    );
    expect(notifications.notify).not.toHaveBeenCalled(); // no owner to notify
  });

  test("hangup by a different (non-CEO) agent is forbidden", async () => {
    repo.findById.mockResolvedValue({
      ...BASE_CALL,
      status: "in_progress",
      answered_by: "someone-else",
    });
    await expect(
      service.hangupCall({ user, brand: "pixiegirl", id: BASE_CALL.call_id }),
    ).rejects.toMatchObject({ code: "NOT_CALL_OWNER", http_status: 403 });
    expect(callingApi.terminate).not.toHaveBeenCalled();
  });

  test("outcome is only recordable on completed calls, by the answering agent", async () => {
    repo.findById.mockResolvedValue({ ...BASE_CALL, status: "missed" });
    await expect(
      service.recordOutcome({
        user,
        brand: "pixiegirl",
        id: BASE_CALL.call_id,
        outcome: "deal_closed",
      }),
    ).rejects.toMatchObject({ code: "CALL_NOT_COMPLETED" });

    repo.findById.mockResolvedValue({
      ...BASE_CALL,
      status: "completed",
      answered_by: "someone-else",
    });
    await expect(
      service.recordOutcome({
        user,
        brand: "pixiegirl",
        id: BASE_CALL.call_id,
        outcome: "deal_closed",
      }),
    ).rejects.toMatchObject({ code: "NOT_CALL_OWNER" });
  });

  test("recording an outcome updates the row and refreshes the timeline card", async () => {
    repo.findById.mockResolvedValue({
      ...BASE_CALL,
      status: "completed",
      answered_by: "agent-uuid",
    });
    repo.setOutcome.mockResolvedValue({
      ...BASE_CALL,
      status: "completed",
      answered_by: "agent-uuid",
      outcome: "deal_closed",
      duration_seconds: 272,
      message_id: "msg-1",
    });

    const result = await service.recordOutcome({
      user,
      brand: "pixiegirl",
      id: BASE_CALL.call_id,
      outcome: "deal_closed",
      notes: "Agreed on the 24-inch bundle",
    });

    expect(result.outcome).toBe("deal_closed");
    expect(smartcommService.updateCallActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: "msg-1",
        content: expect.stringContaining("Deal closed"),
        metadata: expect.objectContaining({ outcome: "deal_closed" }),
      }),
    );
  });
});

describe("lifecycle jobs", () => {
  test("escalation widens the ring only while still ringing", async () => {
    const escalations = captureEvent("call.escalated");
    repo.setEscalated.mockResolvedValue({ ...BASE_CALL });
    await service.escalateRing({ call_id: BASE_CALL.call_id });
    expect(escalations).toHaveLength(1);
    expect(escalations[0].scope).toBe("brand");

    repo.setEscalated.mockResolvedValue(null); // answered in the meantime
    await service.escalateRing({ call_id: BASE_CALL.call_id });
    expect(escalations).toHaveLength(1);
  });

  test("stale sweep settles a stranded ringing call as missed", async () => {
    repo.findByCallIdUnscoped.mockResolvedValue({
      ...BASE_CALL,
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    repo.markEnded.mockResolvedValue({ ...BASE_CALL, status: "missed" });
    repo.getUserName.mockResolvedValue(null);
    smartcommService.recordCallActivity.mockResolvedValue({
      channel_id: BASE_CALL.channel_id,
      message: { message_id: "msg-3" },
    });
    repo.getChannelOwner.mockResolvedValue(null);
    repo.findFallbackTaskCreator.mockResolvedValue(null);

    await service.sweepStaleRinging({ call_id: BASE_CALL.call_id });

    expect(repo.markEnded).toHaveBeenCalledWith(
      expect.objectContaining({ status: "missed", end_reason: "stale_no_terminate" }),
    );
    // no eligible creator → task skipped, but auto-reply still attempted
    expect(tasksRepo.createTask).not.toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalled();
  });

  test("stale sweep leaves fresh or already-settled calls alone", async () => {
    repo.findByCallIdUnscoped.mockResolvedValue({
      ...BASE_CALL,
      started_at: new Date().toISOString(), // too fresh
    });
    await service.sweepStaleRinging({ call_id: BASE_CALL.call_id });
    expect(repo.markEnded).not.toHaveBeenCalled();

    repo.findByCallIdUnscoped.mockResolvedValue({ ...BASE_CALL, status: "completed" });
    await service.sweepStaleRinging({ call_id: BASE_CALL.call_id });
    expect(repo.markEnded).not.toHaveBeenCalled();
  });
});
