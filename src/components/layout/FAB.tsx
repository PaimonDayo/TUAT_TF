"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BellPlus,
  CalendarPlus,
  FolderPlus,
  MessageCircle,
  MessagesSquare,
  NotebookPen,
  Plus,
  Trophy,
} from "lucide-react";
import { FormModal } from "@/components/ui/form-modal";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { MonthlyPlanningEditorV2, type MonthlyPlanningEditorHandle } from "@/components/features/MonthlyPlanningEditorV2";
import { NoteArticleEditor } from "@/components/features/NoteArticleEditor";
import { ThreadComposer } from "@/components/features/ThreadList";
import { NoteComposer } from "@/components/features/NoteComposer";
import { NoticeForm } from "@/components/post/NoticeForm";
import { RecordForm, type RecordFormHandle } from "@/components/post/RecordForm";
import { ResultForm, type ResultFormHandle } from "@/components/post/ResultForm";
import { ScheduleCreatePanel } from "@/components/post/ScheduleForm";
import { TweetForm, type TweetFormHandle } from "@/components/post/TweetForm";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { AuthorMini, RecordFieldDef } from "@/types";

export type FabPermissions = {
  createSchedule: boolean;
  createMenu: boolean;
  createNotice: boolean;
  manageMembers: boolean;
};

type DirectForm = "schedule" | "planning" | "notice" | "article" | "folder" | "subfolder" | "thread" | null;

type FabProps = {
  userId: string;
  currentUser: AuthorMini;
  isMiddleLong: boolean;
  recordSource: "app" | "sheet";
  recordFields: RecordFieldDef[];
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
      autoOpen={searchParams.get("compose") === "1"}
    />
  );
}

