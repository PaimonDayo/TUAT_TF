import { describe, expect, it } from "vitest";
import {
  importedSheetReplies,
  matchAppReplyIndexes,
  normalizeSheetReplyText,
} from "@/lib/sheet-replies";

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
  it("matches app replies to spreadsheet columns from left to right", () => {
    expect(matchAppReplyIndexes([
      { replyIndex: 4, content: "先です　山田", source: "sheet" },
      { replyIndex: 5, content: "スプシ返信", source: "sheet" },
      { replyIndex: 6, content: "後です　山田", source: "sheet" },
    ], [
      { id: "later", content: "後です", authorName: "山田", createdAt: "2026-07-23T02:00:00Z", sheetReplyIndex: null },
      { id: "earlier", content: "先です", authorName: "山田", createdAt: "2026-07-23T01:00:00Z", sheetReplyIndex: null },
    ])).toEqual([
      { commentId: "earlier", replyIndex: 4 },
      { commentId: "later", replyIndex: 6 },
    ]);
  });

  it("does not update a comment whose spreadsheet column is already current", () => {
    expect(matchAppReplyIndexes([
      { replyIndex: 7, content: "了解 山田", source: "sheet" },
    ], [
      { id: "same", content: "了解", authorName: "山田", createdAt: "2026-07-23T01:00:00Z", sheetReplyIndex: 7 },
    ])).toEqual([]);
  });
});
