import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), viewer: vi.fn(), records: vi.fn(), tweets: vi.fn(), pbs: vi.fn(),
  notes: vi.fn(), favorite: vi.fn(), events: vi.fn(), competitions: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/auth", () => ({ getCurrentProfile: mocks.viewer }));
vi.mock("@/lib/queries", () => ({
  getProfileById: mocks.profile, getUserRecordsWithSocialState: mocks.records,
  getUserTweets: mocks.tweets, getPbRecords: mocks.pbs, getPublishedPersonalNotes: mocks.notes,
  isFavorite: mocks.favorite, getCompetitionEvents: mocks.events, getCompetitions: mocks.competitions,
  sortFeedItems: (items: unknown[]) => items,
}));
vi.mock("@/components/features/FavoriteButton", () => ({ FavoriteButton: () => null }));
import MemberPage from "./page";

const target = {
  id: "other", display_name: "検証部員", avatar_url: null, blocks: ["middle_long"],
  grade: "B2", roles: [], events: [], goal: "自分の目標",
};
const viewer = { ...target, id: "viewer", display_name: "閲覧者", sheet_name: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue(target);
  mocks.viewer.mockResolvedValue(viewer);
  mocks.records.mockResolvedValue([]);
  mocks.tweets.mockResolvedValue([]);
  mocks.pbs.mockResolvedValue([]);
  mocks.notes.mockResolvedValue([]);
  mocks.favorite.mockResolvedValue(false);
  mocks.events.mockResolvedValue([]);
  mocks.competitions.mockResolvedValue([]);
});

function openMember() {
  const content = MemberPage({ params: Promise.resolve({ id: target.id }) }).props.children;
  return content.type(content.props);
}

it("shows a member profile before slow history and results finish loading", async () => {
  let releaseHistory!: (records: unknown[]) => void;
  mocks.records.mockReturnValue(new Promise((resolve) => { releaseHistory = resolve; }));
  let profileVisible = false;
  const opened = openMember().then((value: Awaited<ReturnType<typeof openMember>>) => { profileVisible = true; return value; });
  await vi.waitFor(() => expect(profileVisible).toBe(true), { timeout: 100 });
  const shell = await opened;
  const body = shell.props.children[1];
  const html = renderToStaticMarkup(body.props.children[0]);
  expect(html).toContain(target.display_name);
  expect(html).toContain(target.goal);
  expect(html).toContain("B2");
  const details = body.props.children[1].props.children;
  const pending = details.type(details.props);
  await vi.waitFor(() => expect(mocks.records).toHaveBeenCalledWith(target.id, viewer.id));
  releaseHistory([]);
  const loaded = await pending;
  expect(renderToStaticMarkup(loaded.props.children.at(-1))).toContain("まだ投稿はありません");
});

it("starts the viewer profile while the target profile is still pending", async () => {
  let releaseProfile!: (value: typeof target) => void;
  mocks.profile.mockReturnValue(new Promise((resolve) => { releaseProfile = resolve; }));
  const opened = openMember();
  await vi.waitFor(() => expect(mocks.viewer).toHaveBeenCalledTimes(1), { timeout: 100 });
  releaseProfile(target);
  await expect(opened).resolves.toBeDefined();
});

it("keeps the same record, result, and note data after the profile appears", async () => {
  const records = [{ id: "record", recorded_date: "2026-10-04" }];
  const pbs = [{ id: "result", event_name: "100m" }];
  const notes = [{ id: "note", title: "公開ノート" }];
  mocks.records.mockResolvedValue(records);
  mocks.pbs.mockResolvedValue(pbs);
  mocks.notes.mockResolvedValue(notes);
  const shell = await openMember();
  const details = shell.props.children[1].props.children[1].props.children;
  const loaded = await details.type(details.props);
  expect(loaded.props.children[0].props.records).toEqual(records);
  expect(loaded.props.children[1].props.children[1].props.notes).toEqual(notes);
  expect(loaded.props.children[2].props.children[1].props.results).toEqual(pbs);
  const activity = loaded.props.children[3].props.children[1].props.activity;
  expect(activity).toEqual([{ kind: "record", ...records[0], author: {
    id: target.id, display_name: target.display_name, avatar_url: null,
    blocks: target.blocks, grade: target.grade,
  } }]);
  expect(mocks.competitions).not.toHaveBeenCalled();
});

it("retains system management of another member's results", async () => {
  const pbs = [{ id: "result", event_name: "100m" }];
  const competitions = [{ id: "competition" }];
  mocks.viewer.mockResolvedValue({ ...viewer, roles: [{ can_manage_system: true }] });
  mocks.pbs.mockResolvedValue(pbs);
  mocks.competitions.mockResolvedValue(competitions);
  const shell = await openMember();
  const details = shell.props.children[1].props.children[1].props.children;
  const loaded = await details.type(details.props);
  const manager = loaded.props.children[2].props.children[1].props.children[0];
  expect(manager.props).toMatchObject({ userId: target.id, initial: pbs, competitions });
  expect(mocks.competitions).toHaveBeenCalledTimes(1);
});

it("preserves history loading errors after the profile appears", async () => {
  mocks.records.mockRejectedValue(new Error("記録の取得に失敗"));
  const shell = await openMember();
  expect(renderToStaticMarkup(shell.props.children[1].props.children[0])).toContain(target.display_name);
  const details = shell.props.children[1].props.children[1].props.children;
  await expect(details.type(details.props)).rejects.toThrow("記録の取得に失敗");
});
