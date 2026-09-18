import { describe, expect, it } from "vitest";
import {
  importedSheetReplies,
  matchAppReplyIndexes,
  normalizeSheetReplyText,
  sheetRepliesWithoutAppDuplicates,
  sortRepliesInWrittenOrder,
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

  it("does not import an app reply mirror when its column is known", () => {
    expect(importedSheetReplies([
      { replyIndex: 5, content: "表示名変更前の返信", source: "sheet" },
      { replyIndex: 6, content: "シートだけの返信", source: "sheet" },
    ], [], [5])).toEqual([
      { replyIndex: 6, content: "シートだけの返信" },
    ]);
  });

  it("deduplicates display replies by column before normalized text", () => {
    expect(sheetRepliesWithoutAppDuplicates([
      { replyIndex: 4, content: "名前が変わって本文照合できない写し" },
      { replyIndex: 5, content: "了解　 山田" },
      { replyIndex: 6, content: "シート返信" },
    ], ["了解 山田"], [4])).toEqual([
      { replyIndex: 6, content: "シート返信" },
    ]);
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

describe("reply order", () => {
  // id を並びの期待値として読めるようにしている
  const order = (
    replies: { id: string; createdAt?: string | null; sheetReplyIndex?: number | null }[],
  ) =>
    sortRepliesInWrittenOrder(replies, (reply) => ({
      id: reply.id,
      createdAt: reply.createdAt ?? null,
      sheetReplyIndex: reply.sheetReplyIndex ?? null,
    })).map((reply) => reply.id);

  it("keeps a reply in place when its sheet column arrives later", () => {
    // アプリから返信した直後は列がまだ無く、書き込みが終わると列が付く。
    // その前後で並びが変わってはいけない。
    const before = [
      { id: "08:23", createdAt: "2026-09-18T08:23:51Z", sheetReplyIndex: 22 },
      { id: "13:15", createdAt: "2026-09-18T13:15:11Z" },
      { id: "14:02", createdAt: "2026-09-18T14:02:06Z" },
    ];
    const after = [
      { id: "08:23", createdAt: "2026-09-18T08:23:51Z", sheetReplyIndex: 22 },
      { id: "13:15", createdAt: "2026-09-18T13:15:11Z" },
      { id: "14:02", createdAt: "2026-09-18T14:02:06Z", sheetReplyIndex: 24 },
    ];
    expect(order(before)).toEqual(["08:23", "13:15", "14:02"]);
    expect(order(after)).toEqual(["08:23", "13:15", "14:02"]);
  });

  it("does not lift replies that have a column above older ones that do not", () => {
    expect(
      order([
        { id: "newer-with-column", createdAt: "2026-09-18T14:02:06Z", sheetReplyIndex: 24 },
        { id: "older-without-column", createdAt: "2026-09-18T13:15:11Z" },
        { id: "oldest-with-column", createdAt: "2026-09-18T08:23:51Z", sheetReplyIndex: 22 },
      ]),
    ).toEqual(["oldest-with-column", "older-without-column", "newer-with-column"]);
  });

  it("reads sheet-only replies in column order", () => {
    expect(
      order([
        { id: "right", sheetReplyIndex: 5 },
        { id: "left", sheetReplyIndex: 1 },
        { id: "middle", sheetReplyIndex: 3 },
      ]),
    ).toEqual(["left", "middle", "right"]);
  });

  it("places a reply written before every column first", () => {
    expect(
      order([
        { id: "with-column", createdAt: "2026-09-18T10:00:00Z", sheetReplyIndex: 4 },
        { id: "written-earlier", createdAt: "2026-09-18T09:00:00Z" },
      ]),
    ).toEqual(["written-earlier", "with-column"]);
  });

  it("keeps replies without any column in the order they were posted", () => {
    expect(
      order([
        { id: "second", createdAt: "2026-09-18T11:00:00Z" },
        { id: "third", createdAt: "2026-09-18T12:00:00Z" },
        { id: "first", createdAt: "2026-09-18T10:00:00Z" },
      ]),
    ).toEqual(["first", "second", "third"]);
  });
});
