import { expect, it } from "vitest";
import { GET } from "./route";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";

it("sends an empty same-origin redirect before rendering the legacy app page", async () => {
  const response = GET();
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(OB_PROGRAM_PATH);
  expect(await response.text()).toBe("");
});
