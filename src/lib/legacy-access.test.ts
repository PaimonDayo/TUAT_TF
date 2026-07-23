import { describe, expect, it } from "vitest";
import {
  issueLegacyAccessToken,
  verifyLegacyAccessToken,
} from "@/lib/legacy-access";

const SECRET = "test-service-role-secret";
const NOW = 1_800_000_000;

describe("legacy access token", () => {
  it("accepts an issued token during its validity window", () => {
    const token = issueLegacyAccessToken("profile-1", SECRET, NOW);

    expect(verifyLegacyAccessToken(token, SECRET, NOW)).toBe(true);
    expect(verifyLegacyAccessToken(token, SECRET, NOW + 299)).toBe(true);
  });

  it("rejects an expired token", () => {
    const token = issueLegacyAccessToken("profile-1", SECRET, NOW);

    expect(verifyLegacyAccessToken(token, SECRET, NOW + 301)).toBe(false);
  });

  it("rejects tampering and a different signing secret", () => {
    const token = issueLegacyAccessToken("profile-1", SECRET, NOW);
    const [payload, signature] = token.split(".");

    expect(
      verifyLegacyAccessToken(`${payload}x.${signature}`, SECRET, NOW),
    ).toBe(false);
    expect(verifyLegacyAccessToken(token, "different-secret", NOW)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyLegacyAccessToken("", SECRET, NOW)).toBe(false);
    expect(verifyLegacyAccessToken("not-a-token", SECRET, NOW)).toBe(false);
    expect(verifyLegacyAccessToken("bad.payload.extra", SECRET, NOW)).toBe(false);
  });
});
