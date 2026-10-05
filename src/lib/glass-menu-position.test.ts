import { describe, expect, it } from "vitest";
import { glassMenuPosition } from "./glass-menu-position";

describe("anchored glass menu placement", () => {
  const viewport = { left: 0, top: 0, width: 390, height: 844 };
  it("opens below a toolbar action and above a floating create button", () => {
    expect(glassMenuPosition({ left: 334, right: 378, top: 0, bottom: 44 }, viewport, 220).top).toBe(54);
    const fab = glassMenuPosition({ left: 310, right: 366, top: 674, bottom: 730 }, viewport, 220);
    expect(fab.top).toBe(444);
    expect(fab.origin).toContain("100%");
  });
  it("keeps left-edge controls inside a small viewport", () => {
    const p = glassMenuPosition({ left: 4, right: 48, top: 30, bottom: 74 }, { ...viewport, width: 240 }, 220);
    expect(p.left).toBe(12);
    expect(p.width).toBe(216);
  });
  it("keeps a one-item create menu above the FAB even when it fits below", () => {
    const anchor = { left: 314, right: 370, top: 688, bottom: 744 };
    const p = glassMenuPosition(anchor, viewport, 64, "above");
    expect(p.top + 64).toBe(anchor.top - 10);
    expect(p.origin).toContain("100%");
    expect(glassMenuPosition(anchor, viewport, 64).top).toBe(anchor.bottom + 10);
  });
  it("keeps every create menu above its opener at phone, tablet and desktop widths", () => {
    for (const width of [320, 390, 820, 1280]) {
      for (const height of [64, 164, 216]) {
        const anchor = { left: width - 76, right: width - 20, top: 688, bottom: 744 };
        const p = glassMenuPosition(anchor, { ...viewport, width }, height, "above");
        expect(p.top + height).toBe(anchor.top - 10);
        expect(p.left).toBeGreaterThanOrEqual(12);
        expect(p.left + p.width).toBeLessThanOrEqual(width - 12);
      }
    }
  });
  it("makes tall create menus scroll in the space above the FAB", () => {
    const anchor = { left: 314, right: 370, top: 204, bottom: 260 };
    const p = glassMenuPosition(anchor, { ...viewport, height: 360 }, 216, "above");
    expect(p.top).toBe(12);
    expect(p.maxHeight).toBe(182);
    expect(p.top + p.maxHeight).toBe(anchor.top - 10);
  });
  it("keeps an upward create menu above its opener in an offset visual viewport", () => {
    const anchor = { left: 314, right: 370, top: 614, bottom: 670 };
    const p = glassMenuPosition(anchor, { ...viewport, top: 20, height: 750 }, 64, "above");
    expect(p.top + 64).toBe(anchor.top - 10);
    expect(p.top).toBeGreaterThanOrEqual(32);
  });
  it("limits tall menus above the software keyboard", () => {
    const p = glassMenuPosition({ left: 340, right: 384, top: 310, bottom: 354 }, { ...viewport, height: 320 }, 500);
    expect(p.top).toBe(12);
    expect(p.maxHeight).toBe(296);
  });
  it("includes visual viewport offsets when zoomed or panned", () => {
    const v = { left: 80, top: 120, width: 220, height: 300 };
    const p = glassMenuPosition({ left: 100, right: 144, top: 140, bottom: 184 }, v, 100);
    expect(p.left).toBeGreaterThanOrEqual(92);
    expect(p.left + p.width).toBeLessThanOrEqual(288);
    expect(p.top).toBeGreaterThanOrEqual(132);
    expect(p.top + 100).toBeLessThanOrEqual(408);
  });
});
