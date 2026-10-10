import { afterEach, expect, it, vi } from "vitest";
import { configuredAppPublicOrigin, getAppPublicOrigin } from "./app-public-origin";
afterEach(() => vi.unstubAllEnvs());
it("uses only the configured HTTPS root behind a proxy, preserving legacy request origin otherwise", () => {
  vi.stubEnv("APP_PUBLIC_ORIGIN", "https://pc-app.example.test");
  expect(getAppPublicOrigin("http://127.0.0.1:18182/auth/callback")).toBe("https://pc-app.example.test");
  for (const origin of ["http://pc-app.example.test", "https://pc-app.example.test/path", "https://user:secret@pc-app.example.test", "https://*.example.test", "https://pc-app.example.test?next=evil"]) {
    vi.stubEnv("APP_PUBLIC_ORIGIN", origin); expect(() => configuredAppPublicOrigin()).toThrow();
  }
  vi.stubEnv("APP_PUBLIC_ORIGIN", ""); expect(getAppPublicOrigin("https://legacy.vercel.app/home")).toBe("https://legacy.vercel.app");
});
