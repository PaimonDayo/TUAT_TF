"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";

const KEY = "tuat-ob-entry-prompt";
const DONE = "done";

/** アプリを開いたときにOB戦のエントリー確認を促す。「確認する」を押したらもう出さない。「あとで」はその日だけ出さない。 */
export function ObEntryPrompt({ hasEntry, today }: { hasEntry: boolean; today: string }) {
  // サーバー描画では出さず、端末の記録を読んでから判定する（保存できない端末では出さない）。
  const shownToday = useSyncExternalStore(() => () => {}, () => { try { const v = localStorage.getItem(KEY); return v === DONE || v === today; } catch { return true; } }, () => true);
  const [closed, setClosed] = useState(false);
  const open = !shownToday && !closed;
  function close(confirmed = false) {
    setClosed(true);
    try { localStorage.setItem(KEY, confirmed ? DONE : today); } catch { /* noop */ }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-[60] bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-card p-5 shadow-xl outline-none">
          <Dialog.Title className="text-title">OB戦のエントリーを確認してください</Dialog.Title>
          <Dialog.Description className="mt-2 text-[14px] text-muted2">
            {hasEntry ? "登録した種目・資格記録と懇親会の出欠に間違いがないか確認してください。" : "まだエントリーしていません。出場する種目と懇親会の出欠を登録してください。"}
          </Dialog.Description>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => close()}>あとで</Button>
            <Button asChild><Link href={`${OB_PROGRAM_PATH}?edit=mine`} onClick={() => close(true)}>{hasEntry ? "確認する" : "エントリーする"}</Link></Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
