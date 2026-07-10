"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import type { AppRole, AuthorMini, Notice, NoticeCategory } from "@/types";

export function NoticeForm({
  initial,
  onDone,
}: {
  initial?: Notice;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = !!initial;
  const [category, setCategory] = useState<NoticeCategory>(initial?.category ?? "info");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [pinHome, setPinHome] = useState(initial?.pin_home ?? false);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [members, setMembers] = useState<AuthorMini[]>([]);
  const [mentionedAll, setMentionedAll] = useState(
    initial?.mentioned_all ?? (initial ? initial.notify_members && initial.target_role_ids.length === 0 : true),
  );
  const [mentionedRoleIds, setMentionedRoleIds] = useState<string[]>(
    initial?.mentioned_role_ids ?? initial?.target_role_ids ?? [],
  );
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>(initial?.mentioned_user_ids ?? []);
  const [mentionQuery, setMentionQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void Promise.all([
      supabase.from("roles").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      supabase.from("profiles").select("id, display_name, avatar_url, blocks, grade").eq("status", "active").order("display_name"),
    ]).then(([roleResult, memberResult]) => {
      if (!active) return;
      setRoles((roleResult.data ?? []) as AppRole[]);
      setMembers((memberResult.data ?? []) as AuthorMini[]);
    });
    return () => {
      active = false;
    };
  }, []);

  const normalizedMentionQuery = mentionQuery.replace(/^@/, "").trim().toLocaleLowerCase("ja");
  const roleSuggestions = useMemo(
    () => roles.filter((role) => !mentionedRoleIds.includes(role.id) && role.name.toLocaleLowerCase("ja").includes(normalizedMentionQuery)),
    [roles, mentionedRoleIds, normalizedMentionQuery],
  );
  const memberSuggestions = useMemo(
    () => members.filter((member) => !mentionedUserIds.includes(member.id) && member.display_name.toLocaleLowerCase("ja").includes(normalizedMentionQuery)),
    [members, mentionedUserIds, normalizedMentionQuery],
  );
  const hasMentions = mentionedAll || mentionedRoleIds.length > 0 || mentionedUserIds.length > 0;

  async function submit() {
    if (!title.trim() || !content.trim()) {
      setError("タイトルと本文を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();

    if (editing) {
      const result = await safeUpdate(
        supabase,
        "notices",
        {
          category,
          title: title.trim(),
          content: content.trim(),
          deadline: deadline || null,
          pin_home: pinHome,
          notify_members: hasMentions,
          target_role_ids: mentionedRoleIds,
          mentioned_all: mentionedAll,
          mentioned_role_ids: mentionedRoleIds,
          mentioned_user_ids: mentionedUserIds,
        },
        { id: initial!.id },
      );
      if (!result.ok) {
        setError(safeUpdateMessage(result.reason));
        setSaving(false);
        return;
      }
      router.refresh();
      onDone();
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { error } = await supabase.from("notices").insert({
      author_id: user.id,
      category,
      title: title.trim(),
      content: content.trim(),
      deadline: deadline || null,
      pin_home: pinHome,
      notify_members: hasMentions,
      target_role_ids: mentionedRoleIds,
      mentioned_all: mentionedAll,
      mentioned_role_ids: mentionedRoleIds,
      mentioned_user_ids: mentionedUserIds,
    });
    if (error) {
      setError("投稿に失敗しました");
      setSaving(false);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <p className="section-label mb-1.5">カテゴリ</p>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(NOTICE_CATEGORIES) as NoticeCategory[]).map((c) => {
            const meta = NOTICE_CATEGORIES[c];
            const active = category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className="h-10 rounded-xl border text-[13px] font-semibold transition-active active:scale-95"
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
        <p className="section-label mb-1.5">タイトル</p>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
      </div>
      <div>
        <p className="section-label mb-1.5">本文</p>
        <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">締切（任意）</p>
        <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <p className="text-micro mt-1">締切を設定すると、その日を過ぎたらホームから自動で消えます</p>
      </div>
      <Toggle
        label="ホームに表示（重要なお知らせ）"
        checked={pinHome}
        onChange={() => setPinHome((v) => !v)}
      />
      <div className="space-y-2 rounded-xl border border-separator bg-bg/40 p-3">
        <div>
          <p className="section-label">通知先</p>
          <p className="mt-0.5 text-micro text-muted">@All、ロール名、部員名を追加できます。空なら通知しません。</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {mentionedAll && <MentionChip label="@All" onRemove={() => setMentionedAll(false)} />}
          {mentionedRoleIds.map((id) => <MentionChip key={id} label={`@${roles.find((role) => role.id === id)?.name ?? "ロール"}`} onRemove={() => setMentionedRoleIds((current) => current.filter((value) => value !== id))} />)}
          {mentionedUserIds.map((id) => <MentionChip key={id} label={`@${members.find((member) => member.id === id)?.display_name ?? "部員"}`} onRemove={() => setMentionedUserIds((current) => current.filter((value) => value !== id))} />)}
        </div>
        <Input value={mentionQuery} onChange={(event) => setMentionQuery(event.target.value)} placeholder="@通知先を検索" />
        {mentionQuery.trim() && (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-separator bg-card p-1">
            {!mentionedAll && "all".includes(normalizedMentionQuery) && <MentionOption label="@All（全員）" onClick={() => { setMentionedAll(true); setMentionQuery(""); }} />}
            {roleSuggestions.map((role) => <MentionOption key={role.id} label={`@${role.name}（ロール）`} onClick={() => { setMentionedRoleIds((current) => [...current, role.id]); setMentionQuery(""); }} />)}
            {memberSuggestions.slice(0, 20).map((member) => <MentionOption key={member.id} label={`@${member.display_name}`} onClick={() => { setMentionedUserIds((current) => [...current, member.id]); setMentionQuery(""); }} />)}
          </div>
        )}
      </div>
      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving}>
          {saving ? "保存中…" : editing ? "更新する" : "投稿する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}

function MentionChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <button type="button" onClick={onRemove} className="min-h-8 rounded-full bg-accent/10 px-2.5 text-[13px] font-semibold text-accent">{label} ×</button>;
}

function MentionOption({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-10 w-full rounded-lg px-3 text-left text-[14px] active:bg-bg">{label}</button>;
}
