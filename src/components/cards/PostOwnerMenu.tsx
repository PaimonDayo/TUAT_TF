"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal } from "@/components/ui/form-modal";
import { RecordForm, type RecordFormHandle } from "@/components/post/RecordForm";
import { TweetForm, type TweetFormHandle } from "@/components/post/TweetForm";
import { useToast } from "@/components/ui/toast";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { copyText } from "@/components/common/ShareButton";
import type { PracticeRecord, QuotedPost, RecordFieldDef } from "@/types";

type Quotable = Exclude<QuotedPost, { kind: "missing" }>;

/** 引用してつぶやく画面。引用は誰でもでき、引用先はあとから変えられない。 */
function QuoteComposer({
  quote,
  open,
  onClose,
}: {
  quote: Quotable;
  open: boolean;
  onClose: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const formRef = useRef<TweetFormHandle>(null);
  return (
    <>
      <FormModal
        open={open}
        onOpenChange={(next) => { if (!next) { if (dirty) setConfirmClose(true); else onClose(); } }}
        title="投稿を引用"
      >
        <TweetForm
          ref={formRef}
          quote={quote}
          onDirtyChange={setDirty}
          onDone={() => { setDirty(false); onClose(); }}
        />
      </FormModal>
      <UnsavedChangesDialog
        open={confirmClose}
        busy={false}
        intent="post"
        onContinue={() => setConfirmClose(false)}
        onDiscard={() => { setDirty(false); setConfirmClose(false); onClose(); }}
        onSave={() => { setConfirmClose(false); formRef.current?.save(); }}
      />
    </>
  );
}

/** 練習記録の共有メニュー。編集・削除は本人だけに表示する。 */
export function RecordOwnerMenu({
  record,
  isMiddleLong,
  recordSource = "app",
  recordFields,
  systemRecordForm = false,
  isOwner,
  quote,
}: {
  record: PracticeRecord;
  isMiddleLong: boolean;
  /** 記録のメイン。'sheet'ならスプシ由来(from_sheet)の記録も編集可（write-through） */
  recordSource?: "app" | "sheet";
  recordFields?: RecordFieldDef[];
  systemRecordForm?: boolean;
  isOwner: boolean;
  /** 引用用の見た目。カード側が持っている情報をそのまま渡す（渡さないと引用は出ない） */
  quote?: Quotable;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const formRef = useRef<RecordFormHandle>(null);
  // 記録のメインがアプリの部員は、スプシ由来(from_sheet)の記録はアプリ内では編集不可
  // （そちらは今もスプシ側が正）。メインがスプシの部員はどちらの記録も編集可（write-through）。
  const editable = recordSource === "sheet" || !record.from_sheet;

  async function copyLink() {
    try {
      await copyText(new URL(`/timeline/record/${record.id}`, window.location.origin).toString());
      showToast("共有リンクをコピーしました", "success");
    } catch {
      showToast("共有リンクをコピーできませんでした");
    }
  }

  async function remove() {
    const supabase = createClient();
    const { data, error } = await supabase.from("practice_records").delete().eq("id", record.id).select("id");
    if (error || !data || data.length !== 1) {
      showToast("練習記録を削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={isOwner && editable ? () => setEditOpen(true) : undefined}
        onQuote={quote ? () => setQuoteOpen(true) : undefined}
        onShare={copyLink}
        onDelete={isOwner && editable ? remove : undefined}
        deleteTitle="練習記録を削除しますか？"
        deleteDescription="削除した練習記録は元に戻せません。"
        triggerLabel="練習記録のメニュー"
        className="-mr-1"
      />
      <FormModal open={editOpen} onOpenChange={(open) => { if (!open) { if (dirty) setConfirmClose(true); else setEditOpen(false); } }} title="練習記録を編集">
        <RecordForm
          ref={formRef}
          onDirtyChange={setDirty}
          userId={record.user_id}
          isMiddleLong={isMiddleLong}
          record={record}
          recordSource={recordSource}
          recordFields={recordFields}
          systemRecordForm={systemRecordForm}
          onDone={() => { setDirty(false); setEditOpen(false); }}
        />
      </FormModal>
      <UnsavedChangesDialog open={confirmClose} busy={false} intent="update" onContinue={() => setConfirmClose(false)} onDiscard={() => { setDirty(false); setConfirmClose(false); setEditOpen(false); }} onSave={() => { setConfirmClose(false); formRef.current?.save(); }} />
      {quote && <QuoteComposer quote={quote} open={quoteOpen} onClose={() => setQuoteOpen(false)} />}
    </>
  );
}

/** つぶやきの共有メニュー。編集・削除は本人だけに表示する。 */
export function TweetOwnerMenu({
  tweet,
  isOwner,
  quote,
}: {
  tweet: { id: string; content: string; quoted?: QuotedPost };
  isOwner: boolean;
  /** 引用用の見た目。ストーリーは消えてしまうので渡さない＝引用できない */
  quote?: Quotable;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const formRef = useRef<TweetFormHandle>(null);

  async function copyLink() {
    try {
      await copyText(new URL(`/timeline/tweet/${tweet.id}`, window.location.origin).toString());
      showToast("共有リンクをコピーしました", "success");
    } catch {
      showToast("共有リンクをコピーできませんでした");
    }
  }

  async function remove() {
    const supabase = createClient();
    const { data, error } = await supabase.from("tweets").delete().eq("id", tweet.id).select("id");
    if (error || !data || data.length !== 1) {
      showToast("つぶやきを削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={isOwner ? () => setEditOpen(true) : undefined}
        onQuote={quote ? () => setQuoteOpen(true) : undefined}
        onShare={copyLink}
        onDelete={isOwner ? remove : undefined}
        deleteTitle="つぶやきを削除しますか？"
        deleteDescription="削除したつぶやきは元に戻せません。"
        triggerLabel="つぶやきのメニュー"
        className="-mr-1"
      />
      <FormModal open={editOpen} onOpenChange={(open) => { if (!open) { if (dirty) setConfirmClose(true); else setEditOpen(false); } }} title="つぶやきを編集">
        <TweetForm ref={formRef} tweet={tweet} onDirtyChange={setDirty} onDone={() => { setDirty(false); setEditOpen(false); }} />
      </FormModal>
      <UnsavedChangesDialog open={confirmClose} busy={false} intent="update" onContinue={() => setConfirmClose(false)} onDiscard={() => { setDirty(false); setConfirmClose(false); setEditOpen(false); }} onSave={() => { setConfirmClose(false); formRef.current?.save(); }} />
      {quote && <QuoteComposer quote={quote} open={quoteOpen} onClose={() => setQuoteOpen(false)} />}
    </>
  );
}
