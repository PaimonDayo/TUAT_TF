import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import type { Database } from "@/types/database";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getCurrentProfile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/auth", () => ({ getCurrentProfile: mocks.getCurrentProfile }));

import { getMemberSheetSettings } from "./sheet-settings";

type SettingsRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "blocks" | "grade" | "status" | "sheet_name" | "sheet_transition" | "record_fields"
>;

function role(overrides: Partial<AppRole> = {}): AppRole {
  return {
    id: "role", name: "担当", color: "blue", category: null, is_everyone: false,
    is_system: false, sort_order: 0, created_at: "2026-10-15T00:00:00Z",
    can_manage_system: false, can_manage_members: false, can_create_notice: false,
    can_create_menu: false, can_create_schedule: false, can_decide_practice: false,
    ...overrides,
  };
}

function member(index = 0, overrides: Partial<SettingsRow> = {}): SettingsRow {
  return {
    id: `member-${String(index).padStart(4, "0")}`, display_name: `部員${index}`,
    blocks: ["short"], grade: "B2", status: "active", sheet_name: null,
    sheet_transition: null, record_fields: [], ...overrides,
  };
}

describe("member sheet settings", () => {
  const query = { select: vi.fn(), order: vi.fn(), range: vi.fn() };
  const from = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    query.select.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.range.mockResolvedValue({ data: [], error: null });
    from.mockReturnValue(query);
    mocks.createClient.mockResolvedValue({ from });
    mocks.getCurrentProfile.mockResolvedValue({ roles: [role({ can_manage_system: true })] });
  });

  it.each([
    { name: "権限なし", roles: [] },
    { name: "部員管理のみ", roles: [role({ name: "管理者", can_manage_members: true })] },
    { name: "一般部員プレビュー", roles: [role({ can_manage_system: true, permissions_suppressed: true })] },
  ])("rejects $name before reading the member settings", async ({ roles }) => {
    mocks.getCurrentProfile.mockResolvedValue({ roles });
    await expect(getMemberSheetSettings()).rejects.toThrow("システム管理権限が必要です");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts a system permission from any unsuppressed role", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ roles: [
      role({ can_manage_members: true }),
      role({ id: "system", name: "システム担当", can_manage_system: true }),
    ] });
    query.range.mockResolvedValue({ data: [member()], error: null });
    expect(await getMemberSheetSettings()).toHaveLength(1);
  });

  it("propagates failed authentication or role loading before reading settings", async () => {
    mocks.getCurrentProfile.mockRejectedValue(new Error("権限情報を取得できませんでした"));
    await expect(getMemberSheetSettings()).rejects.toThrow("権限情報を取得できませんでした");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns only current selections and the disconnected mode without exposing legacy settings", async () => {
    const current = [{ key: "memo", label: "現在の感想", type: "text", showInTimeline: false, sourceColumn: 4 }];
    const legacy = [{ key: "old", label: "旧項目", type: "text" }];
    const transition = {
      version: "2026-10", mode: "off", confirmed_at: "2026-10-15T00:00:00Z",
      legacy: { sheet_name: "旧シート", record_fields: legacy, sheet_header_signature: null, record_source: "sheet" },
    };
    query.range.mockResolvedValue({ data: [member(0, {
      sheet_name: "保持されたシート", sheet_transition: transition, record_fields: current,
      blocks: ["middle_long", "unknown"], status: "graduated",
    })], error: null });

    const result = await getMemberSheetSettings();
    expect(result[0]).toMatchObject({
      record_fields: current, sheet_name: "保持されたシート", sheet_transition: { mode: "off" },
      blocks: ["middle_long"], status: "graduated",
    });
    expect(result[0].sheet_transition).toEqual({ mode: "off" });
    expect(JSON.stringify(result)).not.toContain("旧シート");
    expect(JSON.stringify(result)).not.toContain("旧項目");
    expect(JSON.stringify(result)).not.toContain("legacy");
    expect(from).toHaveBeenCalledExactlyOnceWith("profiles");
    expect(query.select).toHaveBeenCalledExactlyOnceWith(
      "id, display_name, blocks, grade, status, sheet_name, sheet_transition, record_fields",
    );
    expect(Object.keys(result[0]).sort()).toEqual([
      "blocks", "display_name", "grade", "id", "record_fields", "sheet_name", "sheet_transition", "status",
    ]);
  });

  it("normalizes an unconfigured profile without inventing selected fields", async () => {
    query.range.mockResolvedValue({ data: [member(0, {
      record_fields: [{ key: "invalid", label: "無効", type: "unknown" }],
      sheet_transition: { version: "unknown", mode: "sheet" },
    })], error: null });
    expect((await getMemberSheetSettings())[0]).toMatchObject({
      record_fields: [], sheet_transition: null, sheet_name: null,
    });
  });

  it("loads all members across more than two pages in a stable id order", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => member(index));
    query.range.mockImplementation(async (start: number, end: number) => ({
      data: rows.slice(start, end + 1), error: null,
    }));
    const result = await getMemberSheetSettings();
    expect(result.map((item) => item.id)).toEqual(rows.map((item) => item.id));
    expect(query.range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(query.order).toHaveBeenCalledTimes(3);
    for (const call of query.order.mock.calls) expect(call).toEqual(["id", { ascending: true }]);
  });

  it("returns an empty list only after a successful empty request", async () => {
    expect(await getMemberSheetSettings()).toEqual([]);
    expect(query.range).toHaveBeenCalledExactlyOnceWith(0, 499);
  });

  it("rejects a later page failure instead of returning a partial list", async () => {
    query.range
      .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => member(index)), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "connection lost" } });
    await expect(getMemberSheetSettings()).rejects.toThrow("部員のスプレッドシート設定を取得できませんでした");
    expect(query.range.mock.calls).toEqual([[0, 499], [500, 999]]);
  });

  it("does not turn a missing response into an empty list", async () => {
    query.range.mockResolvedValue({ data: null, error: null });
    await expect(getMemberSheetSettings()).rejects.toThrow("部員のスプレッドシート設定を取得できませんでした");
  });
});
