import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effect: null as (() => unknown) | null }));
type Menu = { onDelete: () => Promise<boolean>; onEdit?: () => void };
const state = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), fetch: vi.fn(), count: vi.fn(), menus: [] as Menu[], send: null as (() => Promise<void>) | null, input: null as ((event: { target: { value: string } }) => void) | null }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: T | ((before: T) => T)) => { hooks.values[index] = typeof next === "function" ? (next as (before: T) => T)(hooks.values[index] as T) : next; }];
  },
  useRef: () => ({ current: null }), useEffect: (effect: () => unknown) => { hooks.effect = effect; },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: state.from, rpc: state.rpc }) }));
vi.mock("@/components/layout/glass/system-glass-state", () => ({ useSystemGlass: () => false }));
vi.mock("@/components/common/Avatar", () => ({ Avatar: () => null }));
vi.mock("@/components/cards/CommentLikeButton", () => ({ CommentLikeButton: () => null }));
vi.mock("@/components/common/Linkify", () => ({ Linkify: ({ text }: { text: string }) => text }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: ({ onChange }: { onChange: typeof state.input }) => { state.input = onChange; return null; } }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, onClick }: { children: ReactNode; onClick: typeof state.send }) => { state.send = onClick; return createElement("button", {}, children); } }));
vi.mock("@/components/ui/action-menu", () => ({ ActionMenu: (props: Menu) => { state.menus.push(props); return null; } }));
import { CommentSection } from "./CommentSection";

const me = { id: "owner", display_name: "合成本人", avatar_url: null };
const other = { ...me, id: "other", display_name: "合成別部員" };
const row = { id: "comment", user_id: me.id, target_type: "record", target_id: "record", content: "アプリのコメント", created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z", author: me, sheet_reply_index: 8 };
const selectors: string[] = [];
let inserted: unknown;
function render(moderator = false) {
  hooks.cursor = 0; state.menus = [];
  return renderToStaticMarkup(createElement(CommentSection, { targetType: "record", targetId: "record", currentUser: { ...me, canModerateComments: moderator }, onCountChange: state.count }));
}
beforeEach(() => {
  hooks.values = []; hooks.effect = null; selectors.length = 0; inserted = null;
  state.count.mockReset(); state.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  state.fetch.mockReset().mockResolvedValue(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", state.fetch); vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
  state.from.mockReset().mockImplementation((table: string) => {
    if (table !== "comments") throw new Error("Only app comments may be read or written");
    const query = {
      select: (columns: string) => { selectors.push(columns); return query; }, eq: () => query,
      order: async () => ({ data: [row, { ...row, id: "other-comment", user_id: other.id, author: other, sheet_reply_index: 0 }], error: null }),
      insert: (value: unknown) => { inserted = value; return query; }, single: async () => ({ data: { ...row, id: "new-comment" }, error: null }),
    };
    return query;
  });
});
async function load() { render(); hooks.effect!(); await vi.waitFor(() => expect(state.count).toHaveBeenCalledWith(2)); }
afterEach(() => vi.unstubAllGlobals());
it("shows and counts app comments without loading sheet history or using old column order", async () => {
  await load();
  const html = render();
  expect(html.indexOf("合成本人")).toBeLessThan(html.indexOf("合成別部員"));
  expect(html).not.toContain("スプレッドシート");
  expect(state.from).toHaveBeenCalledExactlyOnceWith("comments");
  expect(state.menus).toHaveLength(1); // Only the author's own app comment.
  expect(state.fetch).not.toHaveBeenCalled();
});
it("creates a record comment only in the app", async () => {
  await load(); render(); state.input!({ target: { value: "新しい返信" } }); render();
  await state.send!();
  expect(inserted).toEqual({ user_id: me.id, target_type: "record", target_id: "record", content: "新しい返信" });
  expect(selectors.at(-1)).not.toContain("sheet_reply_index");
  expect(state.count).toHaveBeenLastCalledWith(3);
  expect(state.fetch).not.toHaveBeenCalled();
});
it("keeps own/moderator menus and deletes only an app comment", async () => {
  await load(); render(true);
  expect(state.menus).toHaveLength(2);
  expect(state.menus[0].onEdit).toBeDefined(); expect(state.menus[1].onEdit).toBeUndefined();
  expect(await state.menus[1].onDelete()).toBe(true);
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith("/api/comments/delete", expect.objectContaining({ body: JSON.stringify({ id: "other-comment", kind: "app" }) }));
  expect(state.count).toHaveBeenLastCalledWith(1);
});
it("asks for a reload after an unknown deletion without resending it", async () => {
  await load(); render(); state.fetch.mockRejectedValueOnce(new Error("synthetic network loss"));
  expect(await state.menus[0].onDelete()).toBe(false);
  expect(state.fetch).toHaveBeenCalledOnce();
  const html = render();
  expect(html).toContain("画面を再読み込みして確認");
  expect(html).not.toContain("再試行");
  expect(state.count).toHaveBeenLastCalledWith(2);
});
