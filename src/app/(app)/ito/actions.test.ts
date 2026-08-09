import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole, Profile } from "@/types";

/**
 * ito のサーバーアクションが、権限と状態の条件を実際に守るかを確かめる。
 * Supabase クライアントは差し替え、発行されたクエリの中身を検証する
 * （DB 側の RLS は別途 can_manage_system() で二重に守っている）。
 */

const { getCurrentProfile, createClient, getAllProfiles } = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createClient: vi.fn(),
  getAllProfiles: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getCurrentProfile }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/queries", () => ({ getAllProfiles }));

import {
  closeItoEntry,
  createItoGame,
  inviteItoMembers,
  openItoEntry,
  respondItoInvitation,
} from "./actions";

interface RecordedCall {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Record<string, unknown>;
  payload?: unknown;
}

type Reply = { data: unknown; error: unknown };

function stubSupabase(reply: (call: RecordedCall) => Reply) {
  const calls: RecordedCall[] = [];
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  function from(table: string) {
    const call: RecordedCall = { table, op: "select", filters: {} };
    calls.push(call);
    const chain = {
      select: () => chain,
      order: () => chain,
      insert: (payload: unknown) => {
        call.op = "insert";
        call.payload = payload;
        return chain;
      },
      update: (payload: unknown) => {
        call.op = "update";
        call.payload = payload;
        return chain;
      },
      delete: () => {
        call.op = "delete";
        return chain;
      },
      eq: (column: string, value: unknown) => {
        call.filters[column] = value;
        return chain;
      },
      single: () => chain,
      maybeSingle: () => chain,
      then: (
        resolve: (value: Reply) => unknown,
        rejectHandler?: (reason: unknown) => unknown,
      ) => Promise.resolve(reply(call)).then(resolve, rejectHandler),
    };
    return chain;
  }

  createClient.mockResolvedValue({ from, rpc });
  return { calls, rpc };
}

