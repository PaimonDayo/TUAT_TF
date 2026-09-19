"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

/**
 * 何をする画面から閉じようとしたのかで言葉を変える。
 *
 * 以前はどの画面でも「保存して閉じる」だったが、書きかけの投稿を閉じようとした
 * ときにまで「保存」と出るため、下書きとして取っておくのか、そのまま投稿される
 * のかが読み取れなかった（オーナー指摘 2026-09-19）。
 * 動詞は docs/WORDING-GUIDELINES.md §6-1（投稿する／更新する／保存する）に合わせる。
 */
export type UnsavedIntent = "post" | "update" | "save";

const COPY: Record<UnsavedIntent, { title: string; description: string; confirm: string; busy: string; discard: string }> = {
  post: {
    title: "投稿しますか？",
    description: "まだ投稿していない内容があります。投稿すると、みんなのタイムラインに出ます。",
    confirm: "投稿する",
    busy: "投稿中…",
    discard: "投稿せずに閉じる",
  },
  update: {
    title: "更新しますか？",
    description: "まだ更新していない変更があります。",
    confirm: "更新する",
    busy: "更新中…",
    discard: "更新せずに閉じる",
  },
  save: {
    title: "保存しますか？",
    description: "まだ保存していない入力があります。",
    confirm: "保存する",
    busy: "保存中…",
    discard: "保存せずに閉じる",
  },
};

export function UnsavedChangesDialog({
  open,
  busy,
  intent = "save",
  onContinue,
  onDiscard,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  intent?: UnsavedIntent;
  onContinue: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const copy = COPY[intent];
  return <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && onContinue()}>
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay fixed inset-0 z-[60] bg-black/30" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-card p-5 shadow-xl outline-none">
        <Dialog.Title className="text-title">{copy.title}</Dialog.Title>
        <Dialog.Description className="mt-2 text-[14px] text-muted2">{copy.description}</Dialog.Description>
        <div className="mt-5 space-y-2">
          <Button type="button" className="w-full" disabled={busy} onClick={onSave}>{busy ? copy.busy : copy.confirm}</Button>
          <Button type="button" variant="outline" className="w-full text-danger" disabled={busy} onClick={onDiscard}>{copy.discard}</Button>
          <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={onContinue}>編集を続ける</Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
