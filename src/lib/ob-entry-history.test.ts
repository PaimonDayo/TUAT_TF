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
  it.each([["男子1500m", "番号"], ["女子3000m", "番号"]])("uses the event's order label for %s", (event_name, label) => {
    const result = describeObOperationChange({ ...operation, event_name, before_data: { participants: [person] }, after_data: { participants: [{ ...person, order: 1 }] } }, new Map(), new Map());
    expect(result.details).toContainEqual(expect.objectContaining({ label, before: "未割当", after: "1" }));
  });
  it("uses the full field snapshots for trial ordinals across legacy groups and inactive people", () => {
    const first = { ...person, entryId: "first", group: 1, order: 7 };
    const dns = { ...person, entryId: "dns", group: 2, order: 1, status: "DNS" };
    const last = { ...person, entryId: "last", group: 2, order: 1 };
    const result = describeObOperationChange({ ...operation, event_name: "男子走り幅跳び", before_data: { participants: [last, dns, first] }, after_data: { participants: [{ ...first, group: 2, order: 1 }, dns, { ...last, group: 1, order: 7 }] } }, new Map(), new Map([["first", "先の人"], ["dns", "DNSの人"], ["last", "後の人"]]));
    expect(result.details).toEqual(expect.arrayContaining([
      { subject: "先の人", label: "種目内の試技順", before: "1", after: "3" },
      { subject: "後の人", label: "種目内の試技順", before: "3", after: "1" },
    ]));
    expect(result.details.some(detail => detail.subject === "DNSの人")).toBe(false);
    expect(result.categories).toEqual(["試技順"]);
    expect(JSON.stringify(result)).not.toContain("entryId");
  });
  it("preserves old field placement edits when their visible ordinal does not change", () => {
    const result = describeObOperationChange({ ...operation, event_name: "女子砲丸投げ", before_data: { participants: [{ ...person, group: 1, order: 3 }] }, after_data: { participants: [{ ...person, group: 2, order: 7 }] } }, new Map(), new Map([["entry", "対象"]]));
    expect(result.details).toEqual([
      { subject: "対象", label: "保存時の組情報", before: "1", after: "2" },
      { subject: "対象", label: "保存時の順番", before: "3", after: "7" },
    ]);
    const incomplete = describeObOperationChange({ ...operation, event_name: "男子走り高跳び", before_data: { participants: [person] }, after_data: { participants: [{ ...person, order: 1 }] } }, new Map(), new Map());
    expect(incomplete.details).toContainEqual(expect.objectContaining({ label: "保存時の順番", before: "未割当", after: "1" }));
  });
  it("shows a heat scope change as a physical position change and ignores an explicit unchanged default", () => {
    const saved = { ...person, group: 1, order: 2 };
    const result = describeObOperationChange({ ...operation, before_data: { participants: [saved] }, after_data: { participants: [{ ...saved, heatScope: "混合" }] } }, new Map(), new Map([["entry", "対象"]]));
    expect(result.details).toContainEqual({ subject: "対象", label: "組", before: "男子1組", after: "混合1組" });
    const unchanged = describeObOperationChange({ ...operation, before_data: { participants: [saved] }, after_data: { participants: [{ ...saved, heatScope: "男子" }] } }, new Map(), new Map());
    expect(unchanged.details).toEqual([{ label: "競技情報", before: null, after: "保存（表示項目の変更なし）" }]);
    const next = { ...saved, group: 2 };
    const contextual = describeObOperationChange({ ...operation, before_data: { participants: [saved], family_positions: [{ event_name: operation.event_name, participants: [saved] }] }, after_data: { participants: [next], family_positions: [{ event_name: operation.event_name, participants: [next] }] } }, new Map(), new Map([["entry", "対象"]]));
    expect(contextual.details).toContainEqual({ subject: "対象", label: "組", before: "男子1組", after: "男子2組" });
  });
  it.each([1, 600])("uses family context for exact field ranks and shifted peers at saved order %s", order => {
    const male = { ...person, group: 1, order };
    const female = { ...male, entryId: "female" };
    const moved = { ...male, heatScope: "混合" };
    const before = { participants: [male], confirmed: false, family_positions: [{ event_name: "男子走り幅跳び", participants: [male] }, { event_name: "女子走り幅跳び", participants: [female] }] };
    const after = { participants: [moved], confirmed: false, family_positions: [{ event_name: "男子走り幅跳び", participants: [moved] }, { event_name: "女子走り幅跳び", participants: [female] }] };
    const change = { ...operation, event_name: "男子走り幅跳び", before_data: before, after_data: after };
    expect(historyEntryIds([change])).toEqual(["entry", "female"]);
    const result = describeObOperationChange(change, new Map(), new Map([["entry", "男性対象"], ["female", "女性対象"]]));
    expect(result.details).toEqual([
      { subject: "男子 男性対象", label: "試技順", before: "1", after: "2" },
      { subject: "女子 女性対象", label: "試技順", before: "2", after: "1" },
    ]);
    const json = JSON.stringify(result);
    expect(json).not.toContain("family_positions"); expect(json).not.toContain("entryId"); expect(json).not.toContain("heatScope");
  });
  it("retains qualified raw field facts when a shared family snapshot is unavailable or malformed", () => {
    const saved = { ...person, group: 1, order: 1 };
    const result = describeObOperationChange({ ...operation, event_name: "男子走り幅跳び", before_data: { participants: [saved] }, after_data: { participants: [{ ...saved, heatScope: "混合" }], family_positions: [{ event_name: "女子走り幅跳び", participants: [{ ...saved, status: "private-invalid-status" }] }] } }, new Map(), new Map([["entry", "対象"]]));
    expect(result.details).toContainEqual({ subject: "対象", label: "保存時の組情報", before: "男子1組", after: "混合1組" });
    expect(result.details.some(detail => detail.label === "試技順")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-invalid-status");
  });
  it("recognizes the first saved operation when before-data only contains family audit metadata", () => {
    const male = { ...person, group: 1, order: 1 };
    const female = { ...male, entryId: "female" };
    const before = { family_positions: [{ event_name: "女子走り幅跳び", participants: [female] }] };
    const after = { confirmed: false, participants: [male], family_positions: [{ event_name: "男子走り幅跳び", participants: [male] }, { event_name: "女子走り幅跳び", participants: [female] }] };
    const result = describeObOperationChange({ ...operation, event_name: "男子走り幅跳び", before_data: before, after_data: after }, new Map(), new Map([["entry", "対象"], ["female", "別の人"]]));
    expect(result.details).toContainEqual({ label: "記録の確定", before: "保存なし", after: "速報" });
    expect(result.details).toContainEqual({ subject: "女子 別の人", label: "試技順", before: "1", after: "2" });
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
