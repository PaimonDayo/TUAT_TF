import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPcAppRuntime } from "./pc-app-runtime";

function configured() {
  for (const [name, value] of Object.entries({
    PC_APP_RUNTIME: "true", NEXT_PUBLIC_PC_APP_RUNTIME: "true", PC_BACKEND_ENABLED: "true", NEXT_PUBLIC_PC_BACKEND: "true",
    APP_PUBLIC_ORIGIN: "https://pc-app.example.test", NEXT_PUBLIC_SUPABASE_URL: "https://pc-app.example.test/api/pc-supabase",
    PC_BACKEND_INTERNAL_URL: "http://127.0.0.1:8000", NEXT_PUBLIC_CLOUD_AUTH_URL: "https://synthetic-issuer.supabase.co",
    NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY: "synthetic-cloud-public-key", NEXT_PUBLIC_CLOUD_AUTH_MODE: "production",
    PC_APP_SYNTHETIC_REVIEW: "false", NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW: "false", VERCEL: "", VERCEL_ENV: "",
    PC_TRIAL_VERCEL: "false", NEXT_PUBLIC_PC_TRIAL: "false", NEXT_PUBLIC_PC_REST_RELAY_ORIGIN: "",
  })) vi.stubEnv(name, value);
}
beforeEach(configured);
afterEach(() => vi.unstubAllEnvs());

describe("dedicated PC app configuration", () => {
  it("uses fixed public origin, private established loopback and one cloud Auth issuer", () => {
    expect(getPcAppRuntime()).toEqual({ publicOrigin: "https://pc-app.example.test", internalUrl: "http://127.0.0.1:8000",
      cloud: { url: "https://synthetic-issuer.supabase.co", anonKey: "synthetic-cloud-public-key" }, synthetic: false });
  });
  it("keeps the old deployment disabled without new flags", () => {
    vi.stubEnv("PC_APP_RUNTIME", "false"); vi.stubEnv("NEXT_PUBLIC_PC_APP_RUNTIME", "false"); vi.stubEnv("PC_BACKEND_INTERNAL_URL", "");
    expect(getPcAppRuntime()).toBeUndefined();
  });
  it.each([
    ["PC_APP_RUNTIME", "false"], ["NEXT_PUBLIC_PC_APP_RUNTIME", "false"], ["PC_BACKEND_ENABLED", "false"],
    ["NEXT_PUBLIC_PC_BACKEND", "false"], ["VERCEL", "1"], ["VERCEL_ENV", "production"],
    ["PC_TRIAL_VERCEL", "true"], ["NEXT_PUBLIC_PC_TRIAL", "true"], ["NEXT_PUBLIC_PC_REST_RELAY_ORIGIN", "https://relay.example.test"],
    ["APP_PUBLIC_ORIGIN", "http://pc-app.example.test"], ["APP_PUBLIC_ORIGIN", "https://pc-app.example.test/"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://old-host.vercel.app/api/pc-supabase"],
    ["PC_BACKEND_INTERNAL_URL", "http://127.0.0.1:18180"], ["PC_BACKEND_INTERNAL_URL", "http://localhost:8000"],
    ["NEXT_PUBLIC_CLOUD_AUTH_URL", "http://127.0.0.1:18181"], ["NEXT_PUBLIC_CLOUD_AUTH_URL", "https://synthetic-issuer.supabase.co.attacker.test"],
    ["NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY", ""], ["NEXT_PUBLIC_CLOUD_AUTH_MODE", "test"],
  ])("rejects incompatible %s before service startup", (name, value) => {
    vi.stubEnv(name, value); expect(() => getPcAppRuntime()).toThrow();
  });
  it("permits isolated synthetic loopback only with all external writes disabled", () => {
    for (const [name, value] of Object.entries({ PC_APP_SYNTHETIC_REVIEW: "true", NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW: "true",
      NEXT_PUBLIC_CLOUD_AUTH_MODE: "test", PC_BACKEND_INTERNAL_URL: "http://127.0.0.1:18180",
      NEXT_PUBLIC_CLOUD_AUTH_URL: "http://127.0.0.1:18181", IMAGE_STORAGE_READ_ONLY: "true",
      R2_READ_ENABLED: "false", R2_WRITE_ENABLED: "false", SHEET_SYNC_ENABLED: "false" })) vi.stubEnv(name, value);
    expect(getPcAppRuntime()?.synthetic).toBe(true);
    for (const port of [8000, 3008, 3109, 3112, 18181]) {
      vi.stubEnv("PC_BACKEND_INTERNAL_URL", `http://127.0.0.1:${port}`);
      expect(() => getPcAppRuntime()).toThrow();
    }
    vi.stubEnv("PC_BACKEND_INTERNAL_URL", "http://127.0.0.1:18180");
    vi.stubEnv("R2_WRITE_ENABLED", "true"); expect(() => getPcAppRuntime()).toThrow();
  });
});
