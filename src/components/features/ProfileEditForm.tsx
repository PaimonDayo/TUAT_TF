"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearPersistedQueries } from "@/lib/client/query-persistence";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormModalFooter } from "@/components/ui/form-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/common/Avatar";
import { BLOCK_ORDER, BLOCKS, EVENTS_BY_BLOCK, GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Block, Profile } from "@/types";

/** 名前・アバター・ブロック（複数可）・学年の編集フォーム（初回設定 / 後からの編集 共通） */
export function ProfileEditForm({
  profile,
  onDone,
  isSetup = false,
}: {
  profile: Pick<
    Profile,
    | "id"
    | "display_name"
    | "blocks"
    | "events"
    | "grade"
    | "avatar_url"
    | "sheet_name"
    | "record_source"
  >;
  onDone: () => void;
  isSetup?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(profile.display_name ?? "");
  const [blocks, setBlocks] = useState<Block[]>(profile.blocks ?? []);
  const [events, setEvents] = useState<string[]>(profile.events ?? []);
  const [grade, setGrade] = useState<string | null>(profile.grade);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? "");
  const [sheetName, setSheetName] = useState<string>(profile.sheet_name ?? "");
  const [recordSource, setRecordSource] = useState<"app" | "sheet">(
    profile.record_source ?? "app",
  );
  const [sheetOptions, setSheetOptions] = useState<string[] | null>(null);
  const [sheetNameMissing, setSheetNameMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim() && blocks.length > 0 && grade;

  // スプシ連携用：部員シート名の候補を取得（失敗しても編集は続行できる）
  useEffect(() => {
    let active = true;
    fetch("/api/sheets/members")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { members?: { name: string }[] }) => {
        if (!active) return;
        const names = (data.members ?? []).map((m) => m.name);
        setSheetNameMissing(Boolean(profile.sheet_name && !names.includes(profile.sheet_name)));
        // 現在の保存値が候補に無くても選べるよう加えておく
        if (profile.sheet_name && !names.includes(profile.sheet_name)) {
          names.unshift(profile.sheet_name);
        }
        setSheetOptions(names);
      })
      .catch(() => active && setSheetOptions([]));
    return () => {
      active = false;
    };
  }, [profile.sheet_name]);

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await clearPersistedQueries();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  function toggleBlock(b: Block) {
    setBlocks((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));
  }

  function toggleEvent(ev: string) {
    setEvents((cur) => (cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]));
  }

  // 選択中ブロックに対応する種目だけ出す（重複排除・ブロック順）
  const eventOptions = BLOCK_ORDER.filter((b) => blocks.includes(b)).flatMap(
    (b) => EVENTS_BY_BLOCK[b],
  );

  async function save() {
    if (!valid) {
      setError("すべての項目を入力してください");
      return;
    }
    setSaving(true);
    setError(null);

    // 入力元を切り替える場合は、方向を固定する前に一度だけ両側を揃える
    // （2026-07-03のデータ消失インシデントの再発防止・オーナー確定 2026-07-04）。
    // 揃えに失敗したら切替自体を中止する。
    const switchingSource =
      sheetName.trim() && recordSource !== (profile.record_source ?? "app");
    if (switchingSource) {
      const response = await fetch("/api/sheets/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: recordSource === "sheet" ? "to_sheet" : "to_app",
        }),
      });
      const reconcileResult = await response.json();
      if (!response.ok || !reconcileResult.ok) {
        setError(
          reconcileResult.error ?? "入力元の切替前の同期に失敗しました。もう一度お試しください",
        );
        setSaving(false);
        return;
      }
    }

    const supabase = createClient();
    const result = await safeUpdate(
      supabase,
      "profiles",
      {
        display_name: name.trim(),
        blocks,
        // 選択ブロックに無い種目は保存しない（ブロックを外したら自動で外れる）
        events: events.filter((ev) => eventOptions.includes(ev)),
        grade,
        avatar_url: avatarUrl.trim() || null,
        sheet_name: sheetName.trim() || null,
        record_source: sheetName.trim() ? recordSource : "app",
      },
      { id: profile.id },
    );

    if (!result.ok) {
      setError(safeUpdateMessage(result.reason));
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
              読み込みに失敗した場合はイニシャル表示に戻ります（Googleドライブ等の共有リンクは直接画像を指すURLではないため読み込めません）。
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

      {eventOptions.length > 0 && (
        <div>
          <p className="section-label mb-1.5">専門種目（任意・複数可）</p>
          <div className="flex flex-wrap gap-2">
            {eventOptions.map((ev) => {
              const active = events.includes(ev);
              return (
                <button
                  key={ev}
                  type="button"
                  onClick={() => toggleEvent(ev)}
                  className={cn(
                    "h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-active active:scale-[0.97]",
                    active
                      ? "border-accent bg-accent text-white"
                      : "border-separator bg-card text-muted",
                  )}
                >
                  {ev}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      {/* スプレッドシート連携：自分のシートを選ぶ（練習記録の同期に使う）。
          候補取得中も欄自体は出しておき、後から急に現れる遅延を無くす。 */}
      {(sheetOptions === null || sheetOptions.length > 0) && (
        <div>
          <p className="section-label mb-1.5">スプレッドシートの自分のシート（任意）</p>
          {sheetOptions === null ? (
            <Skeleton className="h-11 w-full" />
          ) : (
            <select
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              className="h-11 w-full rounded-xl border border-separator bg-card px-3 text-[16px] text-ink"
            >
              <option value="">（連携しない）</option>
              {sheetOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          <p className="text-micro mt-1">
            選ぶと、そのシートと練習記録が1時間ごとに自動で同期されます。
          </p>
        </div>
      )}

      {sheetNameMissing && (
        <p className="-mt-3 text-micro text-danger">現在選ばれているシートが見つかりません。正しいシートを選び直してください。</p>
      )}

      {sheetName.trim() && (
        <div>
          <p className="section-label mb-1.5">記録の入力元</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "app", label: "アプリ" },
                { value: "sheet", label: "スプレッドシート" },
              ] as const
            ).map((option) => {
              const active = recordSource === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRecordSource(option.value)}
                  className={cn(
                    "h-11 rounded-xl border text-[14px] font-semibold transition-active active:scale-[0.98]",
                    active
                      ? "border-accent bg-accent text-white"
                      : "border-separator bg-card text-muted",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="text-micro mt-1">
            {recordSource === "sheet"
              ? "スプレッドシートが正になります。アプリからも入力でき、保存すると即座にスプシへ反映されます（スプシの既存内容は上書きされます）。"
              : "アプリが正となり、記録はスプレッドシートへ自動で書き戻されます。"}
          </p>
        </div>
      )}

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <FormModalFooter>
        <Button size="lg" onClick={save} disabled={saving || !valid}>
          {saving ? "保存中…" : isSetup ? "はじめる" : "保存する"}
        </Button>
      </FormModalFooter>

      {!isSetup && (
        <button
          onClick={() => setConfirmSignOut(true)}
          disabled={signingOut}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-separator text-[15px] font-semibold text-danger active:bg-bg"
        >
          <LogOut size={18} />
          ログアウト
        </button>
      )}

      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="ログアウトしますか？"
        description="次に使うときは再度ログインが必要になります。"
        confirmLabel="ログアウト"
        busyLabel="ログアウト中…"
        busy={signingOut}
        onConfirm={signOut}
      />
    </div>
  );
}
