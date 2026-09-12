import { describe, expect, it } from "vitest";
import { recordSourceEnabled, showRecordSourceFor } from "./record-source-display";

describe("recordSourceEnabled", () => {
  it("未設定なら出す（端末を変えても黙って消えないように）", () => {
    expect(recordSourceEnabled(undefined)).toBe(true);
  });

  it("切ったときだけ出さない", () => {
    expect(recordSourceEnabled("0")).toBe(false);
    expect(recordSourceEnabled("1")).toBe(true);
  });
});

describe("showRecordSourceFor", () => {
  it("システム管理者以外には、設定に関係なく出さない", () => {
    expect(showRecordSourceFor(false, undefined)).toBe(false);
    expect(showRecordSourceFor(false, "1")).toBe(false);
  });

  it("システム管理者には既定で出し、切ったときだけ止める", () => {
    expect(showRecordSourceFor(true, undefined)).toBe(true);
    expect(showRecordSourceFor(true, "0")).toBe(false);
  });
});
