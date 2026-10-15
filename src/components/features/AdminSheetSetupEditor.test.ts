import { describe, expect, it } from "vitest";
import type { RecordFieldDef } from "@/types";
import { matchesAdminSheetSetup, type AdminSheetSetup } from "./AdminSheetSetupEditor";

type SaveIntent = Parameters<typeof matchesAdminSheetSetup>[1];

function intent(overrides: Partial<SaveIntent> = {}): SaveIntent {
  return {
    revision: "before-save",
    mode: "sheet",
    sheetName: "連携先シート",
    signature: "saved-header-signature",
    fields: [
      {
        key: "menu_text", label: "練習内容", type: "text", hidden: false,
        sourceHeader: "メニュー", sourceColumn: 2, showInTimeline: true,
      },
      {
        key: "distance", label: "距離", type: "number", hidden: false,
        sourceHeader: "走行距離", sourceColumn: 3, showInTimeline: false,
      },
    ],
    isMiddleLong: false,
    ...overrides,
  };
}

function readback(saved: SaveIntent, overrides: Partial<AdminSheetSetup> = {}): AdminSheetSetup {
  return { ...structuredClone(saved), revision: "after-save", ...overrides };
}

describe("matchesAdminSheetSetup save-result verification", () => {
  it.each(["sheet", "app_only", "off"] as const)(
    "confirms %s only when the revision changed and the complete saved configuration matches",
    mode => {
      const saved = intent({ mode });
      expect(matchesAdminSheetSetup(readback(saved), saved)).toBe(true);
      expect(matchesAdminSheetSetup(readback(saved, { revision: saved.revision }), saved)).toBe(false);
    },
  );

  it("does not treat an already-off configuration at the pre-save revision as a completed save", () => {
    const saved = intent({ mode: "off", sheetName: null, signature: null, fields: [] });

    expect(matchesAdminSheetSetup(structuredClone(saved), saved)).toBe(false);
    expect(matchesAdminSheetSetup(readback(saved), saved)).toBe(true);
  });

  it.each([
    ["sheet", "app_only"],
    ["app_only", "sheet"],
  ] as const)("does not confuse intended %s with saved %s", (requestedMode, actualMode) => {
    const saved = intent({ mode: requestedMode });
    expect(matchesAdminSheetSetup(readback(saved, { mode: actualMode }), saved)).toBe(false);
  });

  it.each(["sheet", "app_only", "off"] as const)(
    "does not accept a different sheet name or header signature for %s even after a revision change",
    mode => {
      const saved = intent({ mode });

      expect(matchesAdminSheetSetup(readback(saved, { sheetName: "別のシート" }), saved)).toBe(false);
      expect(matchesAdminSheetSetup(readback(saved, { signature: "different-header-signature" }), saved)).toBe(false);
    },
  );

  it("rejects an unconfigured readback rather than treating nulls as the requested values", () => {
    const saved = intent();

    expect(matchesAdminSheetSetup(readback(saved, { mode: null }), saved)).toBe(false);
    expect(matchesAdminSheetSetup(readback(saved, { sheetName: null }), saved)).toBe(false);
    expect(matchesAdminSheetSetup(readback(saved, { signature: null }), saved)).toBe(false);
  });

  const fieldChanges: [string, Partial<RecordFieldDef>][] = [
    ["stable field key", { key: "different_menu" }],
    ["display label", { label: "別の表示名" }],
    ["input type", { type: "number" }],
    ["hidden state", { hidden: true }],
    ["timeline visibility", { showInTimeline: false }],
    ["source header", { sourceHeader: "別の見出し" }],
    ["source column", { sourceColumn: 4 }],
  ];
  it.each(fieldChanges)("rejects a changed %s despite a new revision", (_name, change) => {
    const saved = intent();
    const fields = saved.fields.map((field, index) => index === 0 ? { ...field, ...change } : { ...field });

    expect(matchesAdminSheetSetup(readback(saved, { fields }), saved)).toBe(false);
  });

  it("requires every configured field and its saved order to match", () => {
    const saved = intent();

    expect(matchesAdminSheetSetup(readback(saved, { fields: saved.fields.slice(0, 1) }), saved)).toBe(false);
    expect(matchesAdminSheetSetup(readback(saved, { fields: [...saved.fields].reverse() }), saved)).toBe(false);
    expect(matchesAdminSheetSetup(readback(saved, {
      fields: [...saved.fields, { key: "memo", label: "メモ", type: "text" }],
    }), saved)).toBe(false);
  });
});
