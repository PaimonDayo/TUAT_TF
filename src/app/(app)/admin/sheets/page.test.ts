import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), settings: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getCurrentProfile: mocks.profile }));
vi.mock("@/lib/queries", () => ({ getMemberSheetSettings: mocks.settings }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import AdminSheetSettingsPage from "./page";

describe("admin sheet settings page access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.redirect.mockImplementation(() => { throw new Error("redirected"); });
    mocks.settings.mockResolvedValue([]);
  });

  it.each([
    { roles: [] },
    { roles: [{ can_manage_members: true }] },
    { roles: [{ can_manage_system: true, permissions_suppressed: true }] },
  ])("denies direct navigation without system permissions before loading settings", async ({ roles }) => {
    mocks.profile.mockResolvedValue({ roles });
    await expect(AdminSheetSettingsPage()).rejects.toThrow("redirected");
    expect(mocks.redirect).toHaveBeenCalledWith("/home");
    expect(mocks.settings).not.toHaveBeenCalled();
  });

  it("loads the overview for a system role even without member-management permissions", async () => {
    mocks.profile.mockResolvedValue({ roles: [{ can_manage_members: false, can_manage_system: true }] });
    await AdminSheetSettingsPage();
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
