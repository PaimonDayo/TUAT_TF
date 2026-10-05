import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";

describe("legacy OB self entry", () => {
  const id = OB_PROGRAM_PATH.split("/")[2];
  it.each(["https://tuat-tf.vercel.app", "http://localhost:18013"])("opens personal registration within operations on the browser origin via %s", async (origin) => {
    const response = await GET(new Request(`${origin}/competitions/${id}/entry?from=home`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${OB_PROGRAM_PATH}?view=operations&section=mine&edit=mine`);
  });
  it("does not redirect a different competition to OB", async () => {
    const response = await GET(new Request("https://tuat-tf.vercel.app/competitions/other/entry"), { params: Promise.resolve({ id: "other" }) });
    expect(response.status).toBe(404);
    expect(response.headers.has("location")).toBe(false);
  });
});
