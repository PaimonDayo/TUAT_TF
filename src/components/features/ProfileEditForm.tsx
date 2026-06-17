"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/common/Avatar";
import { BLOCK_ORDER, BLOCKS, GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Block, Profile } from "@/types";

/** 名前・アバター・ブロック（複数可）・学年の編集フォーム（初回設定 / 後からの編集 共通） */
export function ProfileEditForm({
  profile,
  onDone,
  isSetup = false,
}: {
  profile: Pick<Profile, "id" | "display_name" | "blocks" | "grade" | "avatar_url">;
  onDone: () => void;
  isSetup?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(profile.display_name ?? "");
  const [blocks, setBlocks] = useState<Block[]>(profile.blocks ?? []);
  const [grade, setGrade] = useState<string | null>(profile.grade);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim() && blocks.length > 0 && grade;

  function toggleBlock(b: Block) {
    setBlocks((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));
  }

  async function save() {
    if (!valid) {
      setError("すべての項目を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name.trim(), blocks, grade, avatar_url: avatarUrl.trim() || null })
      .eq("id", profile.id);

    if (error) {
      setError("保存に失敗しました");
      setSaving(false);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-4 pb-4">
      {isSetup && (
        <p className="text-body text-muted">はじめまして！プロフィールを設定しましょう。</p>
      )}

      <div>
        <p className="section-label mb-1.5">名前</p>
        <Input
          placeholder="例: 山田 太郎"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
        />
      </div>

      <div>
        <p className="section-label mb-1.5">アイコン画像URL（任意）</p>
        <div className="flex items-center gap-3">
          <Avatar name={name || "?"} blocks={blocks} avatarUrl={avatarUrl.trim() || null} size="lg" />
          <div className="flex-1 min-w-0">
            <Input
              placeholder="https://… 画像のURL"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              inputMode="url"
            />
            <p className="text-micro mt-1">
              画像URLを貼ると円形（中央基準）で表示されます。空欄ならイニシャル表示。
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="section-label mb-1.5">ブロック（複数選択可）</p>
        <div className="grid grid-cols-2 gap-2">
          {BLOCK_ORDER.map((b) => {
            const meta = BLOCKS[b];
            const active = blocks.includes(b);
            return (
              <button
                key={b}
                type="button"
                onClick={() => toggleBlock(b)}
                className="h-11 rounded-xl border text-[14px] font-semibold transition-active active:scale-[0.98]"
                style={{
                  borderColor: active ? meta.color : "#e5e5ea",
                  backgroundColor: active ? meta.bg : "#fff",
                  color: active ? meta.color : "#8e8e93",
                }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="section-label mb-1.5">学年</p>
        <div className="grid grid-cols-4 gap-2">
          {GRADE_OPTIONS.map((g) => {
            const active = grade === g.value;
            return (
              <button
                key={g.value}
                type="button"
                onClick={() => setGrade(g.value)}
                className={cn(
                  "h-11 rounded-xl border text-[14px] font-semibold transition-active active:scale-[0.98]",
                  active
                    ? "border-accent bg-accent text-white"
                    : "border-separator bg-card text-muted",
                )}
              >
                {g.short}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={save} disabled={saving || !valid}>
        {saving ? "保存中…" : isSetup ? "はじめる" : "保存"}
      </Button>
    </div>
  );
}