function role(id: string, overrides: Partial<AppRole> = {}): AppRole {
  return {
    id,
    name: id,
    can_manage_system: false,
    can_manage_members: false,
    can_create_schedule: false,
    can_create_menu: false,
    can_create_notice: false,
    is_system: false,
    is_everyone: false,
    color: "#000000",
    category: null,
    sort_order: 0,
    created_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

const CAMP = role("camp");
const SYSTEM = role("system", { can_manage_system: true });

function profile(id: string, roles: AppRole[]): Profile {
  return { id, roles, status: "active" } as unknown as Profile;
}

const ADMIN = profile("admin1", [SYSTEM]);
const MEMBER = profile("member1", [CAMP]);
const GAME = {
  id: "game1",
  name: "合宿2026 ito",
  target_role_id: CAMP.id,
  group_count: 10,
  max_group_size: 5,
  status: "draft",
};

beforeEach(() => {
  getCurrentProfile.mockResolvedValue(ADMIN);
  getAllProfiles.mockResolvedValue([
    profile("m1", [CAMP]),
    profile("m2", [CAMP]),
    profile("admin1", [CAMP, SYSTEM]),
    profile("other", [role("other")]),
  ]);
});

describe("ito game creation", () => {
  it("refuses a member without the system permission", async () => {
    getCurrentProfile.mockResolvedValue(MEMBER);
    const { calls } = stubSupabase(() => ({ data: null, error: null }));

    await expect(
      createItoGame({
        name: "合宿2026 ito",
        targetRoleId: CAMP.id,
        groupCount: 10,
        maxGroupSize: 5,
      }),
    ).rejects.toThrow("システム管理者");
    // 権限が無いときは DB に触れない。
    expect(calls).toHaveLength(0);
  });

  it("creates a draft game owned by the administrator", async () => {
    const { calls } = stubSupabase((call) => ({
      data: { ...GAME, ...(call.payload as object) },
      error: null,
    }));

    const game = await createItoGame({
      name: "  合宿2026 ito  ",
      targetRoleId: CAMP.id,
      groupCount: 10,
      maxGroupSize: 5,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("ito_games");
    expect(calls[0].op).toBe("insert");
    expect(calls[0].payload).toMatchObject({
      name: "合宿2026 ito",
      target_role_id: CAMP.id,
      status: "draft",
      created_by: ADMIN.id,
    });
    expect(game.name).toBe("合宿2026 ito");
  });

  it("rejects an invalid setup before touching the database", async () => {
    const { calls } = stubSupabase(() => ({ data: null, error: null }));
    await expect(
      createItoGame({
        name: "ito",
        targetRoleId: CAMP.id,
        groupCount: 1,
        maxGroupSize: 5,
      }),
    ).rejects.toThrow("2つ以上");
    expect(calls).toHaveLength(0);
  });
});

describe("ito entry", () => {
  it("opens entry only from draft and invites the target role once", async () => {
    const { calls } = stubSupabase((call) => {
      if (call.table === "ito_games" && call.op === "update") {
        return { data: [{ id: GAME.id }], error: null };
      }
      if (call.table === "ito_games") return { data: GAME, error: null };
      if (call.table === "ito_invitations" && call.op === "select") {
        return { data: [{ profile_id: "m1" }], error: null };
      }
      return { data: null, error: null };
    });

    const invited = await openItoEntry(GAME.id);

    const statusUpdate = calls.find(
      (call) => call.table === "ito_games" && call.op === "update",
    );
    expect(statusUpdate?.payload).toMatchObject({ status: "entry" });
    // draft のときだけ開始できる。
    expect(statusUpdate?.filters).toMatchObject({ id: GAME.id, status: "draft" });

    const insert = calls.find(
      (call) => call.table === "ito_invitations" && call.op === "insert",
    );
    // 招待済みの m1・進行役の admin1・対象外の other は入らない。
    expect(insert?.payload).toEqual([
      { game_id: GAME.id, profile_id: "m2", round_no: 1, invited_by: ADMIN.id },
    ]);
    expect(invited).toBe(1);
  });

  it("refuses to start entry twice", async () => {
    stubSupabase((call) =>
      call.op === "update" ? { data: [], error: null } : { data: GAME, error: null },
    );
    await expect(openItoEntry(GAME.id)).rejects.toThrow("すでにエントリーを開始");
  });

  it("closes entry without rewriting unanswered invitations", async () => {
    const { calls } = stubSupabase(() => ({ data: [{ id: GAME.id }], error: null }));

    await closeItoEntry(GAME.id);

    const update = calls.find((call) => call.table === "ito_games");
    expect(update?.payload).toMatchObject({ status: "active" });
    expect(update?.filters).toMatchObject({ status: "entry" });
    // 未回答（pending）はそのまま残す。招待テーブルには触らない。
    expect(calls.some((call) => call.table === "ito_invitations")).toBe(false);
  });

  it("re-invites for a later round without duplicating the current round", async () => {
    const { calls } = stubSupabase((call) => {
      if (call.table === "ito_games") return { data: GAME, error: null };
      if (call.table === "ito_invitations" && call.op === "select") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });

    const invited = await inviteItoMembers(GAME.id, 3);

    const insert = calls.find(
      (call) => call.table === "ito_invitations" && call.op === "insert",
    );
    expect(insert?.payload).toEqual([
      { game_id: GAME.id, profile_id: "m1", round_no: 3, invited_by: ADMIN.id },
      { game_id: GAME.id, profile_id: "m2", round_no: 3, invited_by: ADMIN.id },
    ]);
    expect(invited).toBe(2);
  });

  it("answers an invitation through the RPC, not a direct update", async () => {
    getCurrentProfile.mockResolvedValue(MEMBER);
    const { calls, rpc } = stubSupabase(() => ({ data: null, error: null }));

    await respondItoInvitation("invitation1", true);

    expect(rpc).toHaveBeenCalledWith("ito_respond_invitation", {
      invitation_id: "invitation1",
      accept: true,
    });
    expect(calls).toHaveLength(0);
  });

  it("reports an invitation that was already answered", async () => {
    getCurrentProfile.mockResolvedValue(MEMBER);
    const { rpc } = stubSupabase(() => ({ data: null, error: null }));
    rpc.mockResolvedValue({ data: null, error: { message: "invitation already answered" } });

    await expect(respondItoInvitation("invitation1", false)).rejects.toThrow(
      "すでに回答しています",
    );
  });
});
