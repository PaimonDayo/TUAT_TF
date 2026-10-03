import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  obEntry: vi.fn(), obDuties: vi.fn(), profile: vi.fn(), notices: vi.fn(), competition: vi.fn(), schedules: vi.fn(),
  attendance: vi.fn(), summary: vi.fn(), notes: vi.fn(), feed: vi.fn(), program: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/auth", () => ({ getCurrentProfile: mocks.profile, getCurrentUserId: async () => "me" }));
vi.mock("@/lib/queries/ob-entries", () => ({ getMyObDuties: mocks.obDuties, getMyObEntry: mocks.obEntry, getMyObEntryCandidates: async () => [] }));
vi.mock("@/lib/queries", () => ({
  getHomeNotices: mocks.notices, getHomeCompetition: mocks.competition,
  getAttendanceSchedules: mocks.schedules, getAttendancesForSchedules: mocks.attendance,
  getUserTrainingSummary: mocks.summary, getRecentSharedNotes: mocks.notes,
  getFeed: mocks.feed, getCompetitionProgramEntries: mocks.program,
}));
import HomePage from "./page";

describe("home content loading", () => {
  beforeEach(() => {
    mocks.profile.mockResolvedValue({ id: "me", blocks: ["middle_long"], roles: [], display_name: "テスト", sheet_name: null });
    mocks.obEntry.mockResolvedValue(null);
    mocks.obDuties.mockResolvedValue([]);
    mocks.competition.mockResolvedValue(null);
    mocks.schedules.mockResolvedValue([]);
    mocks.summary.mockResolvedValue({ distance: 0, count: 0 });
    mocks.notes.mockResolvedValue([]);
    mocks.feed.mockResolvedValue([]);
    mocks.notices.mockResolvedValue([]);
  });

  it("starts independent sections together, but reveals them only when the whole body is ready", async () => {
    let resolveNotices!: (value: unknown[]) => void;
    mocks.notices.mockReturnValue(new Promise(resolve => { resolveNotices = resolve; }));
    const page = HomePage();
    const body = page.props.children[1].props.children;
    let completed = false;
    const result = body.type(body.props).then((value: unknown) => { completed = true; return value; });
    await vi.waitFor(() => {
      expect(mocks.summary).toHaveBeenCalledTimes(1);
      expect(mocks.feed).toHaveBeenCalledWith("me", 3);
      expect(mocks.schedules).toHaveBeenCalledTimes(1);
      expect(mocks.notes).toHaveBeenCalledWith(3);
    });
    expect(completed).toBe(false);
    resolveNotices([]);
    await expect(result).resolves.toBeDefined();
    expect(completed).toBe(true);
  });

  it("skips distance aggregation for other blocks and attendance when there are no schedules", async () => {
    mocks.profile.mockResolvedValue({ id: "me", blocks: ["short"], roles: [], display_name: "テスト", sheet_name: null });
    const body = HomePage().props.children[1].props.children;
    await body.type(body.props);
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.attendance).not.toHaveBeenCalled();
    expect(mocks.program).not.toHaveBeenCalled();
  });
});

describe("home OB entry card",()=>{
  beforeEach(()=>{
    mocks.profile.mockResolvedValue({id:"me",blocks:[],roles:[],display_name:"テスト"});
    mocks.obEntry.mockResolvedValue(null);mocks.obDuties.mockResolvedValue([]);
    mocks.competition.mockResolvedValue(null);mocks.schedules.mockResolvedValue([]);
    mocks.notes.mockResolvedValue([]);mocks.feed.mockResolvedValue([]);mocks.notices.mockResolvedValue([]);
  });
it("renders personal duty times and competition times in the home entry card",async()=>{
  mocks.obEntry.mockResolvedValue({id:"my-entry",events:["男子100m"],qualification_marks:{"男子100m":"12.34"}});
  mocks.obDuties.mockResolvedValue([{time:"13:00",event:"走り高跳び",assignment:"計測"}]);
  const body=HomePage().props.children[1].props.children;
  const content=await body.type(body.props);
  const html=renderToStaticMarkup(content.props.children[2]);
  expect(mocks.obDuties).toHaveBeenCalledWith("me","my-entry");
  for(const text of ["11:00","13:00","計測","自分の補助担当","プログラム（タイムテーブル）"])expect(html).toContain(text);
});
it("keeps the entry and program available when duty retrieval fails",async()=>{
  mocks.obDuties.mockRejectedValue(new Error("unavailable"));
  const body=HomePage().props.children[1].props.children;
  const content=await body.type(body.props);
  const html=renderToStaticMarkup(content.props.children[2]);
  expect(html).toContain("補助担当を取得できませんでした");
  expect(html).not.toContain("補助担当はまだ登録されていません");
  expect(html).toContain("プログラム・補助員表を見る");
});

});
