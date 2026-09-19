import { describe, expect, it } from "vitest";
import { folderContentsLabel } from "./note-contents";

const ids = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(index) }));

describe("folderContentsLabel", () => {
  it("記事だけのフォルダは記事の数だけを出す", () => {
    expect(folderContentsLabel({ articles: ids(3) })).toBe("記事3件");
  });

  it("サブフォルダとスレッドも数に入れる", () => {
    expect(folderContentsLabel({ children: ids(2), articles: ids(3), threads: ids(1) })).toBe(
      "フォルダ2件 · 記事3件 · スレッド1件",
    );
  });

  it("記事が0件でもスレッドがあれば空扱いにしない", () => {
    expect(folderContentsLabel({ articles: [], threads: ids(2) })).toBe("スレッド2件");
  });

  it("本当に空のときだけ空だと伝える", () => {
    expect(folderContentsLabel({ children: [], articles: [], threads: [] })).toBe("まだ中身はありません");
  });

  it("取得していない種類は0件として扱う", () => {
    expect(folderContentsLabel({})).toBe("まだ中身はありません");
  });
});
