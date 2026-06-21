"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Check, Plus, Save } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { BLOCK_ORDER, BLOCKS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  AuthorMini,
  Block,
  MenuTargetPreset,
  PracticeMenu,
} from "@/types";

type MenuKind = "block" | "people";
type MenuStatus = "draft" | "published";

type UpcomingSchedule = {
  id: string;
  schedule_date: string;
  title: string | null;
  venue_name: string | null;
  schedule_type: string;
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
        className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-accent active:opacity-50"
      >
        <Plus size={15} /> メニューを追加
      </button>
      {open && (
        <FormModal open onOpenChange={setOpen} title="練習メニューを追加">
          <MenuEditor scheduleId={scheduleId} onDone={() => setOpen(false)} />
        </FormModal>
      )}
    </>
  );
}

/** FABから予定を選び、練習メニューを作成する */
export function MenuComposerForm({ onDone }: { onDone: () => void }) {
  return <MenuEditor onDone={onDone} />;
}

export function MenuEditModal({
  menu,
  scheduleId,
  open,
  onOpenChange,
}: {
  menu: PracticeMenu;
  scheduleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return (
    <FormModal open onOpenChange={onOpenChange} title="練習メニューを編集">
      <MenuEditor
        menu={menu}
        scheduleId={scheduleId}
        onDone={() => onOpenChange(false)}
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
  onDone: () => void;
}) {
  const router = useRouter();
  const initialTargetIds = useMemo(
    () => menu?.targets?.map((target) => target.user_id) ?? [],
    [menu],
  );
  const [schedules, setSchedules] = useState<UpcomingSchedule[] | null>(
    fixedScheduleId ? [] : null,
  );
  const [members, setMembers] = useState<AuthorMini[] | null>(null);
  const [presets, setPresets] = useState<MenuTargetPreset[]>([]);
  const [scheduleId, setScheduleId] = useState(fixedScheduleId ?? menu?.schedule_id ?? "");
  const [kind, setKind] = useState<MenuKind>(
    initialTargetIds.length > 0 ? "people" : "block",
  );
  const [targetBlock, setTargetBlock] = useState<Block>(
    menu?.target_block ?? "middle_long",
  );
  const [targetIds, setTargetIds] = useState<string[]>(initialTargetIds);
  const [content, setContent] = useState(menu?.content ?? "");
  const [status, setStatus] = useState<MenuStatus>(menu?.status ?? "draft");
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = createClient();
      const today = new Date().toISOString().slice(0, 10);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const [scheduleResult, memberResult, presetResult] = await Promise.all([
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
              .from("menu_target_presets")
              .select("*")
              .eq("author_id", user.id)
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [] }),
      ]);
      if (!active) return;

      const scheduleRows = (scheduleResult.data ?? []) as UpcomingSchedule[];
      setSchedules(scheduleRows);
      if (!fixedScheduleId && !scheduleId && scheduleRows.length > 0) {
        setScheduleId(scheduleRows[0].id);
      }
      setMembers((memberResult.data ?? []) as AuthorMini[]);
      setPresets((presetResult.data ?? []) as MenuTargetPreset[]);
    }
    void load();
    return () => {
      active = false;
    };
  }, [fixedScheduleId, scheduleId]);

  function toggleTarget(userId: string) {
    setTargetIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name || targetIds.length === 0 || savingPreset) return;
    setSavingPreset(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSavingPreset(false);
      return;
    }
    const { data, error: presetError } = await supabase
      .from("menu_target_presets")
      .insert({ author_id: user.id, name, user_ids: targetIds })
      .select("*")
      .single();
    if (presetError || !data) {
      setError("プリセットを保存できませんでした");
    } else {
      setPresets((items) => [...items, data as MenuTargetPreset]);
      setPresetName("");
    }
    setSavingPreset(false);
  }

  async function submit() {
    if (!scheduleId) {
      setError("対象の予定を選択してください");
      return;
    }
    if (!content.trim()) {
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
    const { error: saveError } = await supabase.rpc("save_practice_menu", {
      target_schedule_id: scheduleId,
      menu_content: content.trim(),
      menu_status: status,
      menu_target_block: kind === "block" ? targetBlock : null,
      target_user_ids: kind === "people" ? targetIds : [],
      target_menu_id: menu?.id ?? null,
    });

    if (saveError) {
      setError("メニューを保存できませんでした");
      setSaving(false);
      return;
    }
    router.refresh();
    onDone();
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

      <div>
        <p className="section-label mb-1.5">メニューの種類</p>
        <SegmentedControl
          items={[
            { key: "block", label: "ブロック共通" },
            { key: "people", label: "対象者を指定" },
          ]}
          value={kind}
          onChange={(key) => setKind(key as MenuKind)}
        />
      </div>

      {kind === "block" ? (
        <div>
          <p className="section-label mb-1.5">対象ブロック</p>
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
            <p className="section-label mb-1.5">プリセット</p>
            {presets.length > 0 ? (
              <Select
                value={selectedPreset}
                onValueChange={(value) => {
                  const preset = presets.find((item) => item.id === value);
                  if (preset) setTargetIds(preset.user_ids);
                  setSelectedPreset("");
                }}
                ariaLabel="プリセット"
                options={[
                  { value: "", label: "プリセットを読み込む" },
                  ...presets.map((preset) => ({
                    value: preset.id,
                    label: preset.name,
                  })),
                ]}
              />
            ) : (
              <p className="text-caption">保存済みのプリセットはありません。</p>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="section-label">対象者</p>
              <span className="text-caption">{targetIds.length}人選択</span>
            </div>
            {members === null ? (
              <div className="space-y-2">
                {[0, 1, 2].map((item) => (
                  <Skeleton key={item} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-separator bg-card p-1">
                {members.map((member) => {
                  const active = targetIds.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleTarget(member.id)}
                      className={cn(
                        "flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left",
                        active ? "bg-accent/10" : "active:bg-bg",
                      )}
                    >
                      <Avatar
                        name={member.display_name}
                        avatarUrl={member.avatar_url}
                        blocks={member.blocks}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                        {member.display_name}
                      </span>
                      {active && <Check size={18} className="shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {targetIds.length > 0 && (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-micro mb-1">現在の対象者をプリセットとして保存</p>
                <Input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="例: 長距離A"
                  maxLength={30}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={savePreset}
                disabled={!presetName.trim() || savingPreset}
                className="h-11 px-3"
              >
                <Save size={16} />
                保存
              </Button>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="section-label mb-1.5">メニュー内容</p>
        <Textarea
          rows={8}
          placeholder={"例:\nW-up 2km\n本練習 1000m×5 (R3')\nD-down 2km"}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </div>

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
