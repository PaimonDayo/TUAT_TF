import { describe, expect, it } from "vitest";
import { describeObChange, historyProfileIds } from "./ob-entry-history";
import { canManageObMeet, canViewObHistory } from "./ob-meet";
const base = { id:"change", changed_at:"2026-09-28T00:00:00Z", actor_id:"actor", before_data:null, after_data:{} };
describe("OB permissions and history", () => {
  it("separates staff editing from administrator history", () => {
    const staff = [{name:"OB戦2026",can_manage_system:false,can_manage_members:false}];
    const admin = [{name:"管理者",can_manage_system:false,can_manage_members:true}];
    const system = [{name:"システム",can_manage_system:true,can_manage_members:false}];
    expect(canManageObMeet(staff)).toBe(true);
    for (const roles of [admin, system]) { expect(canManageObMeet(roles)).toBe(false); expect(canViewObHistory(roles)).toBe(true); }
    expect(canViewObHistory(staff)).toBe(false);
    expect(canManageObMeet(null)).toBe(false); expect(canViewObHistory([])).toBe(false);
  });
  it("shows event removal/addition, mark differences and identity changes", () => {
    const result = describeObChange({...base, before_data:{events:["男子100m","男子300m"],qualification_marks:{"男子100m":"12.0"},profile_id:"old"},after_data:{submitted_name:"対象",events:["男子100m","男子1500m"],qualification_marks:{"男子100m":"11.9"},profile_id:"new"}}, new Map([["actor","担当者"],["old","変更前"],["new","変更後"]]));
    expect(result.actor).toBe("担当者"); expect(result.subject).toBe("対象");
    expect(result.details).toEqual(expect.arrayContaining(["種目追加：男子1500m","種目取消：男子300m","資格記録（男子100m）：12.0 → 11.9","本人との紐付け：変更前 → 変更後"]));
  });
  it("does not invent a missing actor and shows party changes", () => {
    const result=describeObChange({...base,actor_id:null,before_data:{status:"参加"},after_data:{change_type:"party",status:"不参加"}},new Map());
    expect(result.actor).toContain("不明"); expect(result.details).toContain("懇親会：参加 → 不参加");
  });
  it("collects actor and identity profiles, handling malformed snapshots", () => {
    expect(historyProfileIds([{...base,before_data:{profile_id:"old"},after_data:{profile_id:"actor"}},{...base,actor_id:null,after_data:[]}])).toEqual(["actor","old"]);
    expect(describeObChange({...base,before_data:[],after_data:null},new Map()).details.length).toBeGreaterThan(0);
  });
});
