"use strict";

// Stub the service so we control what the controller wraps. We assert on the
// JSON envelope, since the api client unwraps the outer `data` key and the
// list endpoint was silently dropping `meta` before this fix.
jest.mock("../../../src/shared/contacts/contacts.service", () => ({
  list: jest.fn(),
  getById: jest.fn(),
  getTimeline: jest.fn(),
  getSummary: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));

const service = require("../../../src/shared/contacts/contacts.service");
const c = require("../../../src/shared/contacts/contacts.controller");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

describe("contacts controller — response envelope", () => {
  test("list wraps the paginated service result so meta survives the api unwrap", async () => {
    service.list.mockResolvedValueOnce({
      data: [{ contact_id: "x", display_name: "Rynna" }],
      meta: { page: 1, page_size: 25, total: 1, has_more: false },
    });
    const req = { query: { page: "1", page_size: "25" }, brand: "pixiegirl" };
    const res = mockRes();
    await c.list(req, res);

    // Single envelope: { data: { data: [...], meta: {...} } } so the frontend
    // api wrapper unwraps once to { data, meta } — the bug was sending the
    // inner shape directly, which collapsed to just the array.
    expect(res.json).toHaveBeenCalledTimes(1);
    const sent = res.json.mock.calls[0][0];
    expect(sent).toEqual({
      data: {
        data: [{ contact_id: "x", display_name: "Rynna" }],
        meta: { page: 1, page_size: 25, total: 1, has_more: false },
      },
    });
  });

  test("list accepts UI filter aliases (search/type/priority)", async () => {
    service.list.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, page_size: 25, total: 0, has_more: false },
    });
    const req = {
      query: {
        search: "rynna",
        type: "customer",
        priority: "vip",
        page: "1",
        page_size: "25",
      },
      brand: "pixiegirl",
    };
    await c.list(req, mockRes());
    const call = service.list.mock.calls[0][0];
    expect(call.filters.q).toBe("rynna");
    expect(call.filters.contact_type).toBe("customer");
    expect(call.filters.priority_level).toBe("vip");
  });

  test("list still honours backend-native filter names", async () => {
    service.list.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, page_size: 25, total: 0, has_more: false },
    });
    const req = {
      query: {
        q: "rynna",
        contact_type: "customer",
        priority_level: "vip",
      },
      brand: "pixiegirl",
    };
    await c.list(req, mockRes());
    const call = service.list.mock.calls[0][0];
    expect(call.filters.q).toBe("rynna");
    expect(call.filters.contact_type).toBe("customer");
    expect(call.filters.priority_level).toBe("vip");
  });

  test("getTimeline wraps the service result and forwards category", async () => {
    service.getTimeline.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, page_size: 30, total: 0, has_more: false },
    });
    const req = {
      query: { category: "commercial" },
      params: { id: "abc" },
      brand: "pixiegirl",
    };
    await c.getTimeline(req, mockRes());
    expect(service.getTimeline.mock.calls[0][0].category).toBe("commercial");
  });

  test("create returns 201 with a wrapped contact", async () => {
    service.create.mockResolvedValueOnce({ contact_id: "x", display_name: "Rynna" });
    const req = {
      body: { display_name: "Rynna", primary_phone: "+2349020868023" },
      brand: "pixiegirl",
      user: { user_id: "u" },
      request_id: "r",
    };
    const res = mockRes();
    await c.create(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      data: { contact_id: "x", display_name: "Rynna" },
    });
  });

  test("update wraps the patched contact", async () => {
    service.update.mockResolvedValueOnce({
      contact_id: "x",
      instagram_handle: "new",
    });
    const req = {
      params: { id: "x" },
      body: { instagram_handle: "new" },
      brand: "pixiegirl",
      user: { user_id: "u" },
      request_id: "r",
    };
    const res = mockRes();
    await c.update(req, res);
    expect(res.json).toHaveBeenCalledWith({
      data: { contact_id: "x", instagram_handle: "new" },
    });
  });
});
