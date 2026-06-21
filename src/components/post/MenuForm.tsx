"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Check, ChevronRight, MoreHorizontal, Plus, Save, Trash2 } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
  PracticeMenu,
} from "@/types";

type MenuKind = "block" | "people";
type MenuStatus = "draft" | "published";

type LocalMenuPreset = {
  id: string;
  name: string;
  userIds: string[];
  // プリセットはメニュー本文・ブロックも一緒に保存する（テンプレートとして再利用）
  block?: Block;
  content?: string;
};

type MenuTargetPreferences = {
  presets: LocalMenuPreset[];
  lastTargetIds: string[];
  lastPresetId: string | null;
  migratedLegacyPresets: boolean;
};

const EMPTY_PREFERENCES: MenuTargetPreferences = {
  presets: [],
  lastTargetIds: [],
  lastPresetId: null,
  migratedLegacyPresets: false,
};

function menuPreferencesKey(userId: string) {
  return `track-app:menu-targets:${userId}`;
}

// 直近に使った「メニューの種類」（端末単位）。初期表示のチラつき防止に同期的に読む。
const MENU_LAST_KIND_KEY = "track-app:menu-last-kind";

function readLastMenuKind(): MenuKind {
  if (typeof window === "undefined") return "block";
  return localStorage.getItem(MENU_LAST_KIND_KEY) === "people" ? "people" : "block";
}

function readMenuPreferences(userId: string): MenuTargetPreferences {
  try {
    const value = localStorage.getItem(menuPreferencesKey(userId));
    if (!value) return EMPTY_PREFERENCES;
    const parsed = JSON.parse(value) as Partial<MenuTargetPreferences>;
    return {
      presets: Array.isArray(parsed.presets)
        ? parsed.presets.filter(
            (preset): preset is LocalMenuPreset =>
              typeof preset?.id === "string" &&
              typeof preset.name === "string" &&
              Array.isArray(preset.userIds),
          )
        : [],
      lastTargetIds: Array.isArray(parsed.lastTargetIds)
        ? parsed.lastTargetIds.filter((id): id is string => typeof id === "string")
        : [],
      lastPresetId:
        typeof parsed.lastPresetId === "string" ? parsed.lastPresetId : null,
      migratedLegacyPresets: parsed.migratedLegacyPresets === true,
    };
  } catch {
    return EMPTY_PREFERENCES;
  }
}

