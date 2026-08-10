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
  advanceItoRound,
  closeItoEntry,
  createItoGame,
  deleteItoGame,
  startItoRound,
  inviteItoMembers,
  openItoEntry,
  respondItoInvitation,
  updateItoGameTheme,
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
      neq: (column: string, value: unknown) => {
        call.filters[`${column}!`] = value;
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        call.filters[column] = values;
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
  mode: "team",
  group_count: 10,
  max_group_size: 5,
  theme: null,
  admin_participates: false,
  status: "draft",
  created_by: ADMIN.id,
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

  it("also invites the creating administrator when admin_participates is on", async () => {
    const game = { ...GAME, admin_participates: true };
    const { calls } = stubSupabase((call) => {
      if (call.table === "ito_games") return { data: game, error: null };
      if (call.table === "ito_invitations" && call.op === "select") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });

    const invited = await inviteItoMembers(game.id, 1);

    const insert = calls.find(
      (call) => call.table === "ito_invitations" && call.op === "insert",
    );
    expect(insert?.payload).toEqual([
      { game_id: game.id, profile_id: "m1", round_no: 1, invited_by: ADMIN.id },
      { game_id: game.id, profile_id: "m2", round_no: 1, invited_by: ADMIN.id },
      { game_id: game.id, profile_id: "admin1", round_no: 1, invited_by: ADMIN.id },
    ]);
    expect(invited).toBe(3);
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

describe("ito theme", () => {
  it("refuses a member without the system permission", async () => {
    getCurrentProfile.mockResolvedValue(MEMBER);
    const { calls } = stubSupabase(() => ({ data: [{ id: GAME.id }], error: null }));

    await expect(updateItoGameTheme(GAME.id, "テーマ")).rejects.toThrow("システム管理者");
    expect(calls).toHaveLength(0);
  });

  it("sets the theme on a non-finished game", async () => {
    const { calls } = stubSupabase(() => ({ data: [{ id: GAME.id }], error: null }));

    await updateItoGameTheme(GAME.id, "  好きな食べ物度  ");

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("ito_games");
    expect(calls[0].op).toBe("update");
    expect(calls[0].payload).toMatchObject({ theme: "好きな食べ物度" });
    expect(calls[0].filters).toMatchObject({ id: GAME.id });
  });

  it("refuses to set a theme that is too long", async () => {
    const { calls } = stubSupabase(() => ({ data: [{ id: GAME.id }], error: null }));

    await expect(updateItoGameTheme(GAME.id, "あ".repeat(61))).rejects.toThrow("60文字");
    expect(calls).toHaveLength(0);
  });

  it("refuses to change the theme of a finished game", async () => {
    stubSupabase(() => ({ data: [], error: null }));

    await expect(updateItoGameTheme(GAME.id, "テーマ")).rejects.toThrow("終了したゲーム");
  });
});

describe("ito game deletion", () => {
  it("refuses a member without the system permission", async () => {
    getCurrentProfile.mockResolvedValue(MEMBER);
    const { calls } = stubSupabase(() => ({ data: [{ id: GAME.id }], error: null }));

    await expect(deleteItoGame(GAME.id)).rejects.toThrow("システム管理者");
    expect(calls).toHaveLength(0);
  });

  it("deletes only a draft or a finished game", async () => {
    const { calls } = stubSupabase(() => ({ data: [{ id: GAME.id }], error: null }));

    await deleteItoGame(GAME.id);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("ito_games");
    expect(calls[0].op).toBe("delete");
    expect(calls[0].filters).toEqual({
      id: GAME.id,
      status: ["draft", "finished"],
    });
  });

  it("keeps a running game until it is finished", async () => {
    // 進行中のゲームは status 条件に合わず0行になる。
    stubSupabase(() => ({ data: [], error: null }));

    await expect(deleteItoGame(GAME.id)).rejects.toThrow("終了してから削除");
  });
});

describe("ito round progress", () => {
  const ROUND = { id: "round1", game_id: GAME.id, round_no: 1, phase: "leader_select" };

  it("refuses a member without the system permission", async () => {
    getCurrentProfile.mockResolvedValue(MEMBER);
    const { calls, rpc } = stubSupabase(() => ({ data: null, error: null }));

    await expect(advanceItoRound(ROUND.id, "numbers")).rejects.toThrow("システム管理者");
    expect(calls).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not close leader selection while a group has no leader", async () => {
    const { rpc } = stubSupabase((call) => {
      if (call.table === "ito_rounds") return { data: ROUND, error: null };
      if (call.table === "ito_groups") {
        return {
          data: [
            { id: "gA", name: "A班", is_leader_team: false },
            { id: "gB", name: "B班", is_leader_team: false },
            { id: "gL", name: "代表者チーム", is_leader_team: true },
          ],
          error: null,
        };
      }
      if (call.table === "ito_group_members") {
        // A班だけ代表者が決まっている。
        return { data: [{ group_id: "gA", is_leader: true }], error: null };
      }
      return { data: null, error: null };
    });

    await expect(advanceItoRound(ROUND.id, "numbers")).rejects.toThrow("B班");
    // フェーズは進めず、秘密数字も配らない。
    expect(rpc).not.toHaveBeenCalled();
  });

  it("distributes the secret numbers right after closing leader selection", async () => {
    const { rpc } = stubSupabase((call) => {
      if (call.table === "ito_rounds") return { data: ROUND, error: null };
      if (call.table === "ito_groups") {
        return { data: [{ id: "gA", name: "A班", is_leader_team: false }], error: null };
      }
      if (call.table === "ito_group_members") {
        return { data: [{ group_id: "gA", is_leader: true }], error: null };
      }
      return { data: null, error: null };
    });

    await advanceItoRound(ROUND.id, "numbers");

    expect(rpc).toHaveBeenNthCalledWith(1, "ito_advance_phase", {
      target_round_id: ROUND.id,
      to_phase: "numbers",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "ito_assign_secrets", {
      target_round_id: ROUND.id,
    });
  });

  it("will not start a round while another one is running", async () => {
    stubSupabase((call) => {
      if (call.table === "ito_games") return { data: { ...GAME, status: "active" }, error: null };
      if (call.table === "ito_rounds") {
        return { data: [{ id: "round1", phase: "ordering" }], error: null };
      }
      return { data: null, error: null };
    });

    await expect(startItoRound(GAME.id)).rejects.toThrow("進行中のラウンド");
  });

  it("will not start a round before the entry is closed", async () => {
    stubSupabase((call) =>
      call.table === "ito_games"
        ? { data: { ...GAME, status: "entry" }, error: null }
        : { data: [], error: null },
    );

    await expect(startItoRound(GAME.id)).rejects.toThrow("エントリーを締め切って");
  });

  it("stops a round that cannot be split into valid groups", async () => {
    stubSupabase((call) => {
      if (call.table === "ito_games") {
        return { data: { ...GAME, status: "active", group_count: 10 }, error: null };
      }
      if (call.table === "ito_rounds") return { data: [], error: null };
      if (call.table === "ito_participants") {
        // 10グループに対して3人しかいない。
        return { data: [{ profile_id: "m1" }, { profile_id: "m2" }, { profile_id: "m3" }], error: null };
      }
      return { data: null, error: null };
    });

    await expect(startItoRound(GAME.id)).rejects.toThrow("必要です");
  });
});
