import { describe, expect, it } from "vitest";
import { compareObHistoryPosition, describeObChange, describeObOperationChange, historyEntryIds, historyProfileIds } from "./ob-entry-history";
import { canManageObMeet, canViewObHistory } from "./ob-meet";
const base = { id: "change", changed_at: "2026-09-28T00:00:00Z", actor_id: "actor", before_data: null, after_data: {} };
const operation = { ...base, meet_key: "ob-2026", event_name: "男子100m" };
const person = { entryId: "entry", group: null, order: null, status: "entered", trials: [] };

describe("OB permissions and history", () => {
  it("allows staff history without granting administrators staff editing", () => {
    const staff = [{ name: "OB戦2026", can_manage_system: false, can_manage_members: false }];
    const admin = [{ name: "管理者", can_manage_system: false, can_manage_members: true }];
    const system = [{ name: "システム", can_manage_system: true, can_manage_members: false }];
    expect(canManageObMeet(staff)).toBe(true); expect(canViewObHistory(staff)).toBe(true);
    for (const roles of [admin, system]) { expect(canManageObMeet(roles)).toBe(false); expect(canViewObHistory(roles)).toBe(true); }
    for (const roles of [staff, admin, system]) expect(canViewObHistory(roles.map(role => ({ ...role, permissions_suppressed: true })))).toBe(false);
    expect(canViewObHistory([{ name: "全員", can_manage_system: false, can_manage_members: false }])).toBe(false);
    expect(canManageObMeet(null)).toBe(false); expect(canViewObHistory([])).toBe(false);
  });
  it("shows event removal/addition, mark differences and identity changes as before/after fields", () => {
    const result = describeObChange({ ...base, before_data: { events: ["男子100m", "男子300m"], qualification_marks: { "男子100m": "12.0" }, profile_id: "old" }, after_data: { submitted_name: "対象", events: ["男子100m", "男子1500m"], qualification_marks: { "男子100m": "11.9" }, profile_id: "new" } }, new Map([["actor", "担当者"], ["old", "以前の部員"], ["new", "確認した部員"]]));
    expect(result.actor).toBe("担当者"); expect(result.subject).toBe("対象");
    expect(result.details).toEqual(expect.arrayContaining([
      { label: "種目追加", before: "未登録", after: "男子1500m" },
      { label: "種目取消", before: "男子300m", after: "取消" },
      { label: "資格記録（男子100m）", before: "12.0", after: "11.9" },
      { label: "本人との紐付け", before: "以前の部員", after: "確認した部員" },
    ]));
    expect(result.categories).toEqual(expect.arrayContaining(["出場種目", "資格記録", "本人照合"]));
  });
  it("shows attendance, review status and party-only changes without inventing a missing actor", () => {
    const attendance = describeObChange({ ...base, before_data: { absent: false }, after_data: { submitted_name: "対象", absent: true } }, new Map());
    expect(attendance.details).toContainEqual({ label: "大会への参加", before: "参加", after: "欠席" });
    const result = describeObChange({ ...base, actor_id: null, before_data: { status: "参加", needs_review: true }, after_data: { change_type: "party", status: "不参加", needs_review: false } }, new Map());
    expect(result.actor).toContain("不明");
    expect(result.details).toContainEqual({ label: "懇親会の出欠", before: "参加", after: "不参加" });
    expect(result.details).toContainEqual({ label: "本人確認", before: "確認待ち", after: "確認済み" });
  });
  it("retains the deleted target and reports removed qualification marks", () => {
    const deletion = describeObChange({ ...base, before_data: { submitted_name: "削除した人" }, after_data: { change_type: "entry_deleted" } }, new Map());
    expect(deletion.subject).toBe("削除した人"); expect(deletion.categories).toEqual(["削除"]);
    const marks = describeObChange({ ...base, before_data: { events: ["男子100m"], qualification_marks: { "男子100m": "12.0" } }, after_data: { events: [], qualification_marks: {} } }, new Map());
    expect(marks.details).toContainEqual({ label: "資格記録（男子100m）", before: "12.0", after: "未入力" });
  });
  it("collects names without exposing arbitrary snapshot fields", () => {
    expect(historyProfileIds([{ ...base, before_data: { profile_id: "old" }, after_data: { profile_id: "actor" } }, { ...base, actor_id: null, after_data: [] }])).toEqual(["actor", "old"]);
    expect(historyEntryIds([{ ...operation, before_data: { participants: [person, null] }, after_data: { participants: [{ ...person, entryId: "new" }, { private: "hidden" }] } }])).toEqual(["entry", "new"]);
    expect(describeObChange({ ...base, before_data: [], after_data: null }, new Map()).details.length).toBeGreaterThan(0);
    const result = describeObOperationChange({ ...operation, after_data: { participants: [person], private: "hidden" } }, new Map(), new Map());
    expect(JSON.stringify(result)).not.toContain("hidden"); expect(result).not.toHaveProperty("after_data");
  });
});

