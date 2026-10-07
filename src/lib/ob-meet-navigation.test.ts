import { expect, it } from "vitest";
import { obWorkspaceDestination } from "./ob-meet-navigation";

it.each([true, false])("opens shared program and duties with canOperate=%s without converting them into editing destinations", canOperate => {
  for (const staff of [false, true]) {
    const view = canOperate ? "operations" : "participant";
    expect(obWorkspaceDestination({ section: "program" }, canOperate, staff)).toEqual({ view, section: "program" });
    expect(obWorkspaceDestination({ view: "operations", section: "program" }, canOperate, staff)).toEqual({ view, section: "program" });
    expect(obWorkspaceDestination({ section: "duties" }, canOperate, staff)).toEqual({ view, section: "duties" });
    expect(obWorkspaceDestination({ view: "duties" }, canOperate, staff)).toEqual({ view, section: "duties" });
  }
});

it.each([true, false])("preserves explicit own-registration and existing home links with canOperate=%s", canOperate => {
  for (const staff of [false, true]) {
    const expected = { view: canOperate ? "operations" : "participant", section: "mine" };
    for (const requested of [{ section: "mine" }, { view: "participant" }, { view: "program" }, { view: "mine" }, { edit: "mine", section: "program" }, { edit: "mine", view: "operations", section: "participants" }]) {
      expect(obWorkspaceDestination(requested, canOperate, staff)).toEqual(expected);
    }
  }
});

it("keeps the existing recording default for operators and the shared program default for readers", () => {
  for (const staff of [false, true]) {
    expect(obWorkspaceDestination({}, true, staff)).toEqual({ view: "operations", section: "events" });
    expect(obWorkspaceDestination({}, false, staff)).toEqual({ view: "participant", section: "program" });
    for (const requested of [{ view: "operations", section: "events" }, { view: "heats" }, { view: "day" }, { section: "unknown" }]) {
      expect(obWorkspaceDestination(requested, false, staff)).toEqual({ view: "participant", section: "program" });
    }
  }
});

it("permits participant management only when both operational access and the OB staff role are present", () => {
  for (const requested of [{ section: "participants" }, { view: "management" }, { edit: "identity" }]) {
    expect(obWorkspaceDestination(requested, true, true)).toEqual({ view: "operations", section: "participants" });
    expect(obWorkspaceDestination(requested, true, false)).toEqual({ view: "operations", section: "events" });
    expect(obWorkspaceDestination(requested, false, false)).toEqual({ view: "participant", section: "program" });
    expect(obWorkspaceDestination(requested, false, true)).toEqual({ view: "participant", section: "program" });
  }
});

it("resolves legacy task shortcuts before the new shared section", () => {
  expect(obWorkspaceDestination({ edit: "mine", section: "program" }, true, true)).toEqual({ view: "operations", section: "mine" });
  expect(obWorkspaceDestination({ edit: "identity", section: "program" }, true, true)).toEqual({ view: "operations", section: "participants" });
  expect(obWorkspaceDestination({ view: "duties", section: "program" }, true, false)).toEqual({ view: "operations", section: "duties" });
});
