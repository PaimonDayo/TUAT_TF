import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/queries/ob-results-publish", () => ({ getObPublishedResults: state.read }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.admin }));
import { obResultsFeedToken, OB_RESULTS_SPREADSHEET_ID } from "@/lib/ob-results-feed-auth";
import { GET } from "./route";

const request = (token = obResultsFeedToken("synthetic-sync-secret")) => new Request("https://example.test/api/ob-results/snapshot?meetKey=other&spreadsheetId=other", { headers: { authorization: `Bearer ${token}` } });
beforeEach(() => {
  vi.stubEnv("SHEET_SYNC_SECRET", "synthetic-sync-secret");
  state.read.mockReset().mockResolvedValue({ entries: [], operations: [] });
  state.admin.mockReset().mockReturnValue({});
});
afterEach(() => vi.unstubAllEnvs());

it("requires the scoped read token and never accepts the general sync key", async () => {
  for (const token of ["", "synthetic-sync-secret", obResultsFeedToken("other-secret")]) expect((await GET(request(token))).status).toBe(401);
  expect(state.admin).not.toHaveBeenCalled();
  expect(state.read).not.toHaveBeenCalled();
});
it("fails closed when the key is unavailable", async () => {
  vi.stubEnv("SHEET_SYNC_SECRET", "");
  expect((await GET(request())).status).toBe(503);
  expect(state.admin).not.toHaveBeenCalled();
});
it("includes six relay lanes as public team cells without adding individual edit targets",async()=>{
 const relay={name:"4×300mリレー",widths:[8,24,14,8,20,20,20,20],rows:[["レーン","チーム名","タイム","順位","1走","2走","3走","4走"],...Array.from({length:6},(_,index)=>[index+1,index===5?"合成チーム":"",index===5?"2:45.67":"",index===5?1:"","","","",""])]};
 state.read.mockResolvedValueOnce({entries:[],operations:[],relaySheets:[relay]});
 const compatible=request();compatible.headers.set("X-OB-Relay-Results","1");
 const response=await GET(compatible),body=await response.json();expect(response.status).toBe(200);expect(body.sheets).toHaveLength(13);expect(body.sheets.at(-1)).toEqual(relay);expect(body.entryCount).toBe(0);expect(body.statusTargets.some((target:{name:string})=>target.name===relay.name)).toBe(false);expect(body.statusTargets.every((target:{rows:unknown[]})=>!target.rows.length)).toBe(true);
 state.read.mockResolvedValueOnce({entries:[],operations:[],relaySheets:[relay]});expect((await (await GET(request())).json()).sheets).toHaveLength(12);
});
it("fixes the target, publishes only cells, and prevents HTTP caching", async () => {
  const response = await GET(request());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(body).toMatchObject({ schemaVersion: 2, meetKey: "ob-2026", spreadsheetId: OB_RESULTS_SPREADSHEET_ID, entryCount: 0 });
  expect(body.sheets).toHaveLength(12);
  expect(body.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(body).not.toHaveProperty("entries");
  expect(body).not.toHaveProperty("operations");
  expect((await (await GET(request())).json()).revision).toBe(body.revision);
});
it("returns a failure, never an empty snapshot, after DB read or projection failure", async () => {
  state.read.mockRejectedValueOnce(new Error("private database detail"));
  let response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("sheets");
  state.read.mockResolvedValueOnce({ entries: null, operations: [] });
  response = await GET(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("private database detail");
});
it("exports public person cells without identities, qualification marks, contact or operation notes", async () => {
  state.read.mockResolvedValueOnce({ entries: [{ id: "private-entry-id", meet_key: "ob-2026", submitted_name: "合成人物", grade: "OB・OG", events: ["男子100m"], profile_id: "private-profile-id", revision: 1,
    imported_at: "", qualification_marks: { "男子100m": "private-qualification" }, contact: "private-contact" }], operations: [] });
  const body = JSON.stringify(await (await GET(request())).json());
  expect(body).toContain("合成人物");
  for (const privateValue of ["private-entry-id", "private-profile-id", "private-qualification", "private-contact"]) expect(body).not.toContain(privateValue);
});
