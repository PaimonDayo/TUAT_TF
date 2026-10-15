import { describe, expect, it } from "vitest";
import { SHEET_INPUT_MODE_LABELS, SHEET_LINK_STATUS_LABELS, sheetLinkStatus } from "./sheet-input-mode";

const configured = {
  version: "2026-10", mode: "sheet", confirmed_at: "2026-10-15T00:00:00Z", sheet_name: "現在のシート",
};

describe("sheet link status", () => {
  it.each(["sheet", "app_only"])("counts %s as linked because both modes exchange records with the sheet", (mode) => {
    expect(sheetLinkStatus({ ...configured, mode })).toBe("linked");
  });

  it("labels an explicitly disconnected mode without requiring a sheet", () => {
    expect(sheetLinkStatus({ ...configured, mode: "off", sheet_name: null })).toBe("off");
    expect(SHEET_LINK_STATUS_LABELS.off).toBe("連携なし");
  });

  it.each([
    {},
    { ...configured, version: "unknown" },
    { ...configured, mode: "unknown" },
    { ...configured, sheet_name: null },
    { ...configured, sheet_name: " " },
    { ...configured, mode: "app_only", sheet_name: null },
  ])("keeps a missing current configuration or sheet unconfigured: %j", (settings) => {
    expect(sheetLinkStatus(settings)).toBe("unset");
  });

  it.each(["2026-09-30T00:41:02Z", "", "invalid", null])("requires confirmation for %s", (confirmed_at) => {
    expect(sheetLinkStatus({ ...configured, confirmed_at })).toBe("needs_confirmation");
  });

  it("also flags an old disconnected configuration for confirmation", () => {
    expect(sheetLinkStatus({ ...configured, mode: "off", confirmed_at: "2026-09-29T00:00:00Z" })).toBe("needs_confirmation");
  });

  it("uses the shared confirmation cutoff and retains the existing input-mode wording", () => {
    expect(sheetLinkStatus({ ...configured, confirmed_at: "2026-09-30T00:45:32.000Z" })).toBe("linked");
    expect(SHEET_LINK_STATUS_LABELS).toEqual({
      linked: "連携中", off: "連携なし", unset: "未設定", needs_confirmation: "要確認", ended: "連携終了",
    });
    expect(SHEET_INPUT_MODE_LABELS).toEqual({
      sheet: "スプレッドシートとアプリの両方から入力",
      app_only: "アプリからのみ入力",
      off: "スプレッドシートと連携しない",
    });
  });
});
