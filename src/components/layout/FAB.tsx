"use client";

import { useState } from "react";
import { Plus, Activity, MessageCircle, Trophy, CalendarPlus, ClipboardList, Bell } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RecordForm } from "@/components/post/RecordForm";
import { TweetForm } from "@/components/post/TweetForm";
import { ScheduleForm } from "@/components/post/ScheduleForm";
import { NoticeForm } from "@/components/post/NoticeForm";
import { MenuComposerForm } from "@/components/post/MenuForm";
import { ResultForm } from "@/components/post/ResultForm";

type Mode = "menu" | "record" | "tweet" | "result" | "schedule" | "pmenu" | "notice";

export type FabPermissions = {
  createSchedule: boolean;
  createMenu: boolean;
  createNotice: boolean;
};

/** 右下のフローティング投稿ボタン。権限に応じて作成できる種別を出し分ける */
export function FAB({
  userId,
  isMiddleLong,
  can,
}: {
  userId: string;
  isMiddleLong: boolean;
  can: FabPermissions;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");

  function openMenu() {
    setMode("menu");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    // アニメーション後にメニューへ戻す
    setTimeout(() => setMode("menu"), 250);
  }

  const titles: Record<Mode, string | undefined> = {
    menu: undefined,
    record: "練習記録",
    tweet: "つぶやき",
    result: "大会・記録会の結果",
    schedule: "予定を作成",
    pmenu: "練習メニューを追加",
    notice: "お知らせを投稿",
  };

  return (
    <>
      <button
        onClick={openMenu}
        aria-label="投稿する"
        className="fixed z-40 right-5 bottom-[calc(74px+env(safe-area-inset-bottom))] h-14 w-14 rounded-full bg-accent text-white shadow-lg shadow-accent/30 flex items-center justify-center active:scale-95 transition-active"
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>

      <Sheet open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <SheetContent title={titles[mode]}>
          {mode === "menu" && (
            <div className="space-y-2 pb-4">
              <PostOption
                icon={<Activity size={22} />}
                color="#007aff"
                title="練習記録"
                desc="距離・タイム・補強を記録"
                onClick={() => setMode("record")}
              />
              <PostOption
                icon={<MessageCircle size={22} />}
                color="#34c759"
                title="つぶやき"
                desc="ひとことシェア（200字まで）"
                onClick={() => setMode("tweet")}
              />
              <PostOption
                icon={<Trophy size={22} />}
                color="#ff9500"
                title="大会・記録会の結果"
                desc="PB・記録を登録"
                onClick={() => setMode("result")}
              />
              {can.createSchedule && (
                <PostOption
                  icon={<CalendarPlus size={22} />}
                  color="#ff9500"
                  title="練習予定"
                  desc="練習・大会などの予定を作成"
                  onClick={() => setMode("schedule")}
                />
              )}
              {can.createMenu && (
                <PostOption
                  icon={<ClipboardList size={22} />}
                  color="#af52de"
                  title="練習メニュー"
                  desc="予定にメニューを追加"
                  onClick={() => setMode("pmenu")}
                />
              )}
              {can.createNotice && (
                <PostOption
                  icon={<Bell size={22} />}
                  color="#ff3b30"
                  title="お知らせ"
                  desc="部内へのお知らせを投稿"
                  onClick={() => setMode("notice")}
                />
              )}
            </div>
          )}
          {mode === "record" && (
            <RecordForm userId={userId} isMiddleLong={isMiddleLong} onDone={close} />
          )}
          {mode === "tweet" && <TweetForm onDone={close} />}
          {mode === "result" && <ResultForm userId={userId} onDone={() => close()} />}
          {mode === "schedule" && <ScheduleForm onDone={close} />}
          {mode === "pmenu" && <MenuComposerForm onDone={close} />}
          {mode === "notice" && <NoticeForm onDone={close} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function PostOption({
  icon,
  color,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl bg-card border border-separator p-3 active:bg-bg transition-active"
    >
      <span
        className="h-11 w-11 rounded-full flex items-center justify-center text-white shrink-0"
        style={{ backgroundColor: color }}
      >
        {icon}
      </span>
      <span className="text-left">
        <span className="block text-headline">{title}</span>
        <span className="block text-caption">{desc}</span>
      </span>
    </button>
  );
}
