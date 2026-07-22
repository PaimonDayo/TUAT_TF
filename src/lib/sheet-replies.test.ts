import { describe, expect, it } from "vitest";
import { importedSheetReplies, normalizeSheetReplyText } from "@/lib/sheet-replies";

describe("sheet replies", () => {
  it("imports only replies entered from the sheet", () => {
    expect(importedSheetReplies([
      { replyIndex: 3, content: "フォームを意識", source: "sheet" },
      { replyIndex: 4, content: "了解　山田", source: "app" },
    ], [])).toEqual([{ replyIndex: 3, content: "フォームを意識" }]);
  });

  it("does not duplicate legacy app replies without a marker", () => {
    expect(importedSheetReplies([
      { replyIndex: 5, content: "了解　 山田", source: "sheet" },
    ], ["了解 山田"])).toEqual([]);
  });

  it("deduplicates a repeated column index and ignores invalid values", () => {
    expect(importedSheetReplies([
      { replyIndex: -1, content: "invalid", source: "sheet" },
      { replyIndex: 7, content: "old", source: "sheet" },
      { replyIndex: 7, content: "new", source: "sheet" },
      { replyIndex: 8, content: "   ", source: "sheet" },
    ], [])).toEqual([{ replyIndex: 7, content: "new" }]);
  });

  it("normalizes regular and Japanese spaces for comparison", () => {
    expect(normalizeSheetReplyText("  了解　　山田 ")).toBe("了解 山田");
  });
});
