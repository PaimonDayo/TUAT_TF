"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  BellPlus,
  CalendarPlus,
  MessageCircle,
  NotebookPen,
  Plus,
  Trophy,
} from "lucide-react";
import { FormModal } from "@/components/ui/form-modal";
import { NoteComposer } from "@/components/features/NoteComposer";
import { NoticeForm } from "@/components/post/NoticeForm";
import { RecordForm } from "@/components/post/RecordForm";
import { ResultForm } from "@/components/post/ResultForm";
import { ScheduleCreatePanel } from "@/components/post/ScheduleForm";
import { TweetForm } from "@/components/post/TweetForm";
import { cn } from "@/lib/utils";
import type { AuthorMini } from "@/types";

export type FabPermissions = {
  createSchedule: boolean;
  createNotice: boolean;
  manageMembers: boolean;
};

type DirectForm = "schedule" | "notice" | "note" | null;

type FabProps = {
  userId: string;
  currentUser: AuthorMini;
  isMiddleLong: boolean;
  can: FabPermissions;
};

export function FAB(props: FabProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;

  return (
    <ContextualFAB
      key={routeKey}
      {...props}
      pathname={pathname}
      folderId={searchParams.get("folder")}
      autoOpen={searchParams.get("compose") === "1"}
    />
  );
}

function ContextualFAB({
  userId,
  currentUser,
  isMiddleLong,
  can,
  pathname,
  folderId: requestedFolderId,
  autoOpen,
}: FabProps & {
  pathname: string;
  folderId: string | null;
  autoOpen: boolean;
}) {
  const router = useRouter();
  const [speedDialOpen, setSpeedDialOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [tweetOpen, setTweetOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [directForm, setDirectForm] = useState<DirectForm>(() => {
    if (autoOpen && pathname === "/schedule" && can.createSchedule) {
      return "schedule";
    }
    if (autoOpen && pathname === "/notices" && can.createNotice) {
      return "notice";
    }
    return null;
  });

  const isFeed = pathname === "/home" || pathname === "/timeline";
  const isSchedule = pathname === "/schedule" && can.createSchedule;
  const isNotice = pathname === "/notices" && can.createNotice;
  const folderId =
    pathname === "/notes" && requestedFolderId !== "__unassigned__"
      ? requestedFolderId
      : null;
  const isNoteFolder = Boolean(folderId);
  const visible = isFeed || isSchedule || isNotice || isNoteFolder;

  function handleMainAction() {
    if (isFeed) {
      setSpeedDialOpen((open) => !open);
      return;
    }
    if (isSchedule) setDirectForm("schedule");
    if (isNotice) setDirectForm("notice");
    if (isNoteFolder) setDirectForm("note");
  }

  function openFeedForm(setOpen: (open: boolean) => void) {
    setSpeedDialOpen(false);
    setOpen(true);
  }

  function closeDirectForm() {
    setDirectForm(null);
    if (autoOpen) router.back();
  }

  if (!visible) return null;

  const label = isFeed
    ? speedDialOpen
      ? "作成メニューを閉じる"
      : "作成メニューを開く"
    : isSchedule
      ? "予定を作成"
      : isNotice
        ? "お知らせを作成"
        : "このフォルダにノートを作成";

  return (
    <>
      {isFeed && speedDialOpen && (
        <button
          type="button"
          aria-label="作成メニューを閉じる"
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => setSpeedDialOpen(false)}
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto h-0 w-full max-w-md">
        {isFeed && speedDialOpen && (
          <div className="pointer-events-auto absolute right-5 bottom-[calc(142px+env(safe-area-inset-bottom))] flex w-max flex-col items-end gap-2">
            <SpeedDialAction
              icon={<Activity size={19} />}
              label="練習記録"
              onClick={() => openFeedForm(setRecordOpen)}
            />
            <SpeedDialAction
              icon={<MessageCircle size={19} />}
              label="つぶやき"
              onClick={() => openFeedForm(setTweetOpen)}
            />
            <SpeedDialAction
              icon={<Trophy size={19} />}
              label="大会・記録会の結果"
              onClick={() => openFeedForm(setResultOpen)}
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleMainAction}
          aria-label={label}
          aria-expanded={isFeed ? speedDialOpen : undefined}
          className="pointer-events-auto absolute right-5 bottom-[calc(74px+env(safe-area-inset-bottom))] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 active:scale-95 transition-active"
        >
          {isFeed ? (
            <Plus
              size={28}
              strokeWidth={2.5}
              className={cn(
                "transition-transform duration-200 motion-reduce:transition-none",
                speedDialOpen && "rotate-45",
              )}
            />
          ) : (
            <span key={pathname} className="fab-icon-swap">
              {isSchedule && <CalendarPlus size={25} />}
              {isNotice && <BellPlus size={25} />}
              {isNoteFolder && <NotebookPen size={25} />}
            </span>
          )}
        </button>
      </div>

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

      <FormModal
        open={resultOpen}
        onOpenChange={setResultOpen}
        title="大会・記録会の結果"
      >
        <ResultForm userId={userId} onDone={() => setResultOpen(false)} />
      </FormModal>

      <FormModal
        open={directForm === "schedule"}
        onOpenChange={(open) => !open && closeDirectForm()}
        title="予定を作成"
      >
        <ScheduleCreatePanel onDone={closeDirectForm} />
      </FormModal>

      <FormModal
        open={directForm === "notice"}
        onOpenChange={(open) => !open && closeDirectForm()}
        title="お知らせを投稿"
      >
        <NoticeForm onDone={closeDirectForm} />
      </FormModal>

      <FormModal
        open={directForm === "note"}
        onOpenChange={(open) => !open && closeDirectForm()}
        title="ノートを作成"
      >
        <NoteComposer
          currentUser={currentUser}
          isAdmin={can.manageMembers}
          initialThemeId={folderId}
          onDone={closeDirectForm}
        />
      </FormModal>
    </>
  );
}

function SpeedDialAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-max items-center gap-2 whitespace-nowrap rounded-full border border-separator bg-card px-3.5 text-[14px] font-semibold text-ink shadow-lg active:bg-bg"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
        {icon}
      </span>
      {label}
    </button>
  );
}
