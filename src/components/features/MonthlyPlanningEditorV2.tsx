"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Save, Star } from "lucide-react";
import { PersonPicker } from "@/components/features/PersonPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { BLOCK_ORDER, BLOCKS } from "@/lib/constants";
import type { AuthorMini, Block, PracticeMenu, PracticeSchedule, VenueRow } from "@/types";

type ScheduleDraft = { id?: string; time: string; venue: string; note: string };
type MenuDraft = { id?: string; content: string; pace: string; remark: string; supplement: string };
type MenuPreset = MenuDraft & { key: string; name: string; block: Block };
type TargetPreset = { key: string; name: string; ids: string[] };
type RowState = "dirty" | "saving" | "saved" | "error";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const MENU_PRESETS_KEY = "track-app:menu-presets-v1";
const TARGET_PRESETS_KEY = "track-app:target-presets-v1";

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}

function hasScheduleValue(draft?: ScheduleDraft) { return !!draft && !!(draft.time || draft.venue || draft.note); }
function hasMenuValue(draft?: MenuDraft) { return !!draft && [draft.content, draft.pace, draft.remark, draft.supplement].some((value) => value.trim()); }

export function MonthlyPlanningEditorV2({ initialTab = "schedule", canSchedule = true, canMenu = true }: { initialTab?: "schedule" | "menu"; canSchedule?: boolean; canMenu?: boolean }) {
  const now = new Date();
  const [tab, setTab] = useState<"schedule" | "menu">(initialTab === "menu" && !canMenu ? "schedule" : initialTab === "schedule" && !canSchedule ? "menu" : initialTab);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [block, setBlock] = useState<Block>("middle_long");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [members, setMembers] = useState<AuthorMini[]>([]);
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [schedules, setSchedules] = useState<Record<string, PracticeSchedule>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [menuDrafts, setMenuDrafts] = useState<Record<string, MenuDraft>>({});
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuPresets, setMenuPresets] = useState<MenuPreset[]>(() => readStored(MENU_PRESETS_KEY, []));
  const [targetPresets, setTargetPresets] = useState<TargetPreset[]>(() => readStored(TARGET_PRESETS_KEY, []));
  const [presetName, setPresetName] = useState("");
  const [activeDate, setActiveDate] = useState<string | null>(null);

  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const localDraftKey = `track-app:monthly-planner:${monthKey}`;
  const days = useMemo(() => Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => {
    const date = `${monthKey}-${String(index + 1).padStart(2, "0")}`;
    return { date, day: index + 1, weekday: WEEKDAYS[new Date(year, month - 1, index + 1).getDay()] };
  }), [month, monthKey, year]);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const start = `${monthKey}-01`;
    const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    void Promise.all([
      supabase.from("practice_schedules").select("*").gte("schedule_date", start).lt("schedule_date", end).order("schedule_date"),
      supabase.from("profiles").select("id, display_name, avatar_url, blocks, grade").eq("status", "active").order("display_name"),
      supabase.from("venues").select("*").eq("pinned", true).order("sort"),
    ]).then(([scheduleResult, memberResult, venueResult]) => {
      if (!active) return;
      const rows = (scheduleResult.data ?? []) as PracticeSchedule[];
      const byDate: Record<string, PracticeSchedule> = {};
      const drafts: Record<string, ScheduleDraft> = {};
      rows.forEach((row) => { byDate[row.schedule_date] = row; drafts[row.schedule_date] = { id: row.id, time: row.meeting_time?.slice(0, 5) ?? "", venue: row.venue_name ?? "", note: row.note ?? "" }; });
      const local = readStored<{ schedules?: Record<string, ScheduleDraft> }>(localDraftKey, {});
      setSchedules(byDate); setScheduleDrafts({ ...drafts, ...(local.schedules ?? {}) });
      setMembers((memberResult.data ?? []) as AuthorMini[]); setVenues((venueResult.data ?? []) as VenueRow[]);
    });
    return () => { active = false; };
  }, [localDraftKey, month, monthKey, year]);

  useEffect(() => {
    let active = true;
    const scheduleIds = Object.values(schedules).map((schedule) => schedule.id);
    if (!scheduleIds.length) return;
    void createClient().from("practice_menus").select("*, targets:practice_menu_targets(user_id)").in("schedule_id", scheduleIds).eq("target_block", block).then(({ data }) => {
      if (!active) return;
      const dateById = new Map(Object.values(schedules).map((schedule) => [schedule.id, schedule.schedule_date]));
      const drafts: Record<string, MenuDraft> = {};
      for (const menu of (data ?? []) as PracticeMenu[]) {
        const targets = menu.targets?.map((target) => target.user_id) ?? [];
        if ([...targets].sort().join(",") !== [...targetIds].sort().join(",")) continue;
        const date = dateById.get(menu.schedule_id); if (!date) continue;
        drafts[date] = { id: menu.id, content: menu.content ?? "", pace: menu.pace ?? "", remark: menu.remark ?? "", supplement: menu.supplement ?? "" };
      }
      const local = readStored<{ menus?: Record<string, MenuDraft> }>(localDraftKey, {});
      setMenuDrafts({ ...drafts, ...(local.menus ?? {}) });
    });
    return () => { active = false; };
  }, [block, localDraftKey, schedules, targetIds]);

  useEffect(() => {
    if (!Object.values(rowStates).some((state) => state === "dirty")) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(localDraftKey, JSON.stringify({ schedules: scheduleDrafts, menus: menuDrafts }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [localDraftKey, menuDrafts, rowStates, scheduleDrafts]);

  function moveMonth(delta: number) { const next = new Date(year, month - 1 + delta, 1); setYear(next.getFullYear()); setMonth(next.getMonth() + 1); setRowStates({}); setMenuDrafts({}); }
  function stateKey(kind: "schedule" | "menu", date: string) { return `${kind}:${date}`; }
  function markDirty(kind: "schedule" | "menu", date: string) { setRowStates((current) => ({ ...current, [stateKey(kind, date)]: "dirty" })); }
  function updateSchedule(date: string, patch: Partial<ScheduleDraft>) { setScheduleDrafts((current) => ({ ...current, [date]: { id: current[date]?.id, time: current[date]?.time ?? "", venue: current[date]?.venue ?? "", note: current[date]?.note ?? "", ...patch } })); markDirty("schedule", date); }
  function updateMenu(date: string, patch: Partial<MenuDraft>) { setMenuDrafts((current) => ({ ...current, [date]: { id: current[date]?.id, content: current[date]?.content ?? "", pace: current[date]?.pace ?? "", remark: current[date]?.remark ?? "", supplement: current[date]?.supplement ?? "", ...patch } })); markDirty("menu", date); }

  async function saveSchedule(date: string): Promise<PracticeSchedule | null> {
    const draft = scheduleDrafts[date]; if (!hasScheduleValue(draft)) return schedules[date] ?? null;
    if (!canSchedule) return null;
    setRowStates((current) => ({ ...current, [stateKey("schedule", date)]: "saving" }));
    const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return null;
    const payload = { schedule_date: date, schedule_type: "practice", meeting_time: draft.time || null, venue_name: draft.venue || null, note: draft.note || null, target_blocks: [] as Block[] };
    const result = draft.id ? await supabase.from("practice_schedules").update(payload).eq("id", draft.id).select("*").single() : await supabase.from("practice_schedules").insert({ ...payload, created_by: user.id }).select("*").single();
    if (result.error || !result.data) { setRowStates((current) => ({ ...current, [stateKey("schedule", date)]: "error" })); return null; }
    const saved = result.data as PracticeSchedule; setSchedules((current) => ({ ...current, [date]: saved })); setScheduleDrafts((current) => ({ ...current, [date]: { ...current[date], id: saved.id } })); setRowStates((current) => ({ ...current, [stateKey("schedule", date)]: "saved" })); return saved;
  }

  async function ensureSchedule(date: string): Promise<PracticeSchedule | null> {
    if (schedules[date]) return schedules[date];
    const saved = await saveSchedule(date); if (saved) return saved;
    const supabase = createClient();
    const { data: ensured } = await supabase.rpc("ensure_practice_schedule_for_menu", { target_date: date });
    if (ensured) {
      const { data } = await supabase.from("practice_schedules").select("*").eq("id", ensured as string).single();
      if (data) { const schedule = data as PracticeSchedule; setSchedules((current) => ({ ...current, [date]: schedule })); return schedule; }
    }
    const { data: { user } } = await supabase.auth.getUser(); if (!user) return null;
    const { data } = await supabase.from("practice_schedules").insert({ schedule_date: date, schedule_type: "practice", created_by: user.id, target_blocks: [] }).select("*").single();
    if (!data) return null;
    const schedule = data as PracticeSchedule; setSchedules((current) => ({ ...current, [date]: schedule })); return schedule;
  }

  async function saveMenu(date: string) {
    const draft = menuDrafts[date]; if (!hasMenuValue(draft)) return true;
    setRowStates((current) => ({ ...current, [stateKey("menu", date)]: "saving" }));
    const schedule = await ensureSchedule(date); if (!schedule) { setRowStates((current) => ({ ...current, [stateKey("menu", date)]: "error" })); return false; }
    const { data, error: saveError } = await createClient().rpc("save_practice_menu", { target_schedule_id: schedule.id, menu_content: draft.content.trim(), menu_status: status, menu_target_block: block, target_user_ids: targetIds, target_menu_id: draft.id ?? null, menu_pace: draft.pace.trim() || null, menu_remark: draft.remark.trim() || null, menu_supplement: draft.supplement.trim() || null });
    if (saveError) { setRowStates((current) => ({ ...current, [stateKey("menu", date)]: "error" })); return false; }
    setMenuDrafts((current) => ({ ...current, [date]: { ...current[date], id: data as string } })); setRowStates((current) => ({ ...current, [stateKey("menu", date)]: "saved" })); return true;
  }

  async function saveAll() {
    setSavingAll(true); setError(null);
    const dates = days.map((day) => day.date).filter((date) => rowStates[stateKey(tab, date)] === "dirty" && (tab === "schedule" ? hasScheduleValue(scheduleDrafts[date]) : hasMenuValue(menuDrafts[date])));
    let failed = 0;
    for (const date of dates) { if (tab === "schedule") { if (!await saveSchedule(date)) failed++; } else if (!await saveMenu(date)) failed++; }
    if (failed) setError(`${failed}件を保存できませんでした。赤い行を確認してください。`);
    else { localStorage.removeItem(localDraftKey); }
    setSavingAll(false);
  }

  function saveMenuPreset() {
    const sample = activeDate ? menuDrafts[activeDate] : undefined; if (!sample || !presetName.trim()) return;
    const next = [...menuPresets, { ...sample, id: undefined, key: crypto.randomUUID(), name: presetName.trim(), block }]; setMenuPresets(next); localStorage.setItem(MENU_PRESETS_KEY, JSON.stringify(next)); setPresetName("");
  }
  function saveTargetPreset() { if (!targetIds.length || !presetName.trim()) return; const next = [...targetPresets, { key: crypto.randomUUID(), name: presetName.trim(), ids: targetIds }]; setTargetPresets(next); localStorage.setItem(TARGET_PRESETS_KEY, JSON.stringify(next)); setPresetName(""); }
  function applyMenuPreset(key: string) { const preset = menuPresets.find((item) => item.key === key); if (!preset) return; setBlock(preset.block); const destination = activeDate ?? days.find((day) => !hasMenuValue(menuDrafts[day.date]))?.date ?? days[0]?.date; if (destination) updateMenu(destination, preset); }

  const visibleDays = showActiveOnly ? days.filter(({ date }) => schedules[date] || hasScheduleValue(scheduleDrafts[date]) || hasMenuValue(menuDrafts[date])) : days;
  const dirtyCount = days.filter(({ date }) => rowStates[stateKey(tab, date)] === "dirty").length;

  return <div className="space-y-4 pb-20">
    <SegmentedControl items={[...(canSchedule ? [{ key: "schedule", label: "予定" }] : []), ...(canMenu ? [{ key: "menu", label: "メニュー" }] : [])]} value={tab} onChange={(value) => setTab(value as "schedule" | "menu")} />
    <div className="flex items-center justify-between rounded-xl bg-bg px-2 py-1"><button type="button" onClick={() => moveMonth(-1)} className="p-2"><ChevronLeft /></button><strong>{year}年{month}月</strong><button type="button" onClick={() => moveMonth(1)} className="p-2"><ChevronRight /></button></div>
    <div className="flex items-center justify-between"><button type="button" onClick={() => setShowActiveOnly((value) => !value)} className="text-xs font-semibold text-accent">{showActiveOnly ? "全日表示" : "入力・予定ありのみ"}</button><span className="text-xs text-muted">変更 {dirtyCount}件</span></div>
    {tab === "menu" && <div className="space-y-3 rounded-xl border border-separator bg-card p-3">
      <Select value={block} onValueChange={(value) => setBlock(value as Block)} ariaLabel="ブロック" options={BLOCK_ORDER.map((item) => ({ value: item, label: BLOCKS[item].label }))} />
      <PersonPicker people={members} value={targetIds} onChange={setTargetIds} label="個人指定（空ならブロック全体）" />
      <SegmentedControl items={[{ key: "draft", label: "下書き" }, { key: "published", label: "公開" }]} value={status} onChange={(value) => setStatus(value as "draft" | "published")} />
      <div className="grid grid-cols-[1fr_auto] gap-2"><Select value="" onValueChange={applyMenuPreset} ariaLabel="メニュープリセット" placeholder="メニュープリセット" options={menuPresets.map((item) => ({ value: item.key, label: item.name }))} /><Select value="" onValueChange={(key) => { const preset = targetPresets.find((item) => item.key === key); if (preset) setTargetIds(preset.ids.filter((id) => members.some((member) => member.id === id))); }} ariaLabel="対象者セット" placeholder="対象者セット" options={targetPresets.map((item) => ({ value: item.key, label: item.name }))} /></div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2"><Input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="プリセット名" /><Button variant="outline" onClick={saveMenuPreset}><Star size={15} />内容</Button><Button variant="outline" onClick={saveTargetPreset}><Star size={15} />対象者</Button></div>
    </div>}
    <div className="space-y-2">{visibleDays.map(({ date, day, weekday }) => <section key={date} className={`rounded-xl border bg-card p-3 ${rowStates[stateKey(tab, date)] === "error" ? "border-danger" : "border-separator"}`}><div className="mb-2 flex items-center"><strong className="text-sm">{month}/{day}（{weekday}）</strong><RowStatus state={rowStates[stateKey(tab, date)]} /></div>
      {tab === "schedule" ? <div className="space-y-2"><div className="grid grid-cols-[7rem_1fr] gap-2"><Input type="time" value={scheduleDrafts[date]?.time ?? ""} onChange={(event) => updateSchedule(date, { time: event.target.value })} /><Input list="monthly-venues" placeholder="場所" value={scheduleDrafts[date]?.venue ?? ""} onChange={(event) => updateSchedule(date, { venue: event.target.value })} /></div><Input placeholder="詳細（任意）" value={scheduleDrafts[date]?.note ?? ""} onChange={(event) => updateSchedule(date, { note: event.target.value })} /></div>
      : <div className="space-y-2"><Textarea rows={3} onFocus={() => setActiveDate(date)} placeholder="メニュー" value={menuDrafts[date]?.content ?? ""} onChange={(event) => updateMenu(date, { content: event.target.value })} />{block === "middle_long" && <div className="grid grid-cols-2 gap-2"><Input placeholder="ペース" value={menuDrafts[date]?.pace ?? ""} onChange={(event) => updateMenu(date, { pace: event.target.value })} /><Input placeholder="補足" value={menuDrafts[date]?.remark ?? ""} onChange={(event) => updateMenu(date, { remark: event.target.value })} /></div>}</div>}
    </section>)}</div>
    <datalist id="monthly-venues">{venues.map((venue) => <option key={venue.id} value={venue.name} />)}</datalist>
    {error && <p className="text-center text-caption text-danger">{error}</p>}
    <div className="sticky bottom-0 border-t border-separator bg-card/95 p-3 backdrop-blur"><Button size="lg" className="w-full" disabled={savingAll || dirtyCount === 0} onClick={() => void saveAll()}>{savingAll ? <><LoaderCircle size={17} className="animate-spin" />保存中…</> : <><Save size={17} />変更をまとめて保存（{dirtyCount}件）</>}</Button></div>
  </div>;
}

function RowStatus({ state }: { state?: RowState }) {
  if (state === "saving") return <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted"><LoaderCircle size={13} className="animate-spin" />保存中</span>;
  if (state === "saved") return <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-success"><Check size={13} />保存済み</span>;
  if (state === "error") return <span className="ml-auto text-xs font-semibold text-danger">保存失敗</span>;
  if (state === "dirty") return <span className="ml-auto text-xs text-warning">未保存</span>;
  return null;
}
