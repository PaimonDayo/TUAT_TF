import { describe, expect, it } from "vitest";
import { noticeRecipientIds } from "@/lib/notice-recipients";

describe("notice recipients", () => {
  it("removes an individually excluded member from a bulk selection", () => {
    expect(noticeRecipientIds(["a", "b", "c"], [], ["b"])).toEqual(["a", "c"]);
  });

  it("keeps individually added members while deduplicating conditions", () => {
    expect(noticeRecipientIds(["a", "b"], ["b", "c"], [])).toEqual(["a", "b", "c"]);
  });
});
