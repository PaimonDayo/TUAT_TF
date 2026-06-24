"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ChevronUp, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { Input } from "@/components/ui/input";
import type { RecordFieldDef } from "@/types";

/**
 * 記録フォームのカスタム項目（profiles.record_fields）を編集する設定UI。
 * 「設定」アコーディオン内で使う。スプシ連携する場合は項目名=スプシ列名にする。
 */
export function RecordFieldsSetting({
  profileId,
  initial,
}: {
  profileId: string;
  initial: RecordFieldDef[];
}) {
  const router = useRouter();
  const [fields, setFields] = useState<RecordFieldDef[]>(initial ?? []);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const add = () =>
    setFields((c) => [...c, { key: crypto.randomUUID(), label: "", type: "text" }]);
  const update = (key: string, patch: Partial<RecordFieldDef>) =>
    setFields((c) => c.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const remove = (key: string) => setFields((c) => c.filter((f) => f.key !== key));
  const move = (i: number, dir: -1 | 1) =>
    setFields((c) => {
      const n = [...c];
      const j = i + dir;
      if (j < 0 || j >= n.length) return c;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function save() {
    setSaving(true);
    setMsg(null);
    const supabase = createClient();
    const record_fields = fields
      .filter((f) => f.label.trim())
      .map((f) => ({
        key: f.key,
        label: f.label.trim(),
        type: f.type,
        sheetColumn: f.label.trim(), // 項目名＝スプシ列名
      }));
    const result = await safeUpdate(supabase, "profiles", { record_fields }, { id: profileId });
    if (!result.ok) {
      setMsg(safeUpdateMessage(result.reason));
      setSaving(false);
      return;
    }
    setMsg("保存しました");
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p className="section-label">記録フォームの項目</p>
      <p className="text-micro">
        記録フォームに項目を追加できます。スプシと同期したい場合は、
        <b>項目名をスプシの列名と完全に同じ</b>にしてください。
      </p>
      <div className="space-y-2">
        {fields.map((f, index) => (
          <div key={f.key} className="flex items-center gap-2">
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="上へ"
                className="text-muted active:text-accent disabled:opacity-30"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === fields.length - 1}
                aria-label="下へ"
                className="text-muted active:text-accent disabled:opacity-30"
              >
                <ChevronDown size={16} />
              </button>
            </div>
            <Input
              placeholder="項目名（スプシの列名と同じに）"
              value={f.label}
              onChange={(e) => update(f.key, { label: e.target.value })}
              maxLength={30}
            />
            <select
              value={f.type}
              onChange={(e) => update(f.key, { type: e.target.value as "text" | "number" })}
              className="h-11 shrink-0 rounded-lg border border-separator bg-card px-2 text-[16px]"
            >
              <option value="text">文字</option>
              <option value="number">数値</option>
            </select>
            <button
              type="button"
              onClick={() => remove(f.key)}
              aria-label="削除"
              className="shrink-0 rounded-full p-1.5 text-muted active:bg-bg"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-separator text-[14px] font-semibold text-muted active:bg-bg"
        >
          <Plus size={16} /> 項目を追加
        </button>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-10 rounded-lg bg-accent px-4 text-[14px] font-semibold text-white active:opacity-80 disabled:opacity-50"
        >
          {saving ? "保存中…" : "項目を保存"}
        </button>
        {msg && <span className="text-micro text-muted2">{msg}</span>}
      </div>
    </div>
  );
}
