import { describe, expect, it } from "vitest";
import { noticeConditionRecipientIds, noticeRecipientIds } from "@/lib/notice-recipients";
import type { AuthorMini, Block } from "@/types";

function person(id: string, blocks: Block[]): AuthorMini {
  return { id, display_name: id, avatar_url: null, blocks, grade: "B1" } as AuthorMini;
}

const people = [
  person("middle", ["middle_long"]),
  person("sprint", ["short"]),
  person("manager", ["manager"]),
];

function idsForBlocks(blocks: Block[]): string[] {
  return noticeConditionRecipientIds({
    people,
    roleAssignments: [],
    all: false,
    roleIds: [],
    blocks,
    grades: [],
  });
}

describe("notice block recipients", () => {
  it("マネージャーをブロック指定で選べる", () => {
    expect(idsForBlocks(["manager"])).toEqual(["manager"]);
  });

  // DB のトリガーは profiles.blocks との配列重なりで通知先を決めるので、
  // 画面の集計も中長距離・短距離の指定にマネージャーを混ぜてはいけない。
  it("中長距離・短距離の指定にマネージャーを含めない", () => {
    expect(idsForBlocks(["middle_long"])).toEqual(["middle"]);
    expect(idsForBlocks(["short"])).toEqual(["sprint"]);
  });

  it("複数ブロックを組み合わせられる", () => {
    expect(idsForBlocks(["middle_long", "manager"])).toEqual(["middle", "manager"]);
  });

  it("ブロック未選択なら誰も対象にしない", () => {
    expect(idsForBlocks([])).toEqual([]);
  });

  it("過去互換の jump/throw は短距離として扱う", () => {
    expect(
      noticeConditionRecipientIds({
        people: [person("jumper", ["jump"])],
        roleAssignments: [],
        all: false,
        roleIds: [],
        blocks: ["short"],
        grades: [],
      }),
    ).toEqual(["jumper"]);
  });
});

describe("notice recipients", () => {
  it("removes an individually excluded member from a bulk selection", () => {
    expect(noticeRecipientIds(["a", "b", "c"], [], ["b"])).toEqual(["a", "c"]);
  });

  it("keeps individually added members while deduplicating conditions", () => {
    expect(noticeRecipientIds(["a", "b"], ["b", "c"], [])).toEqual(["a", "b", "c"]);
  });
});
