import { describe, expect, it } from "vitest";
import { entryEventRows, matchEntryMember, normalizeEntryName } from "./ob-entries";

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

it("pairs marks with selected events without inventing marks for blank or missing fields", () => {
  expect(entryEventRows({ events: ["男子100m", "男子1500m", "男子走り幅跳び"], qualification_marks: {
    "男子100m": "12秒34（手動）\n参考記録", "男子1500m": null, "男子3000m": "未選択の記録",
  } })).toEqual([
    { event: "男子1500m", mark: "未回答" },
    { event: "男子100m", mark: "12秒34（手動）\n参考記録" },
    { event: "男子走り幅跳び", mark: "記録欄なし" },
  ]);
});