function ContextualFAB({
  userId,
  currentUser,
  isMiddleLong,
  recordSource,
  recordFields,
  can,
  pathname,
  autoOpen,
}: FabProps & {
  pathname: string;
  autoOpen: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [speedDialOpen, setSpeedDialOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [tweetOpen, setTweetOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const recordRef = useRef<RecordFormHandle>(null);
  const tweetRef = useRef<TweetFormHandle>(null);
  const resultRef = useRef<ResultFormHandle>(null);
  const [recordDirty, setRecordDirty] = useState(false);
  const [tweetDirty, setTweetDirty] = useState(false);
  const [resultDirty, setResultDirty] = useState(false);
  const [pendingTimelineClose, setPendingTimelineClose] = useState<"record" | "tweet" | "result" | null>(null);
  const planningRef = useRef<MonthlyPlanningEditorHandle>(null);
  const [planningDirty, setPlanningDirty] = useState(false);
  const [confirmPlanningClose, setConfirmPlanningClose] = useState(false);
  const [savingPlanning, setSavingPlanning] = useState(false);
  const [canEditArticles, setCanEditArticles] = useState(false);
  const [folderInfo, setFolderInfo] = useState<{
    scope: "shared" | "personal";
    depth: number;
    canManage: boolean;
  } | null>(null);
  const [directForm, setDirectForm] = useState<DirectForm>(() => {
    if (autoOpen && pathname === "/schedule" && (can.createSchedule || can.createMenu)) {
      return "planning";
    }
    if (autoOpen && pathname === "/notices" && can.createNotice) {
      return "notice";
    }
    return null;
  });

  const isFeed = pathname === "/home" || pathname === "/timeline";
  const isSchedule = pathname === "/schedule" && (can.createSchedule || can.createMenu);
  const isNotice = pathname === "/notices" && can.createNotice;
  const isNotesRoot = pathname === "/notes";
  const noteFolderMatch = pathname.match(/^\/notes\/([^/]+)$/);
  const noteId = noteFolderMatch?.[1] ?? null;
  const isNoteFolder = Boolean(noteId && canEditArticles);
  const visible = isFeed || isSchedule || isNotice || isNotesRoot || isNoteFolder;

  useEffect(() => {
    if (!noteId) return;
    let active = true;
    const supabase = createClient();
    void supabase
      .rpc("can_edit_note", { target_note_id: noteId })
      .then(({ data }) => {
        if (active) setCanEditArticles(data === true);
      });
    // サブフォルダ作成メニュー用: フォルダのscope・深さ（3階層まで）・管理可否
    void (async () => {
      const { data: folder } = await supabase
        .from("notes")
        .select("id, scope, parent_id, author_id")
        .eq("id", noteId)
        .maybeSingle();
      if (!active || !folder) return;
      let depth = 1;
      let parentId = (folder as { parent_id: string | null }).parent_id;
      while (parentId && depth < 3) {
        depth++;
        const { data: parent } = await supabase
          .from("notes")
          .select("parent_id")
          .eq("id", parentId)
          .maybeSingle();
        parentId = (parent as { parent_id: string | null } | null)?.parent_id ?? null;
      }
      if (!active) return;
      setFolderInfo({
        scope: (folder as { scope: "shared" | "personal" }).scope,
        depth,
        canManage:
          (folder as { author_id: string }).author_id === userId || can.manageMembers,
      });
    })();
    return () => {
      active = false;
    };
  }, [noteId, userId, can.manageMembers]);

  function handleMainAction() {
    if (isFeed) {
      setSpeedDialOpen((open) => !open);
      return;
    }
    if (isSchedule) setDirectForm("planning");
    if (isNotice) setDirectForm("notice");
    if (isNotesRoot) {
      setSpeedDialOpen((open) => !open);
      return;
    }
    if (isNoteFolder) {
      // サブフォルダを作れる立場なら2択メニュー、そうでなければ従来どおり記事作成へ直行
      if (isNoteFolder || (folderInfo?.canManage && folderInfo.depth < 3)) {
        setSpeedDialOpen((open) => !open);
      } else {
        setDirectForm("article");
      }
    }
  }

  function openFeedForm(setOpen: (open: boolean) => void) {
    setSpeedDialOpen(false);
    setOpen(true);
  }


  function closeTimelineForm(kind: "record" | "tweet" | "result") {
    if (kind === "record") { setRecordDirty(false); setRecordOpen(false); }
    if (kind === "tweet") { setTweetDirty(false); setTweetOpen(false); }
    if (kind === "result") { setResultDirty(false); setResultOpen(false); }
    setPendingTimelineClose(null);
  }

  function savePendingTimelineForm() {
    const kind = pendingTimelineClose;
    setPendingTimelineClose(null);
    if (kind === "record") recordRef.current?.save();
    if (kind === "tweet") tweetRef.current?.save();
    if (kind === "result") resultRef.current?.save();
  }

  function handlePlanningSaved() {
    closeDirectForm();
    void queryClient.invalidateQueries({ queryKey: ["schedule", userId] });
    void queryClient.invalidateQueries({ queryKey: ["middle-long-menu-csv", userId] });
  }

  function closeDirectForm() {
    setPlanningDirty(false);
    setConfirmPlanningClose(false);
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
        : isNotesRoot
          ? "作成メニューを開く"
          : "このフォルダに作成";

  return (
    <>
      {(isFeed || isNotesRoot || isNoteFolder) && speedDialOpen && (
        <button
          type="button"
          aria-label="作成メニューを閉じる"
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => setSpeedDialOpen(false)}
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto h-0 w-full max-w-md">
        {isFeed && speedDialOpen && (
          <div className="pointer-events-auto absolute right-5 bottom-[calc(142px+env(safe-area-inset-bottom))] w-[min(15rem,calc(100vw-2.5rem))] origin-bottom-right divide-y divide-separator/70 overflow-hidden rounded-2xl border border-separator bg-card shadow-xl">
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

        {isNotesRoot && speedDialOpen && (
          <div className="pointer-events-auto absolute right-5 bottom-[calc(142px+env(safe-area-inset-bottom))] w-[min(15rem,calc(100vw-2.5rem))] origin-bottom-right divide-y divide-separator/70 overflow-hidden rounded-2xl border border-separator bg-card shadow-xl">
            <SpeedDialAction
              icon={<FolderPlus size={19} />}
              label="フォルダを作成"
              onClick={() => {
                setSpeedDialOpen(false);
                setDirectForm("folder");
              }}
            />
            {false && (
            <SpeedDialAction
              icon={<MessagesSquare size={19} />}
              label="スレッドを立てる"
              onClick={() => {
                setSpeedDialOpen(false);
                setDirectForm("thread");
              }}
            />
            )}
          </div>
        )}

        {isNoteFolder && speedDialOpen && (
          <div className="pointer-events-auto absolute right-5 bottom-[calc(142px+env(safe-area-inset-bottom))] w-[min(15rem,calc(100vw-2.5rem))] origin-bottom-right divide-y divide-separator/70 overflow-hidden rounded-2xl border border-separator bg-card shadow-xl">
            <SpeedDialAction
              icon={<NotebookPen size={19} />}
              label="記事を作成"
              onClick={() => {
                setSpeedDialOpen(false);
                setDirectForm("article");
              }}
            />
            <SpeedDialAction
              icon={<FolderPlus size={19} />}
              label="サブフォルダを作成"
              onClick={() => {
                setSpeedDialOpen(false);
                setDirectForm("subfolder");
              }}
            />
            <SpeedDialAction
              icon={<MessagesSquare size={19} />}
              label={"\u30b9\u30ec\u30c3\u30c9\u3092\u7acb\u3066\u308b"}
              onClick={() => {
                setSpeedDialOpen(false);
                setDirectForm("thread");
              }}
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleMainAction}
          aria-label={label}
          aria-expanded={isFeed || isNotesRoot || isNoteFolder ? speedDialOpen : undefined}
          className="pointer-events-auto absolute right-5 bottom-[calc(74px+env(safe-area-inset-bottom))] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 active:opacity-[0.78] transition-active"
        >
          {isFeed || isNotesRoot || isNoteFolder ? (
            <Plus
              size={28}
              strokeWidth={2.5}
              className={cn(
                "transition-transform duration-200 motion-reduce:transition-none",
                speedDialOpen && "rotate-45",
              )}
            />
          ) : (
            <span key={pathname} className="flex">
              {isSchedule && <CalendarPlus size={25} />}
              {isNotice && <BellPlus size={25} />}
              {isNotesRoot && <FolderPlus size={25} />}
              {isNoteFolder && <NotebookPen size={25} />}
              {/* サブフォルダを作れる場合は上のPlus分岐が使われる */}
            </span>
          )}
        </button>
      </div>

      <FormModal open={recordOpen} onOpenChange={(open) => { if (!open) { if (recordDirty) setPendingTimelineClose("record"); else closeTimelineForm("record"); } }} title="練習記録">
        <RecordForm
          ref={recordRef}
          userId={userId}
          isMiddleLong={isMiddleLong}
          recordSource={recordSource}
          recordFields={recordFields}
          onDirtyChange={setRecordDirty}
          onDone={() => closeTimelineForm("record")}
        />
      </FormModal>

      <FormModal open={tweetOpen} onOpenChange={(open) => { if (!open) { if (tweetDirty) setPendingTimelineClose("tweet"); else closeTimelineForm("tweet"); } }} title={"\u3064\u3076\u3084\u304d"}>
        <TweetForm ref={tweetRef} onDirtyChange={setTweetDirty} onDone={() => closeTimelineForm("tweet")} />
      </FormModal>

      <FormModal
        open={resultOpen}
        onOpenChange={(open) => { if (!open) { if (resultDirty) setPendingTimelineClose("result"); else closeTimelineForm("result"); } }}
        title="大会・記録会の結果"
      >
        <ResultForm ref={resultRef} userId={userId} onDirtyChange={setResultDirty} onDone={() => closeTimelineForm("result")} />
      </FormModal>

      <UnsavedChangesDialog open={pendingTimelineClose !== null} busy={false} onContinue={() => setPendingTimelineClose(null)} onDiscard={() => { if (pendingTimelineClose) closeTimelineForm(pendingTimelineClose); }} onSave={savePendingTimelineForm} />

      <FormModal open={directForm === "planning"} onOpenChange={(open) => { if (!open) { if (planningDirty) setConfirmPlanningClose(true); else closeDirectForm(); } }} title="予定・メニューを月間入力">
        <MonthlyPlanningEditorV2 ref={planningRef} initialTab="schedule" canSchedule={can.createSchedule} canMenu={can.createMenu} onDirtyChange={setPlanningDirty} onSaved={handlePlanningSaved} />
      </FormModal>
      <UnsavedChangesDialog open={confirmPlanningClose} busy={savingPlanning} onContinue={() => setConfirmPlanningClose(false)} onDiscard={closeDirectForm} onSave={() => { setSavingPlanning(true); void planningRef.current?.save().then((ok) => { setSavingPlanning(false); if (ok) handlePlanningSaved(); }); }} />

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
        open={directForm === "folder"}
        onOpenChange={(open) => !open && closeDirectForm()}
        title="ノートフォルダを作成"
      >
        <NoteComposer
          currentUser={currentUser}
          isAdmin={can.manageMembers}
          onDone={closeDirectForm}
        />
      </FormModal>

      <FormModal
        open={directForm === "thread"}
        onOpenChange={(open) => !open && closeDirectForm()}
        title="スレッドを立てる"
      >
        {noteId && <ThreadComposer userId={userId} folderId={noteId} onDone={closeDirectForm} />}
      </FormModal>

      <FormModal
        open={directForm === "subfolder"}
        onOpenChange={(open) => !open && closeDirectForm()}
        title="サブフォルダを作成"
      >
        {noteId && folderInfo && (
          <NoteComposer
            currentUser={currentUser}
            isAdmin={can.manageMembers}
            initialScope={folderInfo.scope}
            parentId={noteId}
            onDone={closeDirectForm}
          />
        )}
      </FormModal>

      <FormModal
        open={directForm === "article"}
        onOpenChange={(open) => !open && closeDirectForm()}
        title="記事を作成"
      >
        {noteId && (
          <NoteArticleEditor
            noteId={noteId}
            currentUser={currentUser}
            onDone={closeDirectForm}
          />
        )}
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
      className="flex w-full items-center gap-3 whitespace-nowrap px-4 py-3 text-left text-[14px] font-semibold text-ink active:bg-bg"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        {icon}
      </span>
      {label}
    </button>
  );
}
