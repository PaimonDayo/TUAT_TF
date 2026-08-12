"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { MEMBER_PREVIEW_COOKIE } from "@/lib/member-preview";

// 切り忘れても翌日には元へ戻るようにしておく。
const ONE_DAY = 86_400;

/**
 * システム管理者が一般部員の画面を確認するための切り替え。
 * プレビュー中は管理者向けの項目がすべて隠れるため、戻す導線だけは
 * 設定画面の先頭に必ず出す。
 */
export function MemberPreviewSetting({ previewing }: { previewing: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(previewing);

  function apply(next: boolean) {
    setOn(next);
    document.cookie = [
      MEMBER_PREVIEW_COOKIE + "=" + (next ? "1" : "0"),
      "path=/",
      "max-age=" + (next ? ONE_DAY : 0),
      "samesite=lax",
    ].join(";");
    router.refresh();
  }

  if (on) {
    return (
      <Card className="border-accent/40 bg-accent/10 p-4">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold text-accent">
          <Eye size={16} />
          一般部員の画面を表示中
        </p>
        <p className="mt-1 text-micro text-muted2">
          管理者向けの項目が隠れています。スクリーンショットを撮り終えたら元に戻してください。翌日には自動で戻ります。
        </p>
        <button
          type="button"
          onClick={() => apply(false)}
          className="mt-3 inline-flex min-h-9 items-center rounded-lg bg-accent px-3 text-[13px] font-semibold text-white active:opacity-80"
        >
          元の画面に戻す
        </button>
      </Card>
    );
  }

  return (
    <Toggle
      variant="row"
      label="一般部員の画面を表示"
      description="管理者向けの項目を隠して、一般部員から見えている画面を確認できます。権限そのものは変わりません。"
      checked={on}
      onChange={() => apply(true)}
    />
  );
}
