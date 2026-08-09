import { describe, expect, it } from "vitest";
import {
  itoCapacityWarning,
  itoEntryCounts,
  itoInviteTargets,
  validateItoGameForm,
} from "./ito-entry";
import type { AppRole } from "@/types";

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

const CAMP = role("camp2026");
const ADMIN = role("admin", { can_manage_system: true });
const EVERYONE = role("everyone", { is_everyone: true });

describe("ito game form", () => {
  it("accepts a normal setup", () => {
    expect(
      validateItoGameForm({
        name: "合宿2026 ito",
        targetRoleId: CAMP.id,
        groupCount: 10,
        maxGroupSize: 5,
      }),
    ).toEqual([]);
  });

  it("requires a name, a target role and valid group numbers", () => {
    const errors = validateItoGameForm({
      name: "   ",
      targetRoleId: null,
      groupCount: 1,
      maxGroupSize: 1,
    });
    expect(errors.map((error) => error.field)).toEqual([
      "name",
      "targetRoleId",
      "groupCount",
      "maxGroupSize",
    ]);
  });

  it("rejects a non-integer group count (空欄や NaN を弾く)", () => {
    const errors = validateItoGameForm({
      name: "ito",
      targetRoleId: CAMP.id,
      groupCount: Number.NaN,
      maxGroupSize: 5,
    });
    expect(errors.map((error) => error.field)).toEqual(["groupCount"]);
  });
});

describe("ito invite targets", () => {
  const members = [
    { id: "m1", roles: [CAMP] },
    { id: "m2", roles: [CAMP, EVERYONE] },
    { id: "m3", roles: [EVERYONE] },
    { id: "admin1", roles: [CAMP, ADMIN] },
  ];

  it("invites only members holding the target role", () => {
    const targets = itoInviteTargets({ candidates: members, targetRoleId: CAMP.id });
    expect(targets.map((target) => target.id)).toEqual(["m1", "m2"]);
  });

  it("never invites the system administrators (進行専任)", () => {
    const targets = itoInviteTargets({ candidates: members, targetRoleId: CAMP.id });
    expect(targets.map((target) => target.id)).not.toContain("admin1");
  });

  it("covers everyone when the target role applies to all members", () => {
    const targets = itoInviteTargets({ candidates: members, targetRoleId: EVERYONE.id });
    expect(targets.map((target) => target.id)).toEqual(["m2", "m3"]);
  });

  it("does not invite the same person twice in one round", () => {
    const targets = itoInviteTargets({
      candidates: members,
      targetRoleId: CAMP.id,
      alreadyInvitedIds: ["m1"],
    });
    expect(targets.map((target) => target.id)).toEqual(["m2"]);
  });
});

describe("ito entry counts", () => {
  it("keeps unanswered separate from an explicit decline", () => {
    expect(
      itoEntryCounts([
        { status: "joined" },
        { status: "joined" },
        { status: "declined" },
        { status: "pending" },
        { status: "pending" },
        { status: "pending" },
      ]),
    ).toEqual({ target: 6, joined: 2, declined: 1, pending: 3 });
  });

  it("counts nothing before any invitation is sent", () => {
    expect(itoEntryCounts([])).toEqual({ target: 0, joined: 0, declined: 0, pending: 0 });
  });
});

describe("ito capacity warning", () => {
  it("says nothing when the setup fits", () => {
    expect(itoCapacityWarning({ joined: 48, groupCount: 10, maxGroupSize: 5 })).toBeNull();
  });

  it("warns when the groups cannot hold everyone", () => {
    expect(itoCapacityWarning({ joined: 51, groupCount: 10, maxGroupSize: 5 })).toContain(
      "50人まで",
    );
  });

  it("warns when a group would end up with fewer than two people", () => {
    expect(itoCapacityWarning({ joined: 12, groupCount: 10, maxGroupSize: 5 })).toContain(
      "20人必要",
    );
  });
});