function writeMenuPreferences(userId: string, value: MenuTargetPreferences) {
  localStorage.setItem(menuPreferencesKey(userId), JSON.stringify(value));
}

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
        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent/50 py-2.5 text-[13px] font-semibold text-accent active:bg-accent/5"
      >
        <Plus size={16} /> メニューを追加
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
  const [storageUserId, setStorageUserId] = useState<string | null>(null);
  const [presets, setPresets] = useState<LocalMenuPreset[]>([]);
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
  const [status, setStatus] = useState<MenuStatus>(menu?.status ?? "draft");
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [selectedPresetName, setSelectedPresetName] = useState("");
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [presetEditOpen, setPresetEditOpen] = useState(false);
  const [confirmPresetDelete, setConfirmPresetDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = createClient();
      const today = new Date().toISOString().slice(0, 10);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const storedPreferences = user
        ? readMenuPreferences(user.id)
        : EMPTY_PREFERENCES;
      const [
        scheduleResult,
        memberResult,
        previousMenuResult,
        legacyPresetResult,
      ] = await Promise.all([
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
        user && !storedPreferences.migratedLegacyPresets
          ? supabase
              .from("practice_menus")
              .select("targets:practice_menu_targets!inner(user_id)")
              .eq("author_id", user.id)
              .is("target_block", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        user
          ? supabase
              .from("menu_target_presets")
              .select("id, name, user_ids")
              .eq("author_id", user.id)
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [] }),
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
        setStorageUserId(user.id);
        const preferences = storedPreferences;
        const validMemberIds = new Set(memberRows.map((member) => member.id));
        const legacyPresets = (
          (legacyPresetResult.data ?? []) as {
            id: string;
            name: string;
            user_ids: string[];
          }[]
        ).map((preset) => ({
          id: preset.id,
          name: preset.name,
          userIds: preset.user_ids,
        }));
        const sourcePresets =
          preferences.presets.length > 0 || preferences.migratedLegacyPresets
            ? preferences.presets
            : legacyPresets;
        const validPresets = sourcePresets.map((preset) => ({
          ...preset,
          userIds: preset.userIds.filter((id) => validMemberIds.has(id)),
        }));
        setPresets(validPresets);
        if (!preferences.migratedLegacyPresets) {
          writeMenuPreferences(user.id, {
            ...preferences,
            presets: validPresets,
            migratedLegacyPresets: true,
          });
        }

        if (!menu) {
          const previousMenuTargets = (
            (previousMenuResult.data?.targets ?? []) as { user_id: string }[]
          ).map((target) => target.user_id);
          const previousPreset = validPresets.find(
            (preset) => preset.id === preferences.lastPresetId,
          );
          const previousTargets = (
            previousPreset?.userIds ??
            (previousMenuTargets.length > 0
              ? previousMenuTargets
              : preferences.lastTargetIds)
          ).filter((id) => validMemberIds.has(id));
          // kind は初期値（直近の種類）で確定済みなので、ここでは対象者の
          // プリロードだけ行う（setKind で切り替えるとチラつくため呼ばない）。
          if (previousTargets.length > 0) {
            setTargetIds(previousTargets);
          }
          if (previousPreset) {
            setSelectedPreset(previousPreset.id);
            setSelectedPresetName(previousPreset.name);
          }
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [fixedScheduleId, menu]);

  function toggleTarget(userId: string) {
    setTargetIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  /** プリセットを読み込む（対象者・ブロック・メニュー本文をまとめて復元） */
  function loadPreset(preset: LocalMenuPreset) {
    setTargetIds(preset.userIds);
    if (preset.block) setTargetBlock(preset.block);
    if (preset.content) setContent(preset.content);
    setSelectedPreset(preset.id);
    setSelectedPresetName(preset.name);
    if (storageUserId) {
      const previous = readMenuPreferences(storageUserId);
      writeMenuPreferences(storageUserId, {
        ...previous,
        presets,
        lastTargetIds: preset.userIds,
        lastPresetId: preset.id,
      });
    }
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name || targetIds.length === 0 || !storageUserId) return;
    setError(null);
    const preset: LocalMenuPreset = {
      id: crypto.randomUUID(),
      name,
      userIds: targetIds,
      block: targetBlock,
      content: content.trim() || undefined,
    };
    const next = [...presets, preset];
    setPresets(next);
    setSelectedPreset(preset.id);
    setSelectedPresetName(preset.name);
    setPresetName("");
    const previous = readMenuPreferences(storageUserId);
    writeMenuPreferences(storageUserId, {
      ...previous,
      presets: next,
      lastPresetId: preset.id,
    });
  }

  /** 選択中プリセットを「現在の内容（対象者・ブロック・本文）」で上書き保存 */
  function updatePreset() {
    const name = selectedPresetName.trim();
    if (!storageUserId || !selectedPreset || !name || targetIds.length === 0) return;
    const next = presets.map((preset) =>
      preset.id === selectedPreset
        ? {
            ...preset,
            name,
            userIds: targetIds,
            block: targetBlock,
            content: content.trim() || undefined,
          }
        : preset,
    );
    setPresets(next);
    const previous = readMenuPreferences(storageUserId);
    writeMenuPreferences(storageUserId, {
      ...previous,
      presets: next,
      lastPresetId: selectedPreset,
      lastTargetIds: targetIds,
    });
  }

  function deletePreset() {
    if (!storageUserId || !selectedPreset) return;
    const next = presets.filter((preset) => preset.id !== selectedPreset);
    setPresets(next);
    setSelectedPreset("");
    setSelectedPresetName("");
    const previous = readMenuPreferences(storageUserId);
    writeMenuPreferences(storageUserId, {
      ...previous,
      presets: next,
      lastPresetId: null,
    });
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
      // 個別メニューにもブロックを持たせる（同ブロックの部員が閲覧できるように）
      menu_target_block: targetBlock,
      target_user_ids: kind === "people" ? targetIds : [],
      target_menu_id: menu?.id ?? null,
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
    if (!menu && storageUserId && kind === "people") {
      const previous = readMenuPreferences(storageUserId);
      const activePreset = presets.find((preset) => preset.id === selectedPreset);
      const presetStillMatches =
        activePreset &&
        activePreset.userIds.length === targetIds.length &&
        activePreset.userIds.every((id) => targetIds.includes(id));
      writeMenuPreferences(storageUserId, {
        ...previous,
        presets,
        lastTargetIds: targetIds,
        lastPresetId: presetStillMatches ? activePreset.id : null,
      });
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
          <div>
            <p className="section-label mb-1.5">プリセット</p>
            {presets.length > 0 ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPresetPickerOpen(true)}
                  className="flex h-11 min-w-0 flex-1 items-center justify-between rounded-xl border border-separator bg-card px-3 text-left text-base"
                >
                  <span className={cn("truncate", !selectedPreset && "text-muted")}>
                    {selectedPresetName || "プリセットを選択"}
                  </span>
                  <ChevronRight size={17} className="shrink-0 text-muted" />
                </button>
                {selectedPreset && (
                  <button
                    type="button"
                    onClick={() => setPresetEditOpen(true)}
                    aria-label="プリセットを編集"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-separator bg-card text-muted active:bg-bg"
                  >
                    <MoreHorizontal size={20} />
                  </button>
                )}
              </div>
            ) : (
              <p className="text-caption">
                保存済みのプリセットはありません。下で対象者を選んで保存できます。
              </p>
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
                <p className="text-micro mb-1">現在の対象者・ブロック・メニューをプリセット保存</p>
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
                disabled={!presetName.trim() || !storageUserId}
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
      <Sheet open={presetPickerOpen} onOpenChange={setPresetPickerOpen}>
        <SheetContent title="プリセットを選択" autoFocus={false}>
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto pb-2">
            <li>
              <button
                type="button"
                onClick={() => {
                  setSelectedPreset("");
                  setSelectedPresetName("");
                  setPresetPickerOpen(false);
                }}
                className="flex min-h-12 w-full items-center rounded-lg px-3 text-left text-[14px] text-muted active:bg-bg"
              >
                選択しない
              </button>
            </li>
            {presets.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  onClick={() => {
                    loadPreset(preset);
                    setPresetPickerOpen(false);
                  }}
                  className={cn(
                    "flex min-h-12 w-full items-center justify-between gap-2 rounded-lg px-3 text-left active:bg-bg",
                    selectedPreset === preset.id && "bg-accent/10",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">
                      {preset.name}
                    </span>
                    <span className="block text-micro text-muted2">
                      {preset.userIds.length}人{preset.content ? "・メニュー付き" : ""}
                    </span>
                  </span>
                  {selectedPreset === preset.id && (
                    <Check size={18} className="shrink-0 text-accent" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>

      <Sheet open={presetEditOpen} onOpenChange={setPresetEditOpen}>
        <SheetContent title="プリセットを編集" autoFocus={false}>
          <div className="space-y-3 pb-2">
            <div>
              <p className="section-label mb-1.5">プリセット名</p>
              <Input
                value={selectedPresetName}
                onChange={(event) => setSelectedPresetName(event.target.value)}
                placeholder="プリセット名"
                maxLength={30}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!selectedPresetName.trim() || targetIds.length === 0}
              onClick={() => {
                updatePreset();
                setPresetEditOpen(false);
              }}
            >
              <Save size={16} />
              現在の内容で上書き
            </Button>
            <p className="text-micro">
              いまの対象者・ブロック・メニュー本文をこのプリセットに保存します。
            </p>
            <button
              type="button"
              onClick={() => setConfirmPresetDelete(true)}
              className="flex w-full items-center justify-center gap-1 rounded-xl border border-separator py-2.5 text-[14px] font-semibold text-danger active:bg-bg"
            >
              <Trash2 size={16} />
              このプリセットを削除
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmPresetDelete}
        onOpenChange={setConfirmPresetDelete}
        title="プリセットを削除しますか？"
        description="この端末に保存されたプリセットを削除します。"
        confirmLabel="削除する"
        onConfirm={() => {
          deletePreset();
          setConfirmPresetDelete(false);
          setPresetEditOpen(false);
        }}
      />
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
