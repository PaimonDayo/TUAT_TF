"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Plus, Activity, MessageCircle, Trophy, CalendarPlus, ClipboardList, Bell } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RecordForm } from "@/components/post/RecordForm";
import { TweetForm } from "@/components/post/TweetForm";
import { ScheduleForm } from "@/components/post/ScheduleForm";
import { NoticeForm } from "@/components/post/NoticeForm";
import { MenuComposerForm } from "@/components/post/MenuForm";
import { ResultForm } from "@/components/post/ResultForm";

type ActionKey = "record" | "tweet" | "result" | "schedule" | "pmenu" | "notice";

export type FabPermissions = {
  createSchedule: boolean;
  createMenu: boolean;
  createNotice: boolean;
};

const META: Record<ActionKey, { icon: React.ReactNode; color: string; title: string }> = {
  record: { icon: <Activity size={20} />, color: "#007aff", title: "練習記録" },
  tweet: { icon: <MessageCircle size={20} />, color: "#34c759", title: "つぶやき" },
  result: { icon: <Trophy size={20} />, color: "#ff9500", title: "大会・記録会の結果" },
  schedule: { icon: <CalendarPlus size={20} />, color: "#ff9500", title: "予定を作成" },
  pmenu: { icon: <ClipboardList size={20} />, color: "#af52de", title: "練習メニュー" },
  notice: { icon: <Bell size={20} />, color: "#ff3b30", title: "お知らせ" },
};

/**
 * 右下のフローティング投稿ボタン。
 * 現在のページに応じて入力項目を出し分け、+ が回転しながら上にメニューが
 * せり上がる（スピードダイヤル）。
 * - 練習予定ページ: 予定 / メニュー（権限に応じて）
 * - お知らせページ: お知らせ（権限に応じて）
 * - それ以外: 練習記録 / つぶやき / 大会・記録会の結果
 */
export function FAB({
  userId,
  isMiddleLong,
  can,
}: {
  userId: string;
  isMiddleLong: boolean;
  can: FabPermissions;
}) {
  const pathname = usePathname();
  const [dialOpen, setDialOpen] = useState(false);
  const [sheet, setSheet] = useState<ActionKey | null>(null);

  // ページ文脈に応じたアクション
  let keys: ActionKey[];
  if (pathname.startsWith("/schedule")) {
    keys = [];
    if (can.createSchedule) keys.push("schedule");
    if (can.createMenu) keys.push("pmenu");
  } else if (pathname.startsWith("/notices")) {
    keys = can.createNotice ? ["notice"] : [];
  } else {
    keys = ["record", "tweet", "result"];
  }

  if (keys.length === 0) return null;

  function openSheet(key: ActionKey) {
    setDialOpen(false);
    setSheet(key);
  }
  function close() {
    setSheet(null);
  }
  function onFabClick() {
    // アクションが1つだけならダイヤルを開かず直接フォームへ
    if (keys.length === 1) openSheet(keys[0]);
    else setDialOpen((v) => !v);
  }

  return (
    <>
      {/* ダイヤル展開中の背景タップで閉じる */}
      {dialOpen && (
        <div className="fixed inset-0 z-30" onClick={() => setDialOpen(false)} aria-hidden />
      )}

      <div className="fixed z-40 right-5 bottom-[calc(74px+env(safe-area-inset-bottom))]">
        {/* せり上がるアクション群（FAB の上に絶対配置） */}
        <div className="absolute bottom-full right-0 mb-3 flex flex-col items-end gap-3">
          {keys.map((key, i) => {
            const m = META[key];
            // 下にあるものから順に出る（FAB に近い方が先）
            const order = keys.length - 1 - i;
            return (
              <button
                key={key}
                onClick={() => openSheet(key)}
                className="flex items-center gap-2.5"
                style={{
                  transform: dialOpen ? "translateY(0) scale(1)" : "translateY(14px) scale(0.85)",
                  opacity: dialOpen ? 1 : 0,
                  pointerEvents: dialOpen ? "auto" : "none",
                  transition: "transform 0.2s cubic-bezier(0.32,0.72,0,1), opacity 0.18s ease-out",
                  transitionDelay: dialOpen ? `${order * 40}ms` : "0ms",
                }}
              >
                <span className="rounded-lg bg-card shadow-sm border border-separator px-2.5 py-1 text-[13px] font-semibold text-ink">
                  {m.title}
                </span>
                <span
                  className="h-11 w-11 rounded-full flex items-center justify-center text-white shadow-md shrink-0"
                  style={{ backgroundColor: m.color }}
                >
                  {m.icon}
                </span>
              </button>
            );
          })}
        </div>

        {/* メインの + ボタン（開くと45°回転して × に） */}
        <button
          onClick={onFabClick}
          aria-label="投稿する"
          className="h-14 w-14 rounded-full bg-accent text-white shadow-lg shadow-accent/30 flex items-center justify-center active:scale-95"
          style={{
            transform: dialOpen ? "rotate(45deg)" : "rotate(0deg)",
            transition: "transform 0.25s cubic-bezier(0.32,0.72,0,1)",
          }}
        >
          <Plus size={28} strokeWidth={2.5} />
        </button>
      </div>

      <Sheet open={sheet !== null} onOpenChange={(o) => (o ? null : close())}>
        <SheetContent title={sheet ? META[sheet].title : undefined}>
          {sheet === "record" && (
            <RecordForm userId={userId} isMiddleLong={isMiddleLong} onDone={close} />
          )}
          {sheet === "tweet" && <TweetForm onDone={close} />}
          {sheet === "result" && <ResultForm userId={userId} onDone={() => close()} />}
          {sheet === "schedule" && <ScheduleForm onDone={close} />}
          {sheet === "pmenu" && <MenuComposerForm onDone={close} />}
          {sheet === "notice" && <NoticeForm onDone={close} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
