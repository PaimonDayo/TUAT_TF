import { describe, expect, it } from "vitest";
import {
  insertPhotoAt,
  parseNoteBody,
  photoKeyFromPath,
  photoToken,
  referencedPhotoKeys,
  removePhotoBlock,
  serializeNoteBlocks,
  truncateNoteBody,
} from "./note-body";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("photoKeyFromPath", () => {
  it("保存先パスの真ん中がキー", () => {
    expect(photoKeyFromPath(`33333333-3333-4333-8333-333333333333/${A}.webp`)).toBe(A);
  });

  it("形が違うパスは無視する", () => {
    expect(photoKeyFromPath("only-one-part.webp")).toBeNull();
    expect(photoKeyFromPath("article/not-a-uuid.webp")).toBeNull();
  });
});

describe("parseNoteBody", () => {
  it("写真の無い本文は文章1つ", () => {
    expect(parseNoteBody("今日の練習")).toEqual([{ type: "text", text: "今日の練習" }]);
  });

  it("文中の写真を前後の文章で挟む", () => {
    expect(parseNoteBody(`前${photoToken(A)}後`)).toEqual([
      { type: "text", text: "前" },
      { type: "photo", key: A },
      { type: "text", text: "後" },
    ]);
  });

  it("目印の前後に置いた改行1つは本文に残さない", () => {
    expect(parseNoteBody(`前\n${photoToken(A)}\n後`)).toEqual([
      { type: "text", text: "前" },
      { type: "photo", key: A },
      { type: "text", text: "後" },
    ]);
  });

  it("本文中の空行は保つ", () => {
    expect(parseNoteBody(`前\n\n${photoToken(A)}\n\n後`)).toEqual([
      { type: "text", text: "前\n" },
      { type: "photo", key: A },
      { type: "text", text: "\n後" },
    ]);
  });

  it("写真が続いても間に文章を入れて書けるようにする", () => {
    expect(parseNoteBody(`${photoToken(A)}${photoToken(B)}`)).toEqual([
      { type: "text", text: "" },
      { type: "photo", key: A },
      { type: "text", text: "" },
      { type: "photo", key: B },
      { type: "text", text: "" },
    ]);
  });
});

describe("serializeNoteBlocks", () => {
  it("分解して組み直すと元へ戻る", () => {
    const body = `前\n${photoToken(A)}\n後`;
    expect(serializeNoteBlocks(parseNoteBody(body))).toBe(body);
  });

  it("空の文章だけなら空文字", () => {
    expect(serializeNoteBlocks([{ type: "text", text: "  " }])).toBe("");
  });
});

describe("insertPhotoAt", () => {
  it("caret の位置で文章を割って差し込む", () => {
    const blocks = parseNoteBody("あいうえお");
    expect(insertPhotoAt(blocks, 0, 2, A)).toEqual([
      { type: "text", text: "あい" },
      { type: "photo", key: A },
      { type: "text", text: "うえお" },
    ]);
  });

  it("末尾に入れても後ろに書ける空の文章が残る", () => {
    const blocks = parseNoteBody("あい");
    expect(insertPhotoAt(blocks, 0, 2, A)).toEqual([
      { type: "text", text: "あい" },
      { type: "photo", key: A },
      { type: "text", text: "" },
    ]);
  });

  it("文章ではないところを指されたら末尾へ足す", () => {
    const blocks = parseNoteBody(`あ${photoToken(A)}`);
    expect(insertPhotoAt(blocks, 1, 0, B)).toEqual([
      { type: "text", text: "あ" },
      { type: "photo", key: A },
      { type: "text", text: "" },
      { type: "photo", key: B },
      { type: "text", text: "" },
    ]);
  });
});

describe("removePhotoBlock", () => {
  it("外すと前後の文章がつながる", () => {
    const blocks = parseNoteBody(`前\n${photoToken(A)}\n後`);
    expect(removePhotoBlock(blocks, A)).toEqual([{ type: "text", text: "前\n後" }]);
  });
});

describe("truncateNoteBody", () => {
  it("短ければそのまま", () => {
    expect(truncateNoteBody("あいう", 10)).toBe("あいう");
  });

  it("途中で切れる写真の目印は落とす", () => {
    const body = `あいうえお${photoToken(A)}かきくけこ`;
    // 目印の途中（先頭から10文字目）で切っても、生の文字列は残らない。
    expect(truncateNoteBody(body, 10)).toBe("あいうえお");
  });

  it("目印の外で切るときは普通に切る", () => {
    expect(truncateNoteBody("あいうえおかきくけこ", 3)).toBe("あいう");
  });
});

describe("referencedPhotoKeys", () => {
  it("本文が指している写真を出てくる順に返す", () => {
    expect(referencedPhotoKeys(`${photoToken(B)}あ${photoToken(A)}${photoToken(B)}`)).toEqual([
      B,
      A,
    ]);
  });

  it("写真を置いていない本文では空", () => {
    expect(referencedPhotoKeys("ふつうの本文")).toEqual([]);
  });
});
