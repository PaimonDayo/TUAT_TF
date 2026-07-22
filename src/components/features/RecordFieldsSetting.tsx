"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import {
  customRecordFields,
  editableBuiltinRecordFields,
  recordFieldHidden,
  recordFieldLabel,
  type BuiltinRecordFieldKey,
} from "@/lib/record-fields";
import { Button } from "@/components/ui/button";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { ReorderList } from "@/components/ui/reorder-list";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { RecordFieldDef } from "@/types";

type DraftField = RecordFieldDef & { id: string };
type LabelMap = Record<BuiltinRecordFieldKey, string>;

function initialLabels(fields: RecordFieldDef[], isMiddleLong: boolean): LabelMap {
  const labels = {} as LabelMap;
  for (const field of editableBuiltinRecordFields(isMiddleLong)) {
    labels[field.key] = recordFieldLabel(fields, field.key, field.label);
  }
  return labels;
}

function initialHiddenKeys(fields: RecordFieldDef[], isMiddleLong: boolean): BuiltinRecordFieldKey[] {
  return editableBuiltinRecordFields(isMiddleLong)
    .filter((field) => recordFieldHidden(fields, field.key))
    .map((field) => field.key);
}

export function RecordFieldsSetting({ profileId, initial, isMiddleLong }: { profileId: string; initial: RecordFieldDef[]; isMiddleLong: boolean }) {
  const router = useRouter();
  const builtins = editableBuiltinRecordFields(isMiddleLong);
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<LabelMap>(() => initialLabels(initial, isMiddleLong));
  const [hiddenKeys, setHiddenKeys] = useState<BuiltinRecordFieldKey[]>(() => initialHiddenKeys(initial, isMiddleLong));
  const [fields, setFields] = useState<DraftField[]>(() => toDraft(customRecordFields(initial)));
  const [reorderMode, setReorderMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<"text" | "number">("text");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const visibleBuiltins = builtins.filter((field) => !hiddenKeys.includes(field.key));
  const hiddenBuiltins = builtins.filter((field) => hiddenKeys.includes(field.key));

  function showEditor() {
    setLabels(initialLabels(initial, isMiddleLong));
    setHiddenKeys(initialHiddenKeys(initial, isMiddleLong));
    setFields(toDraft(customRecordFields(initial)));
    setReorderMode(false);
    setMessage(null);
    setOpen(true);
  }

  function resetToDefaults() {
    const defaults = initialLabels([], isMiddleLong);
    setLabels(defaults);
    setHiddenKeys([]);
    setFields([]);
    setReorderMode(false);
    setMessage("デフォルトに戻しました。保存すると反映されます");
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

  async function save() {
    const allLabels = [
      ...visibleBuiltins.map((field) => labels[field.key]?.trim()),
      ...fields.map((field) => field.label.trim()),
    ].filter(Boolean);
    if (new Set(allLabels).size !== allLabels.length) {
      setMessage("同じ名前の項目は複数作成できません");
      return;
    }
    if (visibleBuiltins.some((field) => !labels[field.key]?.trim())) {
      setMessage("項目名を入力してください");
      return;
    }

    setSaving(true);
    setMessage(null);
    const record_fields: RecordFieldDef[] = [
      ...builtins.map((field) => ({
        key: field.key,
        label: labels[field.key]?.trim() || field.label,
        type: field.type,
        hidden: hiddenKeys.includes(field.key),
      })),
      ...fields
        .filter((field) => field.label.trim())
        .map((field) => ({ key: field.key, label: field.label.trim(), type: field.type })),
    ];
    try {
      const result = await safeUpdate(createClient(), "profiles", { record_fields: recordFieldsToJson(record_fields) }, { id: profileId });
      if (!result.ok) {
        setMessage(safeUpdateMessage(result.reason));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error("[RecordFieldsSetting] save failed", error);
      setMessage("保存に失敗しました。もう一度お試しください");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button type="button" onClick={showEditor} className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3 text-left active:bg-bg">
      <SlidersHorizontal size={19} className="text-accent" />
      <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">記録フォームを編集</span><span className="block text-micro text-muted">項目名の変更・表示項目の整理・項目の追加</span></span>
    </button>

    <FormModal open={open} onOpenChange={setOpen} title="記録フォームを編集" autoFocus={false}>
      <div className="space-y-4 pb-5">
        <div className="rounded-xl bg-accent/8 px-3 py-2.5 text-caption leading-relaxed">各カードの「項目名」を直接変更できます。不要な項目は右上の×でフォームから外せます。中長距離の強度別距離と日付は集計のため固定です。</div>
        <LockedField label="日付"><Input type="date" disabled value="2026-07-15" readOnly /></LockedField>
        {isMiddleLong && <LockedField label="強度別距離（ランキング集計）"><div className="grid grid-cols-4 gap-1.5">{["低強度", "中強度", "高強度", "解糖系"].map((label) => <div key={label} className="rounded-lg border border-separator bg-bg p-2 text-center"><span className="block text-micro text-muted">{label}</span><span className="text-caption text-muted">0 km</span></div>)}</div></LockedField>}

        {visibleBuiltins.map((field) => <EditableBuiltinField
          key={field.key}
          label={labels[field.key]}
          onLabelChange={(label) => setLabels((current) => ({ ...current, [field.key]: label }))}
          onRemove={() => setHiddenKeys((current) => [...current, field.key])}
          type={field.type}
          isCondition={field.key === "condition"}
        />)}

        {hiddenBuiltins.length > 0 && <div className="rounded-2xl border border-dashed border-separator bg-bg/50 p-3">
          <p className="section-label mb-2">フォームから外した項目</p>
          <div className="flex flex-wrap gap-2">{hiddenBuiltins.map((field) => <button
            key={field.key}
            type="button"
            onClick={() => setHiddenKeys((current) => current.filter((key) => key !== field.key))}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-separator bg-card px-3 text-caption font-semibold text-accent active:bg-accent/10"
          ><RotateCcw size={14} />{labels[field.key] || field.label}を戻す</button>)}</div>
        </div>}

        {fields.length > 1 && <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => setReorderMode((current) => !current)}>
            <ArrowUpDown size={16} />{reorderMode ? "並び替えを完了" : "項目を並び替え"}
          </Button>
        </div>}
        <ReorderList items={fields} enabled={reorderMode} onReorder={setFields} renderItem={(field) => <div className="relative rounded-2xl border-2 border-accent/25 bg-card p-3 shadow-sm">
          <button type="button" onClick={() => setFields((current) => current.filter((item) => item.key !== field.key))} aria-label={`${field.label || "追加項目"}を削除`} className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-danger text-white shadow"><X size={15} strokeWidth={3} /></button>
          <p className="section-label mb-1.5">項目名（変更できます）</p>
          <Input aria-label="項目名" value={field.label} onChange={(event) => setFields((current) => current.map((item) => item.key === field.key ? { ...item, label: event.target.value } : item))} placeholder="項目名" maxLength={30} className="mb-2 h-10 font-semibold" />
          {field.type === "number" ? <Input disabled placeholder="0" /> : <Textarea disabled rows={2} placeholder="入力欄" />}
          <div className="mt-2 flex gap-2">{(["text", "number"] as const).map((type) => <button key={type} type="button" onClick={() => setFields((current) => current.map((item) => item.key === field.key ? { ...item, type } : item))} className={`rounded-full px-3 py-1 text-micro font-semibold ${field.type === type ? "bg-accent text-white" : "bg-bg text-muted"}`}>{type === "text" ? "文章" : "数値"}</button>)}</div>
        </div>} />

        <div className="flex justify-center">
          <Button type="button" size="sm" variant="outline" onClick={resetToDefaults} disabled={saving}>
            <RotateCcw size={16} />デフォルトに戻す
          </Button>
        </div>

        <button type="button" onClick={() => setAddOpen(true)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent/35 bg-accent/5 text-[14px] font-semibold text-accent active:bg-accent/10"><Plus size={19} />新しい入力項目を追加</button>
        {message && <p className="text-center text-caption text-danger">{message}</p>}
        <FormModalFooter><Button size="lg" onClick={save} disabled={saving}>{saving ? "保存中…" : "このフォームを保存"}</Button></FormModalFooter>
      </div>
    </FormModal>

    <Sheet open={addOpen} onOpenChange={setAddOpen}><SheetContent title="入力項目を追加" autoFocus={false}><div className="space-y-4 pb-2">
      <Input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="項目名（例：睡眠時間）" maxLength={30} />
      <div className="grid grid-cols-2 gap-2">{(["text", "number"] as const).map((type) => <button key={type} type="button" onClick={() => setNewType(type)} className={`h-12 rounded-xl border text-[14px] font-semibold ${newType === type ? "border-accent bg-accent/10 text-accent" : "border-separator bg-card"}`}>{type === "text" ? "文章入力" : "数値入力"}</button>)}</div>
      <Button size="lg" onClick={addField} disabled={!newLabel.trim()}>追加する</Button>
    </div></SheetContent></Sheet>
  </>;
}

function toDraft(fields: RecordFieldDef[]): DraftField[] { return fields.map((field) => ({ ...field, id: field.key })); }

function LockedField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="relative rounded-2xl border border-separator bg-card p-3"><div className="mb-1.5 flex items-center justify-between"><p className="section-label">{label}</p><span className="rounded-full bg-bg px-2 py-0.5 text-micro text-muted">固定</span></div>{children}</div>;
}

function EditableBuiltinField({ label, onLabelChange, onRemove, type, isCondition }: { label: string; onLabelChange: (label: string) => void; onRemove: () => void; type: "text" | "number"; isCondition: boolean }) {
  return <div className="relative rounded-2xl border border-separator bg-card p-3">
    <button type="button" onClick={onRemove} aria-label={`${label}をフォームから外す`} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-bg"><X size={17} /></button>
    <p className="section-label mb-1.5 pr-9">項目名（変更できます）</p>
    <Input aria-label="既定項目名" value={label} onChange={(event) => onLabelChange(event.target.value)} maxLength={30} className="mb-2 h-10 pr-10 font-semibold" />
    {type === "number" ? <Input disabled placeholder="0" /> : isCondition ? <div className="grid grid-cols-3 gap-2">{["良い", "普通", "悪い"].map((item) => <div key={item} className="flex h-12 items-center justify-center rounded-xl border border-separator text-caption text-muted">{item}</div>)}</div> : <Textarea disabled rows={2} placeholder="入力欄" />}
  </div>;
}
