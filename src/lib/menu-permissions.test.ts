import { describe, it, expect } from "vitest";
import type { AppRole } from "@/types";
import { editableMenuBlocks, menuAccess } from "./menu-permissions";
import { canModerateComments } from "./permissions";
import { canManageObMeet } from "./ob-meet";
import { namedRoleCapabilities } from "./role-capabilities";

const role = (name: string, create = true, suppressed = false) => ({ name, can_create_menu: create, permissions_suppressed: suppressed } as AppRole);
describe("block menu editing", () => {
  it.each([
    ["短距離ブロック長", "short"], ["投擲ブロック長", "short"], ["跳躍ブロック長", "short"],
    ["中距離ブロック長", "middle_long"], ["長距離ブロック長", "middle_long"],
  ])("maps %s to the current block", (name, block) => {
    expect(editableMenuBlocks([role(name)])).toEqual([block]);
    expect(namedRoleCapabilities(name)).toHaveLength(1);
  });
  it("requires creation permission, supports combined roles and suppresses preview", () => {
    expect(editableMenuBlocks([role("短距離ブロック長", false)])).toEqual([]);
    expect(editableMenuBlocks([role("短距離ブロック長", false), role("担当")])).toEqual(["short"]);
    expect(editableMenuBlocks([role("短距離ブロック長", true, true), role("担当")])).toEqual([]);
    expect(editableMenuBlocks([role("主将")])).toEqual([]);
  });
  it("allows editing own block but not deleting another author's menu", () => {
    const access = { userId: "leader", authorId: "other", canCreate: true, canManageAll: false, editableBlocks: ["short" as const] };
    for (const targetBlock of ["short", "jump", "throw"] as const) expect(menuAccess({ ...access, targetBlock })).toEqual({ canEdit: true, canDelete: false });
    for (const targetBlock of ["middle_long", null] as const) expect(menuAccess({ ...access, targetBlock })).toEqual({ canEdit: false, canDelete: false });
  });
  it("requires current creation permission for owners and allows member managers", () => {
    const access = { userId: "owner", authorId: "owner", targetBlock: null, canCreate: false, canManageAll: false };
    expect(menuAccess(access)).toEqual({ canEdit: false, canDelete: false });
    expect(menuAccess({ ...access, canCreate: true })).toEqual({ canEdit: true, canDelete: true });
    expect(menuAccess({ ...access, authorId: "other", canManageAll: true })).toEqual({ canEdit: true, canDelete: true });
  });
  it("hides name-based moderation and OB powers during preview", () => {
    expect(canModerateComments([role("管理者", true, true)])).toBe(false);
    expect(canManageObMeet([role("OB戦2026", true, true)])).toBe(false);
    expect(namedRoleCapabilities("管理者")).toHaveLength(1);
    expect(namedRoleCapabilities("OB戦2026")).toHaveLength(1);
  });
});
