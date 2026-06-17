"use client";

import { useState } from "react";
import { Plus, Activity, MessageCircle } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RecordForm } from "@/components/post/RecordForm";
import { TweetForm } from "@/components/post/TweetForm";
import type { Profile } from "@/types";

type Mode = "menu" | "record" | "tweet";

/** 右下のフローティング投稿ボタン。種別を選んでフォームを開く */
export function FAB({ profile }: { profile: Pick<Profile, "id" | "blocks" | "role"> }) {
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
  };

  return (
    <>
      <button
        onClick={openMenu}
        aria-label="投稿する"
        className="fixed z-40 right-5 bottom-[74px] h-14 w-14 rounded-full bg-accent text-white shadow-lg shadow-accent/30 flex items-center justify-center active:scale-95 transition-active"
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
            </div>
          )}
          {mode === "record" && (
            <RecordForm
              userId={profile.id}
              isMiddleLong={profile.blocks?.includes("middle_long") ?? false}
              onDone={close}
            />
          )}
          {mode === "tweet" && <TweetForm onDone={close} />}
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