describe("OB competition history", () => {
  it("shows group, lane, attendance, mark, trial status, wind and confirmation with target names", () => {
    const beforePerson = { ...person, group: 1, order: 2, status: "DNS", trials: [{ mark: "12.0", status: "valid", wind: "0.1" }] };
    const afterPerson = { ...person, group: 2, order: 3, status: "entered", trials: [{ mark: "11.9", status: "pending", wind: "0.2" }] };
    const result = describeObOperationChange({ ...operation, before_data: { participants: [beforePerson], confirmed: true }, after_data: { participants: [afterPerson], confirmed: false } }, new Map([["actor", "記録係"]]), new Map([["entry", "出場者"]]));
    expect(result).toMatchObject({ id: "operation:change", actor: "記録係", subject: "男子100m" });
    expect(result.details).toEqual(expect.arrayContaining([
      { subject: "出場者", label: "組", before: "1", after: "2" },
      { subject: "出場者", label: "レーン", before: "2", after: "3" },
      { subject: "出場者", label: "出場状況", before: "DNS（欠場）", after: "出場" },
      { subject: "出場者", label: "タイム", before: "12.0", after: "11.9" },
      { subject: "出場者", label: "記録の結果", before: "成功", after: "未記録" },
      { subject: "出場者", label: "記録の風速", before: "0.1", after: "0.2" },
      { label: "記録の確定", before: "確定", after: "速報" },
    ]));
  });
  it.each([["男子1500m", "番号"], ["女子3000m", "番号"], ["男子走り幅跳び", "試技順"]])("uses the event's order label for %s", (event_name, label) => {
    const result = describeObOperationChange({ ...operation, event_name, before_data: { participants: [person] }, after_data: { participants: [{ ...person, order: 1 }] } }, new Map(), new Map());
    expect(result.details).toContainEqual(expect.objectContaining({ label, before: "未割当", after: "1" }));
  });
  it("compares participant identities rather than array positions and preserves deleted trials", () => {
    const second = { ...person, entryId: "second" };
    const result = describeObOperationChange({ ...operation, before_data: { participants: [person, second], confirmed: false }, after_data: { participants: [second, person], confirmed: false } }, new Map(), new Map());
    expect(result.details).toEqual([{ label: "競技情報", before: null, after: "保存（表示項目の変更なし）" }]);
    const trial = describeObOperationChange({ ...operation, event_name: "男子走り高跳び", before_data: { participants: [{ ...person, trials: [{ mark: "1.7", status: "foul", wind: "" }] }] }, after_data: { participants: [person] } }, new Map(), new Map());
    expect(trial.details).toContainEqual(expect.objectContaining({ label: "1回目の結果", before: "失敗", after: "試技なし" }));
    expect(trial.details).toContainEqual(expect.objectContaining({ label: "1回目の記録", before: "1.7", after: "未入力" }));
  });
  it("sorts equivalent offsets and microseconds before the original UUID tie breaker", () => {
    const older = { id: "ffffffff-ffff-ffff-ffff-ffffffffffff", changed_at: "2026-10-05T09:00:00.123004+09:00" };
    const newer = { id: "00000000-0000-0000-0000-000000000001", changed_at: "2026-10-05T00:00:00.123005Z" };
    expect(compareObHistoryPosition(older, newer)).toBeGreaterThan(0);
    expect(compareObHistoryPosition(older, { ...newer, changed_at: "2026-10-05T00:00:00.123004+00:00" })).toBeLessThan(0);
  });
});
