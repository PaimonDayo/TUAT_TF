import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import type { Database, Json } from "@/types/database";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getCurrentProfile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/auth", () => ({ getCurrentProfile: mocks.getCurrentProfile }));

import { getMemberSheetSettings, getMemberSheetSettingsById } from "./sheet-settings";

type SettingsRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "avatar_url" | "blocks" | "grade" | "status" | "sheet_name" | "sheet_transition" | "record_fields" | "record_source"
>;

const currentFields = [{ key: "memo", label: "現在の感想", type: "text", showInTimeline: false, sourceColumn: 4 }];
const legacyFields = [{ key: "old", label: "旧項目", type: "number", showInTimeline: true, sourceColumn: 2 }];
const metadataKeys = ["avatar_url", "blocks", "display_name", "grade", "id", "status"];
const loadError = "部員のスプレッドシート設定を取得できませんでした";

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
    avatar_url: "https://example.test/avatar.png", blocks: ["short"], grade: "B2", status: "active",
    sheet_name: "現在のシート", record_source: "sheet", record_fields: currentFields,
    sheet_transition: null, ...overrides,
  };
}

function transition(overrides: { mode?: string; confirmed_at?: string; legacy?: Json } = {}): Json {
  return {
    version: "2026-10", mode: "sheet", confirmed_at: "2026-10-15T00:00:00Z",
    legacy: {
      sheet_name: "旧シート", record_fields: legacyFields,
      sheet_header_signature: "旧見出しの内部情報", record_source: "app",
    },
    ...overrides,
  };
}

