import { describe, expect, it } from "vitest";
import { safeLoginNext } from "./login-next";

describe("OAuth return destination", () => {
  it.each(["/home", "/mypage?setup=1", "/records/one?tab=comments#reply", "/search?q=a%20b"])("preserves application navigation %s", path => {
    expect(safeLoginNext(path)).toBe(path);
  });
  it.each([null, undefined, "", "home", "https://other.invalid/home", "//other.invalid/home", "/\\other.invalid", "/\n/home", "/a/..//other.invalid"])("falls back for an unsafe destination %#", path => {
    expect(safeLoginNext(path)).toBe("/home");
  });
});
