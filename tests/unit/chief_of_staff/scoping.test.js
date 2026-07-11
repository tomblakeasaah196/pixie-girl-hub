"use strict";

/**
 * Chief of Staff catalogue scoping — the CoS turn only ever sees
 * surface='workspace' actions, so it structurally cannot select a Praxis
 * (ERP) action. cos.service's heavy deps are mocked so no DB/HTTP loads.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(() => jest.fn()),
  transaction: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/transcription.service", () => ({ transcribe: jest.fn() }));
jest.mock("../../../src/services/llm-router", () => ({ chatWithFailover: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  listActions: jest.fn(),
  canUseFeature: jest.fn(),
  recordUsage: jest.fn(),
}));

const governance = require("../../../src/modules/ai_governance/governance.service");
const cos = require("../../../src/modules/chief_of_staff/cos.service");

beforeEach(() => jest.clearAllMocks());

test("the CoS catalogue query is scoped to surface='workspace' + ai_enabled", async () => {
  governance.listActions.mockResolvedValue([]);
  await cos.listWorkspaceActions();
  expect(governance.listActions).toHaveBeenCalledWith({
    ai_enabled: true,
    surface: "workspace",
  });
});

test("buildTools only exposes the (workspace) actions it is given", () => {
  const { tools, byName } = cos.buildTools([
    {
      action_key: "workspace.create_goal",
      title: "Create a goal",
      description: "d",
      payload_schema: { type: "object", properties: { title: { type: "string" } } },
    },
    {
      action_key: "workspace.create_task",
      title: "Create a task",
      description: "d",
      payload_schema: { type: "object", properties: {} },
    },
  ]);
  expect(tools.map((t) => t.function.name).sort()).toEqual([
    "workspace_create_goal",
    "workspace_create_task",
  ]);
  // A Praxis action name is absent — the model has no tool to call it with.
  expect(byName.has("invoicing_create_invoice")).toBe(false);
});

test("payload schemas are normalised to a JSON-Schema object root", () => {
  const { tools } = cos.buildTools([
    { action_key: "workspace.x", title: "X", payload_schema: null },
  ]);
  expect(tools[0].function.parameters).toEqual({ type: "object", properties: {} });
});
