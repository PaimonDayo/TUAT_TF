"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { Button } from "@/components/ui/button";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { ReorderList } from "@/components/ui/reorder-list";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { RecordFieldDef } from "@/types";

type DraftField = RecordFieldDef & { id: string };

/** 実際の記録フォームを見ながら追加項目を編集する全画面エディタ。 */
export function RecordFieldsSetting({
  profileId,
  initial,
  isMiddleLong,
}: {
  profileId: string;
  initial: RecordFieldDef[];
  isMiddleLong: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<DraftField[]>(() => toDraft(initial));
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<"text" | "number">("text");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function showEditor() {
    setFields(toDraft(initial));
    setMessage(null);
    setOpen(true);
  }

  function addField() {
    const label = newLabel.trim();
    if (!label) return;
    const key = crypto.randomUUID();
    setFields((current) => [...current, { id: key, key, label, type: newType }]);
    setNewLabel("");
    setNewType("text");
    setAddOpen(false);
  }

  function updateField(key: string, patch: Partial<RecordFieldDef>) {
    setFields((current) =>
      current.map((field) => (field.key === key ? { ...field, ...patch } : field)),
    );
  }

  async function save() {
    const labels = fields.map((field) => field.label.trim()).filter(Boolean);
    if (new Set(labels).size !== labels.length) {
      setMessage("同じ名前の項目は複数作成できません");
      return;
    }

    setSaving(true);
    setMessage(null);
    const record_fields: RecordFieldDef[] = fields
      .filter((field) => field.label.trim())
      .map((field) => ({
        key: field.key,
        label: field.label.trim(),
        type: field.type,
      }));
    const result = await safeUpdate(
      createClient(),
      "profiles",
      { record_fields },
      { id: profileId },
    );
    setSaving(false);
    if (!result.ok) {
      setMessage(safeUpdateMessage(result.reason));
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={showEditor}
        className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3 text-left active:bg-bg"
      >
        <SlidersHorizontal size={19} className="text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">記録フォームを編集</span>
          <span className="block text-micro text-muted">
            項目の追加・名前変更・並べ替え
          </span>
        </span>
      </button>

      <FormModal
        open={open}
        onOpenChange={setOpen}
        title="記録フォームを編集"
        autoFocus={false}
      >
        <div className="space-y-4 pb-5">
          <div className="rounded-xl bg-accent/8 px-3 py-2.5 text-caption leading-relaxed">
            追加した項目はドラッグして並べ替えられます。項目名がスプレッドシートの列名と一致した場合だけ同期されます。
          </div>

          <LockedField label="日付">
            <Input type="date" disabled value="2026-06-29" readOnly />
          </LockedField>

          {isMiddleLong ? (
            <>
              <LockedField label="強度別距離">
                <div className="grid grid-cols-4 gap-1.5">
                  {["低強度", "中強度", "高強度", "解糖系"].map((label) => (
                    <div key={label} className="rounded-lg border border-separator bg-bg p-2 text-center">
                      <span className="block text-micro text-muted">{label}</span>
                      <span className="text-caption text-muted">0 km</span>
                    </div>
                  ))}
                </div>
              </LockedField>
              <LockedTextArea label="結果・タイム" />
              <LockedTextArea label="補強" />
            </>
          ) : (
            <>
              <LockedTextArea label="メニュー" />
              <LockedTextArea label="目的・意識すること" />
              <LockedTextArea label="タイム" />
            </>
          )}

          <LockedTextArea label="感想・振り返り" />

          <ReorderList
            items={fields}
            enabled
            onReorder={setFields}
            renderItem={(field) => (
              <div className="relative rounded-2xl border-2 border-accent/25 bg-card p-3 shadow-sm">
                <button
                  type="button"
                  onClick={() =>
                    setFields((current) => current.filter((item) => item.key !== field.key))
                  }
                  aria-label={`${field.label || "追加項目"}を削除`}
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-danger text-white shadow"
                >
                  <X size={15} strokeWidth={3} />
                </button>
                <Input
                  aria-label="項目名"
                  value={field.label}
                  onChange={(event) => updateField(field.key, { label: event.target.value })}
                  placeholder="項目名"
                  maxLength={30}
                  className="mb-2 h-9 border-0 bg-transparent px-0 text-[13px] font-semibold shadow-none focus-visible:ring-0"
                />
                {field.type === "number" ? (
                  <Input disabled placeholder="0" />
                ) : (
                  <Textarea disabled rows={2} placeholder="入力欄" />
                )}
                <div className="mt-2 flex gap-2">
                  {(["text", "number"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => updateField(field.key, { type })}
                      className={`rounded-full px-3 py-1 text-micro font-semibold ${
                        field.type === type
                          ? "bg-accent text-white"
                          : "bg-bg text-muted"
                      }`}
                    >
                      {type === "text" ? "文章" : "数値"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          />

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent/35 bg-accent/5 text-[14px] font-semibold text-accent active:bg-accent/10"
          >
            <Plus size={19} /> 新しい入力項目を追加
          </button>

          <LockedField label="コンディション">
            <div className="grid grid-cols-3 gap-2">
              {["良い", "普通", "悪い"].map((label) => (
                <div key={label} className="flex h-12 items-center justify-center rounded-xl border border-separator text-caption text-muted">
                  {label}
                </div>
              ))}
            </div>
          </LockedField>

          {message && <p className="text-center text-caption text-danger">{message}</p>}
          <FormModalFooter>
            <Button size="lg" onClick={save} disabled={saving}>
              {saving ? "保存中…" : "このフォームを保存"}
            </Button>
          </FormModalFooter>
        </div>
      </FormModal>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent title="入力項目を追加" autoFocus={false}>
          <div className="space-y-4 pb-2">
            <Input
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="項目名（例：睡眠時間）"
              maxLength={30}
            />
            <div className="grid grid-cols-2 gap-2">
              {(["text", "number"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setNewType(type)}
                  className={`h-12 rounded-xl border text-[14px] font-semibold ${
                    newType === type
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-separator bg-card"
                  }`}
                >
                  {type === "text" ? "文章入力" : "数値入力"}
                </button>
              ))}
            </div>
            <Button size="lg" onClick={addField} disabled={!newLabel.trim()}>
              追加する
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function toDraft(fields: RecordFieldDef[]): DraftField[] {
  return (fields ?? []).map((field) => ({ ...field, id: field.key }));
}

function LockedField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative rounded-2xl border border-separator bg-card p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="section-label">{label}</p>
        <span className="rounded-full bg-bg px-2 py-0.5 text-micro text-muted">固定</span>
      </div>
      {children}
    </div>
  );
}

function LockedTextArea({ label }: { label: string }) {
  return (
    <LockedField label={label}>
      <Textarea disabled rows={2} placeholder="入力欄" />
    </LockedField>
  );
}
