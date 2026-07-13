"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { jstToday } from "@/lib/date";
import { MenuSheetImportManager } from "@/components/features/MenuSheetImportManager";
import { PersonPicker } from "@/components/features/PersonPicker";
import { BLOCK_ORDER, BLOCKS } from "@/lib/constants";
import type {
  AuthorMini,
  Block,
  PracticeMenu,
} from "@/types";

type MenuKind = "block" | "people";
type MenuStatus = "draft" | "published";
export type MenuSaveResult = Pick<PracticeMenu, "id" | "schedule_id" | "content" | "target_block" | "status" | "pace" | "remark" | "supplement" | "targets">;

// 直近に使った「メニューの種類」（端末単位）。初期表示のチラつき防止に同期的に読む。
const MENU_LAST_KIND_KEY = "track-app:menu-last-kind";

function readLastMenuKind(): MenuKind {
  if (typeof window === "undefined") return "block";
  return localStorage.getItem(MENU_LAST_KIND_KEY) === "people" ? "people" : "block";
}

type UpcomingSchedule = {
  id: string;
  schedule_date: string;
  title: string | null;
  venue_name: string | null;
  schedule_type: string;
};

/** 「過去メニューから複製」ピッカーに出す1件 */
type HistoryMenu = {
  id: string;
  content: string;
  pace: string | null;
  remark: string | null;
  supplement: string | null;
  target_block: Block | null;
  created_at: string;
  targets: { user_id: string }[];
};

/** 予定カードから練習メニューを追加する */
export function MenuForm({ scheduleId }: { scheduleId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent/50 py-2.5 text-[13px] font-semibold text-accent active:bg-accent/5"
      >
        <Plus size={16} /> メニューを追加
      </button>
      {open && (
        <FormModal open onOpenChange={setOpen} title="練習メニューを追加">
          <MenuCreatePanel scheduleId={scheduleId} onDone={() => setOpen(false)} />
        </FormModal>
      )}
    </>
  );
}

/** FABから予定を選び、練習メニューを作成する */
export function MenuComposerForm({ onDone }: { onDone: () => void }) {
  return <MenuCreatePanel onDone={onDone} />;
}

