import { describe, expect, it } from "vitest";
import { hasPermission, permissionsOf } from "./permissions";
import type { AppRole } from "@/types";

function role(overrides: Partial<AppRole> = {}): AppRole {
  return {
    id: "role",
    name: "Role",
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
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("permissions", () => {
  it("denies every permission without roles", () => {
    expect(permissionsOf(undefined)).toEqual({
      manageSystem: false, manageMembers: false, createSchedule: false,
      createMenu: false, createNotice: false,
    });
  });
  it("combines permissions from multiple roles", () => {
    const value = permissionsOf([
      role({ can_create_schedule: true }),
      role({ id: "two", can_create_notice: true }),
    ]);
    expect(value.createSchedule).toBe(true);
    expect(value.createNotice).toBe(true);
    expect(value.manageMembers).toBe(false);
  });
  it("recognizes system management", () => {
    expect(hasPermission([role({ can_manage_system: true })], "manage_system")).toBe(true);
  });
  it("does not infer member management from system management", () => {
    expect(hasPermission([role({ can_manage_system: true })], "manage_members")).toBe(false);
  });
  it("recognizes menu creation independently", () => {
    expect(hasPermission([role({ can_create_menu: true })], "create_menu")).toBe(true);
  });
});
