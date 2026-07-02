"use strict";

/**
 * Praxis executor (praxis.executor.js) — route-parameter resolution and the
 * loopback execution call (axios mocked).
 */

jest.mock("../../../src/config/env", () => ({
  config: { PORT: 7000 },
}));

const mockAxios = jest.fn();
jest.mock("axios", () => (...args) => mockAxios(...args));

const {
  executeAction,
  resolveRoute,
} = require("../../../src/modules/praxis_ai/praxis.executor");

beforeEach(() => jest.clearAllMocks());

describe("resolveRoute", () => {
  it("substitutes :params from the payload and removes them from the body", () => {
    const { path, body } = resolveRoute("/api/v1/sales/orders/:id/payments", {
      id: "o-1",
      amount_ngn: "5000.00",
    });
    expect(path).toBe("/api/v1/sales/orders/o-1/payments");
    expect(body).toEqual({ amount_ngn: "5000.00" }); // :id left the body
  });

  it("URL-encodes substituted values", () => {
    const { path } = resolveRoute("/api/v1/x/:key", { key: "a b/c" });
    expect(path).toBe("/api/v1/x/a%20b%2Fc");
  });

  it("throws ACTION_ROUTE_PARAMS_MISSING when the model failed to fill a param", () => {
    expect(() => resolveRoute("/api/v1/sales/orders/:id", {})).toThrow(
      "missing route parameter",
    );
  });
});

describe("executeAction", () => {
  const pending = {
    method: "POST",
    route: "/api/v1/invoicing/invoices",
    payload: { order_id: "o-1" },
    business: "pixiegirl",
  };

  it("calls the real endpoint over loopback with the user's own auth", async () => {
    mockAxios.mockResolvedValue({ status: 201, data: { data: { id: "inv-1" } } });
    const r = await executeAction({
      pending,
      authHeader: "Bearer tok",
      requestId: "req-1",
    });
    expect(r.ok).toBe(true);
    expect(r.http_status).toBe(201);
    const call = mockAxios.mock.calls[0][0];
    expect(call.url).toBe("http://127.0.0.1:7000/api/v1/invoicing/invoices");
    expect(call.method).toBe("post");
    expect(call.headers.Authorization).toBe("Bearer tok");
    expect(call.headers["X-Brand-Context"]).toBe("pixiegirl");
    expect(call.data).toEqual({ order_id: "o-1" });
  });

  it("reports endpoint failures as ok:false with the real error body", async () => {
    mockAxios.mockResolvedValue({
      status: 403,
      data: { error: { code: "PERMISSION_DENIED" } },
    });
    const r = await executeAction({ pending, authHeader: "Bearer tok" });
    expect(r.ok).toBe(false);
    expect(r.http_status).toBe(403);
    expect(r.result.error.code).toBe("PERMISSION_DENIED");
  });

  it("truncates oversized results instead of bloating the row", async () => {
    mockAxios.mockResolvedValue({
      status: 200,
      data: { blob: "x".repeat(10_000) },
    });
    const r = await executeAction({ pending, authHeader: "Bearer tok" });
    expect(r.result._truncated).toBe(true);
    expect(r.result.preview.length).toBeLessThanOrEqual(4000);
  });
});
