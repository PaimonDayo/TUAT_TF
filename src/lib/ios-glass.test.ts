import { describe, expect, it } from "vitest";
import { isIOSGlassDevice } from "./ios-glass";

describe("iOS glass device gate", () => {
  it.each([
    ["iPhone", "iPhone", 5, true],
    ["iPad", "iPad", 5, true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5, true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 0, false],
    ["Mozilla/5.0 (Linux; Android 16)", "Linux armv8l", 5, false],
    ["Mozilla/5.0 (Windows NT 10.0)", "Win32", 10, false],
  ])("%s / %s / %i => %s", (userAgent, platform, maxTouchPoints, expected) => {
    expect(isIOSGlassDevice({ userAgent, platform, maxTouchPoints })).toBe(expected);
  });
});
