import { describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/image-storage", () => ({ getR2Inventory: vi.fn() }));
import { parseHealth, parseVercelUsage } from "./service-status";

describe("service status summaries", () => {
  it("does not treat malformed status as healthy", () => {
    for (const value of [null, {}, { status: {} }, { status: { indicator: "new-value" } }]) expect(() => parseHealth(value)).toThrow();
    expect(parseHealth({ status: { indicator: "major" }, incidents: [{ name: "Database outage" }] })).toEqual({ indicator: "major", incidents: ["Database outage"] });
  });
  it("aggregates usage across projects without mixing units or credits", () => {
    const usage = (quantity: string, unit = "requests") => ({ ChargeCategory: "Usage", ServiceName: "Functions", ConsumedQuantity: quantity, ConsumedUnit: unit });
    const rows = [usage("12"), usage("8"), usage("0.5", "hours"), { ...usage("100"), ChargeCategory: "Credit" }, { ...usage("0"), ConsumedQuantity: null, ConsumedUnit: null }];
    expect(parseVercelUsage(rows.map((row) => JSON.stringify(row)).join("\n"))).toEqual([
      { name: "Functions", unit: "requests", quantity: 20 }, { name: "Functions", unit: "hours", quantity: 0.5 },
    ]);
  });
  it("rejects incomplete usage rather than inventing zero", () => {
    expect(() => parseVercelUsage("not JSON")).toThrow();
    for (const quantity of ["", "NaN", -3, undefined]) expect(() => parseVercelUsage(JSON.stringify({ ChargeCategory: "Usage", ServiceName: "CPU", ConsumedUnit: "hours", ConsumedQuantity: quantity }))).toThrow();
  });
});
