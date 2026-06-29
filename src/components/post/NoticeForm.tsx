"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import type { AppRole, Notice, NoticeCategory } from "@/types";

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
  const [notifyMembers, setNotifyMembers] = useState(initial?.notify_members ?? true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [targetRoleIds, setTargetRoleIds] = useState<string[]>(initial?.target_role_ids ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase
      .from("roles")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (active) setRoles((data ?? []) as AppRole[]);
      });
    return () => {
      active = false;
    };
  }, []);

  function toggleTargetRole(roleId: string) {
    setTargetRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
    );
  }

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
          notify_members: notifyMembers,
          target_role_ids: targetRoleIds,
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
      notify_members: notifyMembers,
      target_role_ids: targetRoleIds,
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
      {!editing && (
        <>
          <Toggle
            label="メンバーに通知する"
            description="オンにすると全員または選択したロールへ通知します"
            checked={notifyMembers}
            onChange={() => setNotifyMembers((v) => !v)}
          />
          {notifyMembers && (
            <div className="space-y-2 rounded-xl border border-separator bg-bg/40 p-3">
              <div>
                <p className="section-label">通知先</p>
                <p className="mt-0.5 text-micro text-muted">
                  複数選択できます。全員を選ぶとロール指定は解除されます。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTargetRoleIds([])}
                className={`min-h-10 w-full rounded-xl border px-3 text-left text-[14px] font-semibold ${
                  targetRoleIds.length === 0
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-separator bg-card"
                }`}
              >
                全員
              </button>
              {roles.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {roles.map((role) => {
                    const selected = targetRoleIds.includes(role.id);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => toggleTargetRole(role.id)}
                        className="min-h-10 rounded-xl border px-3 text-left text-[13px] font-semibold"
                        style={{
                          borderColor: selected ? role.color : "#e5e5ea",
                          color: selected ? role.color : undefined,
                          backgroundColor: selected ? `${role.color}12` : "#fff",
                        }}
                      >
                        {role.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving}>
          {saving ? "保存中…" : editing ? "更新する" : "投稿する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}
