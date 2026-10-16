import { describe, expect, it } from "vitest";
import { createImageUploadAdmission } from "./image-upload-admission";

describe("PC image upload admission", () => {
  it("bounds work across users and endpoints and releases capacity on failures", () => {
    const admit = createImageUploadAdmission();
    const first = admit("one");
    expect(() => admit("one")).toThrow(/混み合/);
    const second = admit("two");
    expect(() => admit("three")).toThrow(/混み合/);
    first(); first();
    const third = admit("three");
    second(); third();
    admit("one")();
  });
  it("excludes simultaneous collaborator uploads to one note article", () => {
    const admit = createImageUploadAdmission();
    const first = admit("one","note:article");
    expect(() => admit("two","note:article")).toThrow(/混み合/);
    first(); admit("two","note:article")();
  });
  it("bounds a user's accepted uploads per minute without blocking a six-image article", () => {
    const admit = createImageUploadAdmission();
    for(let i=0;i<20;i++) admit("one",undefined,1000)();
    expect(() => admit("one",undefined,60_999)).toThrow(/混み合/);
    admit("two",undefined,60_999)();
    admit("one",undefined,61_000)();
  });
});