describe("member sheet settings", () => {
  const query = { select: vi.fn(), order: vi.fn(), range: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  const from = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    query.select.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.range.mockResolvedValue({ data: [], error: null });
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    from.mockReturnValue(query);
    mocks.createClient.mockResolvedValue({ from });
    mocks.getCurrentProfile.mockResolvedValue({ roles: [role({ can_manage_system: true })] });
  });

  it.each([
    { name: "権限なし", roles: [] },
    { name: "部員管理のみ", roles: [role({ name: "管理者", can_manage_members: true })] },
    { name: "一般部員プレビュー", roles: [role({ can_manage_system: true, permissions_suppressed: true })] },
  ])("rejects $name before reading either the list or detail", async ({ roles }) => {
    mocks.getCurrentProfile.mockResolvedValue({ roles });
    await expect(getMemberSheetSettings()).rejects.toThrow("システム管理権限が必要です");
    await expect(getMemberSheetSettingsById("member-0000")).rejects.toThrow("システム管理権限が必要です");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts a system permission from any unsuppressed role for the list and detail", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ roles: [
      role({ can_manage_members: true }),
      role({ id: "system", name: "システム担当", can_manage_system: true }),
    ] });
    query.range.mockResolvedValue({ data: [member()], error: null });
    query.maybeSingle.mockResolvedValue({ data: member(), error: null });
    expect(await getMemberSheetSettings()).toHaveLength(1);
    expect(await getMemberSheetSettingsById("member-0000")).toMatchObject({ id: "member-0000" });
  });

  it("propagates failed authentication or role loading before reading settings", async () => {
    mocks.getCurrentProfile.mockRejectedValue(new Error("権限情報を取得できませんでした"));
    await expect(getMemberSheetSettings()).rejects.toThrow("権限情報を取得できませんでした");
    await expect(getMemberSheetSettingsById("member-0000")).rejects.toThrow("権限情報を取得できませんでした");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("requests and returns only metadata for the member directory", async () => {
    query.range.mockResolvedValue({ data: [{
      ...member(0, { sheet_transition: transition(), blocks: ["middle_long", "unknown"], status: "graduated" }),
      email: "private@example.test", record_body: "記録本文",
    }], error: null });

    const result = await getMemberSheetSettings();
    expect(result[0]).toEqual({
      id: "member-0000", display_name: "部員0", avatar_url: "https://example.test/avatar.png",
      blocks: ["middle_long"], grade: "B2", status: "graduated",
    });
    expect(from).toHaveBeenCalledExactlyOnceWith("profiles");
    expect(query.select).toHaveBeenCalledExactlyOnceWith("id, display_name, avatar_url, blocks, grade, status");
    expect(Object.keys(result[0]).sort()).toEqual(metadataKeys);
    expect(JSON.stringify(result)).not.toMatch(/現在の|旧シート|旧項目|private|記録本文|legacy/);
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
    await expect(getMemberSheetSettings()).rejects.toThrow(loadError);
    expect(query.range.mock.calls).toEqual([[0, 499], [500, 999]]);
  });

  it("does not turn a missing list response into an empty list", async () => {
    query.range.mockResolvedValue({ data: null, error: null });
    await expect(getMemberSheetSettings()).rejects.toThrow(loadError);
  });

  it("distinguishes an absent member from a failed detail request", async () => {
    expect(await getMemberSheetSettingsById("missing")).toBeNull();
    expect(query.eq).toHaveBeenCalledExactlyOnceWith("id", "missing");
    query.maybeSingle.mockResolvedValue({ data: null, error: { message: "connection lost" } });
    await expect(getMemberSheetSettingsById("missing")).rejects.toThrow(loadError);
  });

  it("keeps current and legacy selections separate and returns only their display projection", async () => {
    query.maybeSingle.mockResolvedValue({ data: {
      ...member(0, { sheet_transition: transition() }),
      email: "private@example.test", record_body: "記録本文",
    }, error: null });

    const result = await getMemberSheetSettingsById("member-0000");
    expect(result?.periods).toEqual([
      {
        id: "october", label: "2026年10月1日以降", sheet_name: "現在のシート",
        mode: "sheet", fields: currentFields, editable: true,
      },
      {
        id: "legacy", label: "2026年9月30日以前（連携終了）", sheet_name: "旧シート",
        mode: "app_only", fields: legacyFields, editable: false,
      },
    ]);
    expect(query.select).toHaveBeenCalledExactlyOnceWith(
      "id, display_name, avatar_url, blocks, grade, status, sheet_name, record_source, record_fields, sheet_transition",
    );
    expect(query.eq).toHaveBeenCalledExactlyOnceWith("id", "member-0000");
    expect(Object.keys(result!).sort()).toEqual([...metadataKeys, "periods"].sort());
    for (const period of result!.periods) {
      expect(Object.keys(period).sort()).toEqual(["editable", "fields", "id", "label", "mode", "sheet_name"]);
    }
    expect(JSON.stringify(result)).not.toMatch(/sheet_header_signature|旧見出しの内部情報|sheet_transition|record_source|private|記録本文/);
  });

  it.each([
    { source: "sheet", mode: "sheet" },
    { source: "app", mode: "app_only" },
  ])("shows pre-transition profile settings only in legacy for $source", async ({ source, mode }) => {
    query.maybeSingle.mockResolvedValue({ data: member(0, {
      record_source: source, sheet_name: "移行前シート", record_fields: legacyFields,
    }), error: null });
    expect((await getMemberSheetSettingsById("member-0000"))?.periods).toEqual([
      {
        id: "october", label: "2026年10月1日以降", sheet_name: null,
        mode: null, fields: [], editable: false,
      },
      {
        id: "legacy", label: "2026年9月30日以前（連携終了）", sheet_name: "移行前シート",
        mode, fields: legacyFields, editable: false,
      },
    ]);
  });

  it("treats an invalid transition as unconfirmed without mixing its raw fields into current", async () => {
    query.maybeSingle.mockResolvedValue({ data: member(0, {
      sheet_transition: { version: "unknown", mode: "sheet", legacy: { record_fields: currentFields } },
      record_fields: legacyFields,
    }), error: null });
    const periods = (await getMemberSheetSettingsById("member-0000"))!.periods;
    expect(periods[0]).toMatchObject({ sheet_name: null, mode: null, fields: [], editable: false });
    expect(periods[1].fields).toEqual(legacyFields);
  });

  it.each([
    { mode: "sheet", editable: true },
    { mode: "app_only", editable: true },
    { mode: "off", editable: false },
  ])("preserves current fields in $mode mode with editable=$editable", async ({ mode, editable }) => {
    query.maybeSingle.mockResolvedValue({ data: member(0, { sheet_transition: transition({ mode }) }), error: null });
    expect((await getMemberSheetSettingsById("member-0000"))?.periods[0]).toMatchObject({
      mode, fields: currentFields, sheet_name: "現在のシート", editable,
    });
  });

  it.each(["2026-09-30T00:41:02Z", "invalid", ""])(
    "keeps current settings visible but read-only when confirmation time is %s",
    async (confirmed_at) => {
      query.maybeSingle.mockResolvedValue({ data: member(0, {
        sheet_transition: transition({ confirmed_at }),
      }), error: null });
      expect((await getMemberSheetSettingsById("member-0000"))?.periods[0]).toMatchObject({
        sheet_name: "現在のシート", mode: "sheet", fields: currentFields, editable: false,
      });
    },
  );

  it("does not enable current editing without a linked sheet", async () => {
    query.maybeSingle.mockResolvedValue({ data: member(0, {
      sheet_name: null, sheet_transition: transition(),
    }), error: null });
    expect((await getMemberSheetSettingsById("member-0000"))?.periods[0]).toMatchObject({
      sheet_name: null, fields: currentFields, editable: false,
    });
  });

  it("normalizes unknown blocks and malformed field definitions in both periods", async () => {
    query.maybeSingle.mockResolvedValue({ data: member(0, {
      blocks: ["short", "unknown", "manager"],
      record_fields: [null, { key: "invalid", label: "無効", type: "unknown" }, ...currentFields],
      sheet_transition: transition({
        legacy: {
          sheet_name: "旧シート", record_source: "sheet", record_fields: [
            null, { key: "missing-type", label: "無効" },
            { ...legacyFields[0], unexpected: "非表示の生JSON" },
          ],
        },
      }),
    }), error: null });
    const result = await getMemberSheetSettingsById("member-0000");
    expect(result?.blocks).toEqual(["short", "manager"]);
    expect(result?.periods[0].fields).toEqual(currentFields);
    expect(result?.periods[1]).toMatchObject({ mode: "sheet", fields: legacyFields, editable: false });
    expect(JSON.stringify(result)).not.toContain("非表示の生JSON");
  });
});