/** 通常入力とスプシ/CSVから一括登録を切り替えるパネル */
function MenuCreatePanel({
  scheduleId,
  onDone,
}: {
  scheduleId?: string;
  onDone: (saved?: MenuSaveResult) => void;
}) {
  const [mode, setMode] = useState<"normal" | "sheets">("normal");

  return (
    <div className="space-y-5 pb-4">
      <SegmentedControl
        items={[
          { key: "normal", label: "通常入力" },
          { key: "sheets", label: "スプシ/CSVから入力" },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === "normal" ? (
        <MenuEditor scheduleId={scheduleId} onDone={onDone} />
      ) : (
        <MenuSheetImportManager />
      )}
    </div>
  );
}

export function MenuEditModal({
  menu,
  scheduleId,
  open,
  onOpenChange,
  onSaved,
}: {
  menu: PracticeMenu;
  scheduleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (menu: PracticeMenu) => void;
}) {
  if (!open) return null;
  return (
    <FormModal open onOpenChange={onOpenChange} title="練習メニューを編集">
      <MenuEditor
        menu={menu}
        scheduleId={scheduleId}
        onDone={(saved) => { if (saved) onSaved?.({ ...menu, ...saved }); onOpenChange(false); }}
      />
    </FormModal>
  );
}

function MenuEditor({
  scheduleId: fixedScheduleId,
  menu,
  onDone,
}: {
  scheduleId?: string;
  menu?: PracticeMenu;
  onDone: (saved?: MenuSaveResult) => void;
}) {
  const { showToast } = useToast();
  const initialTargetIds = menu?.targets?.map((target) => target.user_id) ?? [];
  const [schedules, setSchedules] = useState<UpcomingSchedule[] | null>(
    fixedScheduleId ? [] : null,
  );
  const [members, setMembers] = useState<AuthorMini[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState(fixedScheduleId ?? menu?.schedule_id ?? "");
  const [kind, setKind] = useState<MenuKind>(() => {
    if (initialTargetIds.length > 0) return "people";
    if (menu) return "block";
    // 新規作成時は直近に使った種類で開く（チラつき防止のため初期値で確定）
    return readLastMenuKind();
  });
  const [targetBlock, setTargetBlock] = useState<Block>(
    menu?.target_block ?? "middle_long",
  );
  const [targetIds, setTargetIds] = useState<string[]>(initialTargetIds);
  const [content, setContent] = useState(menu?.content ?? "");
  const [pace, setPace] = useState(menu?.pace ?? "");
  const [remark, setRemark] = useState(menu?.remark ?? "");
  const [supplement, setSupplement] = useState(menu?.supplement ?? "");
  const [status, setStatus] = useState<MenuStatus>(menu?.status ?? "draft");
  const [history, setHistory] = useState<HistoryMenu[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = createClient();
      const today = jstToday();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const [scheduleResult, memberResult, previousMenuResult] = await Promise.all([
        fixedScheduleId
          ? Promise.resolve({ data: [] })
          : supabase
              .from("practice_schedules")
              .select("id, schedule_date, title, venue_name, schedule_type")
              .gte("schedule_date", today)
              .order("schedule_date", { ascending: true }),
        supabase
          .from("profiles")
          .select("id, display_name, avatar_url, blocks, grade")
          .eq("status", "active")
          .order("display_name", { ascending: true }),
        user
          ? supabase
              .from("practice_menus")
              .select("targets:practice_menu_targets!inner(user_id)")
              .eq("author_id", user.id)
              .is("target_block", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!active) return;

      const scheduleRows = (scheduleResult.data ?? []) as UpcomingSchedule[];
      const memberRows = (memberResult.data ?? []) as AuthorMini[];
      setSchedules(scheduleRows);
      if (!fixedScheduleId && scheduleRows.length > 0) {
        setScheduleId((current) => current || scheduleRows[0].id);
      }
      setMembers(memberRows);

      if (user) {
        setCurrentUserId(user.id);
        // 直近値の自動初期値（対象者引き継ぎ）: 新規作成時だけ、直前に作った
        // 個別メニューの対象者をプリロードする。
        if (!menu) {
          const validMemberIds = new Set(memberRows.map((member) => member.id));
          const previousMenuTargets = (
            (previousMenuResult.data?.targets ?? []) as { user_id: string }[]
          ).map((target) => target.user_id);
          const previousTargets = previousMenuTargets.filter((id) => validMemberIds.has(id));
          if (previousTargets.length > 0) {
            setTargetIds(previousTargets);
          }
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [fixedScheduleId, menu]);

  // 過去のメニュー履歴はシートを開いたときだけ取得する
  useEffect(() => {
    if (!historyOpen || history !== null || !currentUserId) return;
    let active = true;
    const supabase = createClient();
    void supabase
      .from("practice_menus")
      .select(
        "id, content, pace, remark, supplement, target_block, created_at, targets:practice_menu_targets(user_id)",
      )
      .eq("author_id", currentUserId)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (active) setHistory((data ?? []) as unknown as HistoryMenu[]);
      });
    return () => {
      active = false;
    };
  }, [historyOpen, history, currentUserId]);


  /** 過去に公開したメニュー1件を丸ごと複製（種類・ブロック・対象者・メニュー・ペース・補足・補強） */
  function loadHistoryItem(item: HistoryMenu) {
    const ids = item.targets?.map((target) => target.user_id) ?? [];
    setKind(ids.length > 0 ? "people" : "block");
    if (item.target_block) setTargetBlock(item.target_block);
    setTargetIds(ids);
    setContent(item.content ?? "");
    setPace(item.pace ?? "");
    setRemark(item.remark ?? "");
    setSupplement(item.supplement ?? "");
    setHistoryOpen(false);
    showToast("過去のメニューを読み込みました", "success");
  }

  /** 履歴一覧の1行要約 */
  function historySummary(item: HistoryMenu): string {
    const scope =
      item.targets.length > 0
        ? `個人${item.targets.length}人`
        : item.target_block
          ? BLOCKS[item.target_block].label
          : "ブロック";
    const firstLine = item.content?.split("\n").find((line) => line.trim());
    return firstLine ? `${scope}・${firstLine}` : scope;
  }

  const filteredHistory = (history ?? []).filter((item) => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return true;
    return item.content.toLowerCase().includes(q);
  });

  async function submit() {
    if (!scheduleId) {
      setError("対象の予定を選択してください");
      return;
    }
    const hasMiddleLongExtras =
      targetBlock === "middle_long" &&
      (pace.trim() || remark.trim() || supplement.trim());
    if (!content.trim() && !hasMiddleLongExtras) {
      setError("メニュー内容を入力してください");
      return;
    }
    if (kind === "people" && targetIds.length === 0) {
      setError("対象者を1人以上選択してください");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data: savedId, error: saveError } = await supabase.rpc("save_practice_menu", {
      target_schedule_id: scheduleId,
      menu_content: content.trim(),
      menu_status: status,
      // 個別メニューにもブロックを持たせる（同ブロックの部員が閲覧できるように）
      menu_target_block: targetBlock,
      target_user_ids: kind === "people" ? targetIds : [],
      target_menu_id: menu?.id ?? null,
      menu_pace: targetBlock === "middle_long" ? pace.trim() || null : null,
      menu_remark:
        targetBlock === "middle_long" || targetBlock === "short"
          ? remark.trim() || null
          : null,
      menu_supplement: targetBlock === "middle_long" ? supplement.trim() || null : null,
    });

    if (saveError) {
      setError("メニューを保存できませんでした");
      setSaving(false);
      return;
    }
    // 次回の初期表示用に、選んだ種類を端末に保存
    if (typeof window !== "undefined") {
      localStorage.setItem(MENU_LAST_KIND_KEY, kind);
    }
    const selectedTargets = kind === "people" ? (members ?? []).filter((member) => targetIds.includes(member.id)).map((member) => ({ menu_id: savedId as string, user_id: member.id, profile: member })) : [];
    onDone({ id: savedId as string, schedule_id: scheduleId, content: content.trim(), target_block: targetBlock, status, pace: targetBlock === "middle_long" ? pace.trim() || null : null, remark: targetBlock === "middle_long" || targetBlock === "short" ? remark.trim() || null : null, supplement: targetBlock === "middle_long" ? supplement.trim() || null : null, targets: selectedTargets });
  }

  const loading = schedules === null || members === null;


  return (
    <div className="space-y-5 pb-4">
      {!fixedScheduleId && (
        <div>
          <p className="section-label mb-1.5">対象の予定</p>
          {schedules === null ? (
            <Skeleton className="h-11 w-full" />
          ) : schedules.length === 0 ? (
            <EmptyState
              title="今後の予定がありません"
              description="先に練習予定を作成してください。"
              className="min-h-24 py-4"
            />
          ) : (
            <Select
              value={scheduleId}
              onValueChange={setScheduleId}
              ariaLabel="対象の予定"
              options={schedules.map((schedule) => ({
                value: schedule.id,
                label: scheduleLabel(schedule),
              }))}
            />
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent/50 py-2.5 text-[13px] font-semibold text-accent active:bg-accent/5"
      >
        <Copy size={16} /> 過去のメニューから複製
      </button>

      <div>
        <p className="section-label mb-1.5">メニューの種類</p>
        <SegmentedControl
          items={[
            { key: "block", label: "ブロック全体" },
            { key: "people", label: "個人を指定" },
          ]}
          value={kind}
          onChange={(key) => setKind(key as MenuKind)}
        />
      </div>

      {kind === "block" ? (
        <div>
          <p className="section-label mb-1.5">ブロック</p>
          <div className="grid grid-cols-2 gap-2">
            {BLOCK_ORDER.map((block) => {
              const meta = BLOCKS[block];
              const active = targetBlock === block;
              return (
                <button
                  key={block}
                  type="button"
                  onClick={() => setTargetBlock(block)}
                  className="h-11 rounded-xl border text-[14px] font-semibold"
                  style={{
                    borderColor: active ? meta.color : "#e5e5ea",
                    backgroundColor: active ? meta.bg : "#fff",
                    color: active ? meta.color : "#8e8e93",
                  }}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="section-label mb-1.5">ブロック</p>
            <p className="text-micro mb-1.5">同じブロックの部員もこの個別メニューを閲覧できます。</p>
            <div className="grid grid-cols-2 gap-2">
              {BLOCK_ORDER.map((block) => {
                const meta = BLOCKS[block];
                const active = targetBlock === block;
                return (
                  <button
                    key={block}
                    type="button"
                    onClick={() => setTargetBlock(block)}
                    className="h-11 rounded-xl border text-[14px] font-semibold"
                    style={{
                      borderColor: active ? meta.color : "#e5e5ea",
                      backgroundColor: active ? meta.bg : "#fff",
                      color: active ? meta.color : "#8e8e93",
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
          <PersonPicker people={members ?? []} value={targetIds} onChange={setTargetIds} label="対象者" />
        </div>
      )}

      <div>
        <p className="section-label mb-1.5">メニュー</p>
        <Textarea
          rows={8}
          placeholder={"例:\nW-up 2km\n本練習 1000m×5 (R3')\nD-down 2km"}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </div>

      {targetBlock === "short" && (
        <div>
          <p className="section-label mb-1.5">説明</p>
          <Textarea
            rows={5}
            placeholder="メニューの目的や走り方のポイント"
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
          />
        </div>
      )}

      {targetBlock === "middle_long" && (
        <>
          <div>
            <p className="section-label mb-1.5">ペース</p>
            <Textarea
              rows={3}
              placeholder={"例: 1000mを3'30〜3'40"}
              value={pace}
              onChange={(event) => setPace(event.target.value)}
            />
          </div>
          <div>
            <p className="section-label mb-1.5">補足</p>
            <Textarea
              rows={3}
              placeholder={"例: 雨天時は室内メニューに変更"}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
            />
          </div>
          <div>
            <p className="section-label mb-1.5">補強</p>
            <Textarea
              rows={4}
              placeholder={"例: 体幹サーキット×3セット"}
              value={supplement}
              onChange={(event) => setSupplement(event.target.value)}
            />
          </div>
        </>
      )}

      <div>
        <p className="section-label mb-1.5">公開状態</p>
        <SegmentedControl
          items={[
            { key: "draft", label: "下書き" },
            { key: "published", label: "公開" },
          ]}
          value={status}
          onChange={(key) => setStatus(key as MenuStatus)}
        />
        <p className="text-micro mt-1.5">
          下書きは作成権限者だけに表示されます。
        </p>
      </div>

      {error && <p className="text-center text-caption text-danger">{error}</p>}
      <FormModalFooter>
        <Button
          size="lg"
          onClick={submit}
          disabled={saving || loading || (!fixedScheduleId && schedules?.length === 0)}
        >
          {saving ? "保存中…" : menu ? "更新する" : "保存する"}
        </Button>
      </FormModalFooter>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent title="過去のメニューから複製" autoFocus={false}>
          <div className="space-y-3 pb-2">
            <Input
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="内容で検索"
            />
            {history === null ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : filteredHistory.length === 0 ? (
              <EmptyState
                title="過去に公開したメニューがありません"
                className="min-h-24 py-4"
              />
            ) : (
              <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
                {filteredHistory.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => loadHistoryItem(item)}
                      className="flex min-h-14 w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left active:bg-bg"
                    >
                      <span className="block w-full truncate text-[14px] font-medium">
                        {historySummary(item)}
                      </span>
                      <span className="block text-micro text-muted2">
                        {format(new Date(item.created_at), "M/d(E)", { locale: ja })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function scheduleLabel(schedule: UpcomingSchedule): string {
  const date = format(new Date(`${schedule.schedule_date}T00:00:00`), "M/d(E)", {
    locale: ja,
  });
  const name =
    schedule.title ||
    schedule.venue_name ||
    (schedule.schedule_type === "practice" ? "練習" : "予定");
  return `${date} ${name}`;
}
