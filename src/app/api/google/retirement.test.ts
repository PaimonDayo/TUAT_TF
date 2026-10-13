import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as connect from "./connect/route";
import * as callback from "./callback/route";
import * as status from "./status/route";
import * as creation from "./sheets/create/route";

const provider = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", provider.mockReset()));
afterEach(() => vi.unstubAllGlobals());

it.each([
  ["connect GET", connect.GET], ["connect POST", connect.POST],
  ["callback GET", callback.GET], ["status GET", status.GET],
  ["status DELETE", status.DELETE], ["create GET", creation.GET],
  ["create POST", creation.POST],
] as const)("ends the old %s endpoint without provider requests", async (_name, handler) => {
  const response = await handler();
  expect(response.status).toBe(410);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.has("Location")).toBe(false);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("発行機能は終了") });
  expect(provider).not.toHaveBeenCalled();
});
