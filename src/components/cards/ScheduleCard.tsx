"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import {
  Clock,
  MapPin,
  ChevronDown,
  Train,
  CalendarRange,
  ExternalLink,
  Info,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionMenu } from "@/components/ui/action-menu";
import { Disclosure } from "@/components/ui/disclosure";
import { KeyValue } from "@/components/ui/key-value";
import { useToast } from "@/components/ui/toast";
import { SCHEDULE_TYPES, ATTENDANCE_TYPES } from "@/lib/constants";
import { BLOCKS, BLOCK_ORDER } from "@/lib/constants";
import { venueShort } from "@/lib/venues";
import { cn } from "@/lib/utils";
import { MenuEditModal, MenuForm } from "@/components/post/MenuForm";
import { ScheduleManageActions } from "@/components/post/ScheduleForm";
import { AttendanceToggle } from "@/components/features/AttendanceToggle";
import { AttendeesButton } from "@/components/features/AttendeesButton";
import { Linkify } from "@/components/common/Linkify";
import { createClient } from "@/lib/supabase/client";
import type {
  ScheduleWithMenus,
  Attendee,
  AttendanceStatusOrNone,
  Block,
  PracticeMenu,
} from "@/types";

/** 展開式の練習予定カード */
export function ScheduleCard({
  schedule,
  viewerBlocks = [],
  canEditMenu = false,
  canManageAllMenus = false,
  canManage = false,
  userId,
  myStatus = "none",
  attendees = [],
  defaultOpen = false,
}: {
  schedule: ScheduleWithMenus;
  viewerBlocks?: Block[];
  canEditMenu?: boolean;
  canManageAllMenus?: boolean;
  canManage?: boolean;
  userId?: string;
  myStatus?: AttendanceStatusOrNone;
  attendees?: Attendee[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const cardRef = useRef<HTMLDivElement>(null);

  // ホームの「予定」からタップで来たときは、対象カードまでスクロールする
  useEffect(() => {
    if (defaultOpen) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [defaultOpen]);
  const meta = SCHEDULE_TYPES[schedule.schedule_type];
  const date = new Date(schedule.schedule_date + "T00:00:00");
  const hasMenus = schedule.menus && schedule.menus.length > 0;
  // 並び順は作成日時に依存させない（練習日ごとに入力順が違うと毎回バラつくため）。
  // ブロック全体メニュー→個別メニュー、個別は対象者名の固定順で安定化する。
  const sortedMenus = [...(schedule.menus ?? [])].sort(menuCompare);
  // 所属ブロックごとにメニューをグループ化（自分のブロックを先頭に、全体向けは最後）
  const menusByBlock = new Map<Block, PracticeMenu[]>();
  const generalMenus: PracticeMenu[] = [];
  for (const m of sortedMenus) {
    if (m.target_block) {
      const list = menusByBlock.get(m.target_block) ?? [];
      list.push(m);
      menusByBlock.set(m.target_block, list);
    } else {
      generalMenus.push(m);
    }
  }
  const blocksByRelevance = [...BLOCK_ORDER].sort(
    (a, b) =>
      Number(viewerBlocks.includes(b)) - Number(viewerBlocks.includes(a)),
  );
  const menuGroups: { block: Block | null; menus: PracticeMenu[] }[] = [];
  for (const block of blocksByRelevance) {
    const list = menusByBlock.get(block);
    if (list && list.length > 0) menuGroups.push({ block, menus: list });
  }
  if (generalMenus.length > 0) menuGroups.push({ block: null, menus: generalMenus });
  const showAttendance = userId && ATTENDANCE_TYPES.includes(schedule.schedule_type);
  const hasEntry = schedule.entry_start || schedule.entry_end;
  const hasDetail =
    schedule.venue_access ||
    schedule.venue_fee ||
    schedule.venue_url ||
    schedule.note ||
    hasEntry ||
    hasMenus ||
    canEditMenu ||
    canManage;

  return (
    <Card ref={cardRef} className="overflow-hidden scroll-mt-20">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="w-full p-4 flex items-center gap-3 text-left active:bg-bg"
      >
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="text-[11px]" style={{ color: meta.color }}>
            {format(date, "EEE", { locale: ja })}
          </span>
          <span className="text-2xl font-bold leading-tight tabular-nums">{format(date, "d")}</span>
          <span className="text-micro">{format(date, "M月", { locale: ja })}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge style={{ backgroundColor: meta.color + "1a", color: meta.color }}>{meta.label}</Badge>
            <span className="text-headline truncate">
              {schedule.title ?? venueShort(schedule.venue_name ?? schedule.location) ?? meta.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted2">
            {schedule.end_date && schedule.end_date !== schedule.schedule_date && (
              <span className="flex items-center gap-1">
                <CalendarRange size={13} />
                {format(date, "M/d", { locale: ja })} 〜{" "}
                {format(new Date(schedule.end_date + "T00:00:00"), "M/d", { locale: ja })}
              </span>
            )}
            {schedule.meeting_time && (
              <span className="flex items-center gap-1">
                <Clock size={13} /> {schedule.meeting_time.slice(0, 5)}
              </span>
            )}
            {/* タイトルがある予定（大会等）は場所も補足表示。練習はタイトル位置が場所なので省略 */}
            {schedule.title && (schedule.venue_name || schedule.location) && (
              <span className="flex items-center gap-1">
                <MapPin size={13} /> {venueShort(schedule.venue_name ?? schedule.location)}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {schedule.target_blocks.length === 0 ? (
              <span className="text-micro rounded-full bg-separator/70 px-2 py-0.5 text-muted2">
                全体
              </span>
            ) : (
              schedule.target_blocks.map((block) => (
                <span
                  key={block}
                  className="text-micro rounded-full px-2 py-0.5"
                  style={{ color: BLOCKS[block].color, backgroundColor: BLOCKS[block].bg }}
                >
                  {BLOCKS[block].short}
                </span>
              ))
            )}
          </div>
        </div>

        {hasDetail && (
          <ChevronDown
            size={18}
            className={cn("text-muted transition-transform shrink-0", open && "rotate-180")}
          />
        )}
      </button>

      {/* 出欠行 */}
      {showAttendance && (
        <div className="px-4 pb-3 -mt-1 flex items-center gap-2">
          <AttendanceToggle
            scheduleId={schedule.id}
            userId={userId!}
            initial={myStatus}
            refreshOnChange
          />
          <AttendeesButton attendees={attendees} />
        </div>
      )}

      {open && hasDetail && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-separator">
          {hasEntry && (
            <Detail
              icon={<CalendarRange size={14} />}
              label="エントリー期間"
              value={`${fmt(schedule.entry_start)} 〜 ${fmt(schedule.entry_end)}`}
            />
          )}
          {(schedule.venue_access || schedule.venue_fee) && (
            <Disclosure
              className="border-t-0"
              title={
                <span className="flex items-center gap-1.5">
                  <Train size={15} /> アクセス・参加費
                </span>
              }
            >
              <dl>
                <KeyValue label="アクセス" value={schedule.venue_access} />
                <KeyValue label="参加費" value={schedule.venue_fee} />
              </dl>
            </Disclosure>
          )}
          {schedule.note && (
            <Detail icon={<Info size={14} />} label="詳細情報" value={schedule.note} />
          )}
          {schedule.venue_url && (
            <a
              href={schedule.venue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] text-accent font-medium active:opacity-50"
            >
              <MapPin size={14} /> 地図を開く <ExternalLink size={12} className="opacity-50" />
            </a>
          )}

          {(hasMenus || canEditMenu) && (
            <div>
              <p className="section-label mb-1.5">練習メニュー</p>
              <div className="space-y-3">
                {menuGroups.map((group) => (
                  <div key={group.block ?? "general"} className="space-y-1.5">
                    <p
                      className="text-[11px] font-semibold"
                      style={{ color: group.block ? BLOCKS[group.block].color : "#8e8e93" }}
                    >
                      {group.block ? BLOCKS[group.block].label : "全体"}
                    </p>
                    <div className="space-y-2">
                      {group.menus.map((m) => (
                        <MenuCard
                          key={m.id}
                          menu={m}
                          scheduleId={schedule.id}
                          canManage={
                            canManageAllMenus || (!!userId && m.author?.id === userId)
                          }
                          isTargeted={
                            !!userId && (m.targets?.some((t) => t.user_id === userId) ?? false)
                          }
                          isMyBlock={
                            !!m.target_block && viewerBlocks.includes(m.target_block)
                          }
                          onChanged={() => router.refresh()}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {canEditMenu && <MenuForm scheduleId={schedule.id} />}
            </div>
          )}

          {canManage && (
            <div className="flex justify-end">
              <ScheduleManageActions schedule={schedule} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function MenuCard({
  menu,
  scheduleId,
  canManage,
  isTargeted = false,
  isMyBlock = false,
  onChanged,
}: {
  menu: PracticeMenu;
  scheduleId: string;
  canManage: boolean;
  isTargeted?: boolean;
  isMyBlock?: boolean;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const targetNames =
    menu.targets?.map((target) => target.profile?.display_name).filter(Boolean) ?? [];

  const [publishing, setPublishing] = useState(false);

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.from("practice_menus").delete().eq("id", menu.id);
    if (error) {
      showToast("練習メニューを削除できませんでした");
      return false;
    }
    onChanged();
    return true;
  }

  async function publish() {
    setPublishing(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("practice_menus")
      .update({ status: "published" })
      .eq("id", menu.id)
      .select("id");
    if (error || !data || data.length === 0) {
      setPublishing(false);
      showToast("公開できませんでした");
      return;
    }
    showToast("メニューを公開しました");
    onChanged();
  }

  const hasBadges = menu.status === "draft" || targetNames.length > 0;

  return (
    <div
      className={cn(
        "relative rounded-xl border p-3",
        isTargeted
          ? "border-accent/45 bg-accent/5" // 自分が対象の個別メニュー＝青系
          : isMyBlock
            ? "border-[#34c759]/45 bg-[#34c759]/8" // 自分の所属ブロック＝緑系
            : "border-transparent bg-bg",
      )}
    >
      {/* 操作メニューは右上に絶対配置（空のヘッダー行で余白が出ないように） */}
      {canManage && (
        <div className="absolute right-1.5 top-1.5">
          <ActionMenu
            onEdit={() => setEditing(true)}
            onDelete={remove}
            deleteTitle="練習メニューを削除しますか？"
            deleteDescription="削除したメニューは元に戻せません。"
            triggerLabel="練習メニューの操作"
          />
        </div>
      )}
      {hasBadges && (
        <div className={cn("mb-1 flex flex-wrap items-center gap-1.5", canManage && "pr-8")}>
          {menu.status === "draft" && (
            <span className="rounded border border-warning px-1.5 py-0.5 text-[10px] font-bold text-warning">
              下書き
            </span>
          )}
          {targetNames.length > 0 && (
            <span className="text-[11px] text-muted2">
              対象: {targetNames.join("、")}
            </span>
          )}
        </div>
      )}
      <p className={cn("text-[14px] whitespace-pre-wrap", canManage && !hasBadges && "pr-8")}>
        <Linkify text={menu.content} />
      </p>
      {canManage && menu.status === "draft" && (
        <button
          type="button"
          onClick={publish}
          disabled={publishing}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white active:opacity-80 disabled:opacity-50"
        >
          {publishing ? "公開中…" : "公開する"}
        </button>
      )}
      <MenuEditModal
        menu={menu}
        scheduleId={scheduleId}
        open={editing}
        onOpenChange={setEditing}
      />
    </div>
  );
}

/** メニューの安定した並び順（作成日時非依存）。全体メニュー→個別、個別は対象者名順、最後に本文 */
function menuTargetNames(m: PracticeMenu): string {
  return (m.targets?.map((t) => t.profile?.display_name).filter(Boolean) ?? [])
    .sort((a, b) => (a as string).localeCompare(b as string, "ja"))
    .join("、");
}

function menuCompare(a: PracticeMenu, b: PracticeMenu): number {
  const aNames = menuTargetNames(a);
  const bNames = menuTargetNames(b);
  // 対象者なし（ブロック全体）を先頭に
  const aHasTarget = aNames.length > 0 ? 1 : 0;
  const bHasTarget = bNames.length > 0 ? 1 : 0;
  if (aHasTarget !== bHasTarget) return aHasTarget - bHasTarget;
  if (aNames !== bNames) return aNames.localeCompare(bNames, "ja");
  return (a.content ?? "").localeCompare(b.content ?? "", "ja");
}

function fmt(d: string | null): string {
  if (!d) return "";
  return format(new Date(d + "T00:00:00"), "M/d", { locale: ja });
}

function Detail({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="section-label mb-0.5 flex items-center gap-1">
        {icon} {label}
      </p>
      <p className="text-[14px] whitespace-pre-wrap">
        <Linkify text={value} />
      </p>
    </div>
  );
}
