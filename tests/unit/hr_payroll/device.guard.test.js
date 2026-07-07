"use strict";

/**
 * evaluateDeviceRecognition — device-binding flag policy (000304).
 * Flag (never block) an unknown device; CEO and not-yet-enrolled are neutral.
 */
const {
  evaluateDeviceRecognition,
} = require("../../../src/shared/hr_payroll/device.guard");

describe("evaluateDeviceRecognition", () => {
  test("CEO is always exempt (null), even with no match", () => {
    expect(
      evaluateDeviceRecognition({ isCeo: true, enrolledCount: 0, hasMatch: false }),
    ).toBeNull();
    expect(
      evaluateDeviceRecognition({ isCeo: true, enrolledCount: 2, hasMatch: false }),
    ).toBeNull();
  });

  test("employee with no enrolled devices yet is neutral (null)", () => {
    expect(
      evaluateDeviceRecognition({ isCeo: false, enrolledCount: 0, hasMatch: false }),
    ).toBeNull();
  });

  test("enrolled employee punching from a known device → recognised (true)", () => {
    expect(
      evaluateDeviceRecognition({ isCeo: false, enrolledCount: 2, hasMatch: true }),
    ).toBe(true);
  });

  test("enrolled employee punching from an unknown device → flagged (false)", () => {
    expect(
      evaluateDeviceRecognition({ isCeo: false, enrolledCount: 1, hasMatch: false }),
    ).toBe(false);
  });

  test("a falsy enrolledCount never throws and reads as neutral", () => {
    expect(
      evaluateDeviceRecognition({ isCeo: false, enrolledCount: undefined, hasMatch: false }),
    ).toBeNull();
  });
});
