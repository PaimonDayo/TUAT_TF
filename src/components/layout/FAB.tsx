"use client";

import { useState } from "react";
import { Plus, Activity, MessageCircle, Trophy, CalendarPlus, ClipboardList, Bell } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { FormModal } from "@/components/ui/form-modal";
import { RecordForm } from "@/components/post/RecordForm";
import { TweetForm } from "@/components/post/TweetForm";
import { ScheduleForm } from "@/components/post/ScheduleForm";
import { NoticeForm } from "@/components/post/NoticeForm";
import { MenuComposerForm } from "@/components/post/MenuForm";
import { ResultForm } from "@/components/post/ResultForm";

type Mode = "menu" | "pmenu";

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
  const [recordOpen, setRecordOpen] = useState(false);
  const [tweetOpen, setTweetOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  function openMenu() {
    setMode("menu");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    // アニメーション後にメニューへ戻す
    setTimeout(() => setMode("menu"), 250);
  }

  function openForm(setFormOpen: (open: boolean) => void) {
    setOpen(false);
    setMode("menu");
    setFormOpen(true);
  }

  const titles: Record<Mode, string | undefined> = {
    menu: undefined,
    pmenu: "練習メニューを追加",
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
                onClick={() => openForm(setRecordOpen)}
              />
              <PostOption
                icon={<MessageCircle size={22} />}
                color="#34c759"
                title="つぶやき"
                desc="ひとことシェア（200字まで）"
                onClick={() => openForm(setTweetOpen)}
              />
              <PostOption
                icon={<Trophy size={22} />}
                color="#ff9500"
                title="大会・記録会の結果"
                desc="PB・記録を登録"
                onClick={() => openForm(setResultOpen)}
              />
              {can.createSchedule && (
                <PostOption
                  icon={<CalendarPlus size={22} />}
                  color="#ff9500"
                  title="予定"
                  desc="練習・大会・記録会などの予定を作成"
                  onClick={() => openForm(setScheduleOpen)}
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
                  onClick={() => openForm(setNoticeOpen)}
                />
              )}
            </div>
          )}
          {mode === "pmenu" && <MenuComposerForm onDone={close} />}
        </SheetContent>
      </Sheet>

      <FormModal open={recordOpen} onOpenChange={setRecordOpen} title="練習記録">
        <RecordForm
          userId={userId}
          isMiddleLong={isMiddleLong}
          onDone={() => setRecordOpen(false)}
        />
      </FormModal>

      <FormModal open={tweetOpen} onOpenChange={setTweetOpen} title="つぶやき">
        <TweetForm onDone={() => setTweetOpen(false)} />
      </FormModal>

      <FormModal open={scheduleOpen} onOpenChange={setScheduleOpen} title="予定を作成">
        <ScheduleForm onDone={() => setScheduleOpen(false)} />
      </FormModal>

      <FormModal open={noticeOpen} onOpenChange={setNoticeOpen} title="お知らせを投稿">
        <NoticeForm onDone={() => setNoticeOpen(false)} />
      </FormModal>

      <FormModal
        open={resultOpen}
        onOpenChange={setResultOpen}
        title="大会・記録会の結果"
      >
        <ResultForm userId={userId} onDone={() => setResultOpen(false)} />
      </FormModal>
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
