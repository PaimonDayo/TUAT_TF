import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";
afterEach(() => vi.unstubAllEnvs());
it("adds the pinned PC release identifier only for the opt-in app", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40)); vi.stubEnv("PC_APP_RELEASE_ID", "pc-review-20261011");
  vi.stubEnv("PC_APP_RUNTIME", "true");
  expect(await (await GET()).json()).toEqual({ version: "a".repeat(40), releaseId: "pc-review-20261011" });
  vi.stubEnv("PC_APP_RUNTIME", "false");
  expect(await (await GET()).json()).toEqual({ version: "a".repeat(40) });
});
