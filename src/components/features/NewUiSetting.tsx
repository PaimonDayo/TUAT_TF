"use client";

import { useState, useSyncExternalStore } from "react";
import { Toggle } from "@/components/ui/toggle";
import { readNewUiPreference, writeNewUiPreference, subscribeNewUiPreference } from "@/lib/new-ui";

export function NewUiSetting({ userId }: { userId: string }) {
  const enabled = useSyncExternalStore(subscribeNewUiPreference, () => readNewUiPreference(userId), () => false);
  const [error, setError] = useState(false);
  return (
    <div>
      <Toggle
        variant="row"
        label="新UI版を使う"
        description="この端末・このアカウントだけで試せます。オフにすると通常版に戻ります。"
        checked={enabled}
        onChange={() => setError(!writeNewUiPreference(userId, !enabled))}
      />
      <p className="px-4 pb-3 text-micro">
        設定・目標・大会を含む各画面の操作や表示を、ガラス風の新しいスタイルに切り替えます。
      </p>
      {error && <p role="alert" className="px-4 pb-3 text-[13px] text-danger">設定を保存できませんでした。ブラウザの保存設定を確認してください。</p>}
    </div>
  );
}
