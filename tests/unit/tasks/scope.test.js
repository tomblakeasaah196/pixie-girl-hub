"use strict";

/**
 * Tasks record-scope enforcement (RBAC layer 4).
 *
 * With 'own' scope the service must (a) force list/board queries down to the
 * caller's tasks and (b) refuse by-id reads/writes on tasks the caller neither
 * owns nor created — regardless of what the client asked for. Repo is mocked;
 * these tests pin the service-layer decisions only.
 */

jest.mock("../../../src/shared/tasks/tasks.repo", () => ({
  createTask: jest.fn(),
  listTasks: jest.fn(),
  findTask: jest.fn(),
  updateTask: jest.fn(),
  setStatus: jest.fn(),
  softDeleteTask: jest.fn(),
  listSubtasks: jest.fn(),
  addSubtask: jest.fn(),
  setSubtaskDone: jest.fn(),
  deleteSubtask: jest.fn(),
  boardTasks: jest.fn(),
  listAssignableUsers: jest.fn(),
}));
jest.mock("../../../src/shared/tasks/tasks.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(() => jest.fn()),
  transaction: jest.fn((fn) => fn({})),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  },
}));

const repo = require("../../../src/shared/tasks/tasks.repo");
const service = require("../../../src/shared/tasks/tasks.service");
const { NotFoundError } = require("../../../src/utils/errors");

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const user = { user_id: ME };
const brand = "faitlynhair";

beforeEach(() => jest.clearAllMocks());

describe("list/board scoping", () => {
  test("'own' scope forces the list down to the caller's tasks", async () => {
    repo.listTasks.mockResolvedValue({ data: [], page: 1, total: 0 });
    await service.listTasks({ brand, scope: "own", user, status: "to_do" });
    expect(repo.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ brand, status: "to_do", visible_to: ME }),
    );
  });

  test("'all' scope passes through unfiltered", async () => {
    repo.listTasks.mockResolvedValue({ data: [], page: 1, total: 0 });
    await service.listTasks({ brand, scope: "all", user });
    const args = repo.listTasks.mock.calls[0][0];
    expect(args.visible_to).toBeUndefined();
  });

  test("'own' scope forces the board to the caller even when the client asks wider", async () => {
    repo.boardTasks.mockResolvedValue([]);
    await service.getBoard({ brand, scope: "own", user, assigned_to: OTHER });
    expect(repo.boardTasks).toHaveBeenCalledWith({
      brand,
      assigned_to: OTHER,
      visible_to: ME,
    });
  });

  test("'all' scope board is unfiltered", async () => {
    repo.boardTasks.mockResolvedValue([]);
    await service.getBoard({ brand, scope: "all", user });
    expect(repo.boardTasks).toHaveBeenCalledWith({
      brand,
      assigned_to: undefined,
      visible_to: undefined,
    });
  });
});

describe("by-id guard under 'own' scope", () => {
  const foreign = { task_id: "t1", assigned_to: OTHER, created_by: OTHER };

  test("getTask hides a task the caller neither owns nor created", async () => {
    repo.findTask.mockResolvedValue(foreign);
    await expect(
      service.getTask({ brand, scope: "own", user, id: "t1" }),
    ).rejects.toThrow(NotFoundError);
  });

  test("getTask returns a task assigned to the caller", async () => {
    repo.findTask.mockResolvedValue({ ...foreign, assigned_to: ME });
    repo.listSubtasks.mockResolvedValue([]);
    const t = await service.getTask({ brand, scope: "own", user, id: "t1" });
    expect(t.assigned_to).toBe(ME);
  });

  test("getTask returns a task the caller created (delegated work)", async () => {
    repo.findTask.mockResolvedValue({ ...foreign, created_by: ME });
    repo.listSubtasks.mockResolvedValue([]);
    await expect(
      service.getTask({ brand, scope: "own", user, id: "t1" }),
    ).resolves.toBeTruthy();
  });

  test("updateTask / changeStatus / deleteTask refuse foreign tasks", async () => {
    repo.findTask.mockResolvedValue(foreign);
    await expect(
      service.updateTask({ brand, scope: "own", user, id: "t1", patch: {} }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      service.changeStatus({ brand, scope: "own", user, id: "t1", status: "done" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      service.deleteTask({ brand, scope: "own", user, id: "t1" }),
    ).rejects.toThrow(NotFoundError);
    expect(repo.updateTask).not.toHaveBeenCalled();
    expect(repo.setStatus).not.toHaveBeenCalled();
    expect(repo.softDeleteTask).not.toHaveBeenCalled();
  });

  test("'all' scope can operate on any task", async () => {
    repo.findTask.mockResolvedValue(foreign);
    repo.setStatus.mockResolvedValue({ ...foreign, status: "done" });
    await expect(
      service.changeStatus({ brand, scope: "all", user, id: "t1", status: "done" }),
    ).resolves.toBeTruthy();
  });
});
