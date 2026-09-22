import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { readCompetitionProgramEntries } from "./competition-program-query";

function client(fetcher: typeof fetch) {
  return createClient<Database>("https://database.example", "anon-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetcher, headers: { Authorization: "Bearer member-test-token" } },
  });
}

describe("competition partial read", () => {
  it("makes one scoped, ordered request with the caller's authorization", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", {
      headers: { "content-type": "application/json" },
    }));
    await expect(readCompetitionProgramEntries(client(fetcher), "competition-one")).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [input, init] = fetcher.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/rest/v1/competition_program_entries");
    expect(url.searchParams.get("competition_id")).toBe("eq.competition-one");
    expect(url.searchParams.get("order")).toBe("event_date.asc,block.asc,sort_order.asc");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-test-token");
  });
  it("surfaces permission errors instead of treating them as an empty program", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ message: "permission denied", code: "42501" }), { status: 403 },
    ));
    await expect(readCompetitionProgramEntries(client(fetcher), "competition-one")).rejects.toMatchObject({ code: "42501" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("passes cancellation through to the database request", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]"));
    await readCompetitionProgramEntries(client(fetcher), "competition-one", controller.signal);
    expect(fetcher.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});
