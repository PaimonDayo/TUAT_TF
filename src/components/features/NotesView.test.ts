import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthorMini, NoteWithRelations } from "@/types";
import type { NoteArticleSearchResult } from "@/app/(app)/notes/actions";

const search = vi.hoisted(() => ({ query: "", articles: [] as NoteArticleSearchResult[] }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useState<T>(initial: T | (() => T)) {
    const [value, setValue] = actual.useState(initial);
    return [initial === "" ? search.query : Array.isArray(initial) ? search.articles : value, setValue];
  } };
});
vi.mock("@/app/(app)/notes/actions", () => ({ searchNoteArticles: vi.fn() }));
vi.mock("./FolderRowActions", () => ({ FolderRowActions: () => createElement("button", {}, "編集操作") }));
vi.mock("./ThreadList", () => ({ ThreadList: () => null }));
vi.mock("@/components/common/Avatar", () => ({ Avatar: () => null }));
import { NotesView } from "./NotesView";

const currentUser: AuthorMini = { id: "self", display_name: "合成本人", avatar_url: null, blocks: [], grade: "B1" };
function folder(id: string, overrides: Partial<NoteWithRelations> = {}): NoteWithRelations {
  return {
    id, title: id, author_id: "other", author: { ...currentUser, id: "other" },
    scope: "shared", status: "draft", edit_policy: "specified", parent_id: null,
    body: "", description: null, pinned: false, theme_id: null, theme: null,
    created_at: "", updated_at: "", editors: [], articles: [], children: [], threads: [],
    ...overrides,
  };
}
const notes = [folder("本人の下書き", { author_id: "self", author: currentUser }), folder("他人の下書き"), folder("公開済み", { status: "published" }), folder("個人の下書き", { scope: "personal" }), folder("子の下書き", { parent_id: "他人の下書き" })];
beforeEach(() => { search.query = ""; search.articles = []; });
function render(props: Partial<Parameters<typeof NotesView>[0]> = {}) {
  return renderToStaticMarkup(createElement(NotesView, { currentUser, notes, ...props }));
}

it("本人の下書きは通常一覧から編集へ戻れ、他人の下書きは隠れる", () => {
  const html = render();
  expect(html).toContain("本人の下書き");
  expect(html).toContain("編集操作");
  expect(html).toContain("公開済み");
  expect(html).not.toContain("他人の下書き");
});
it("システム管理者は下書きを閲覧でき、他人の編集権限は増えない", () => {
  const html = render({ canViewAllFolders: true });
  expect(html).toContain("他人の下書き");
  expect(html.match(/編集操作/g)).toHaveLength(1);
  expect(html).not.toContain("子の下書き");
  expect(render({ canViewAllFolders: true, initialScope: "personal" })).toContain("個人の下書き");
});
it("システム管理者でも自分のノートの絞り込みを維持する", () => {
  const html = render({ canViewAllFolders: true, mine: true });
  expect(html).toContain("本人の下書き");
  expect(html).not.toContain("他人の下書き");
});
it("フォルダと記事の検索でも本人とシステム管理者の下書きを表示する", () => {
  search.query = "下書き";
  search.articles = notes.filter(note => note.status === "draft").map(note => ({
    id: `記事-${note.id}`, note_id: note.id, title: `記事-${note.id}`, updated_at: "", note,
  }));
  const member = render();
  expect(member).toContain("記事-本人の下書き");
  expect(member).not.toContain("記事-他人の下書き");
  const manager = render({ canViewAllFolders: true });
  expect(manager).toContain("記事-他人の下書き");
  expect(manager).toContain("子の下書き");
  expect(render({ canViewAllFolders: true, initialScope: "personal" })).toContain("記事-個人の下書き");
});
