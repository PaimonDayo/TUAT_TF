import { describe, expect, it } from "vitest";
import { matchEntryMember, normalizeEntryName } from "./ob-entries";

describe("OB entry identity candidates", () => {
  const entry = { submitted_name: "試験　太郎", grade: "B2" };
  const member = { id: "a", display_name: "試験 太郎", grade: "2" };
  it("normalizes spaces and fullwidth characters", () => {
    expect(normalizeEntryName("Ａ　Ｂ C")).toBe("ABC");
    expect(matchEntryMember(entry, [member]).status).toBe("exact");
  });
  it("does not equate partial names or guess a different kanji", () => {
    expect(matchEntryMember(entry, [{ ...member, display_name: "試験" }]).status).toBe("none");
    expect(matchEntryMember({ ...entry, submitted_name: "高橋太郎" }, [{ ...member, display_name: "髙橋太郎" }]).status).toBe("none");
  });
  it("flags duplicate names and grade mismatches for confirmation", () => {
    expect(matchEntryMember(entry, [member, { ...member, id: "b", grade: "1" }]).status).toBe("ambiguous");
    expect(matchEntryMember(entry, [{ ...member, grade: "3" }]).status).toBe("grade_check");
  });
  it("does not match unnamed entries", () => {
    expect(matchEntryMember({ ...entry, submitted_name: " " }, [{ ...member, display_name: "" }]).status).toBe("none");
  });
});
