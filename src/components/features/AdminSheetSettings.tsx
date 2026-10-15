"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GRADE_OPTIONS } from "@/lib/constants";
import type { MemberSheetSettings } from "@/lib/queries";
import { isFixedSheetColumn } from "@/lib/sheet-field-config";
import { SHEET_INPUT_MODE_LABELS } from "@/lib/sheet-input-mode";
import type { RecordFieldDef } from "@/types";

export function AdminSheetSettings({ members }: { members: MemberSheetSettings[] }) {
  const [query, setQuery] = useState("");
  const keyword = query.trim().normalize("NFKC").toLocaleLowerCase("ja");
  const filtered = members.filter((member) => [member.display_name, member.sheet_name ?? ""]
    .some((value) => value.normalize("NFKC").toLocaleLowerCase("ja").includes(keyword)));
  const knownGrades = new Set(GRADE_OPTIONS.map((grade) => grade.value));
  const groups = [
    ...GRADE_OPTIONS.map((grade) => ({
      key: grade.value,
      label: grade.short,
      members: filtered.filter((member) => member.grade === grade.value),
    })),
    {
      key: "other",
      label: "その他・学年未設定",
      members: filtered.filter((member) => !member.grade || !knownGrades.has(member.grade)),
    },
  ].filter((group) => group.members.length > 0);

  return <div className="space-y-4 px-4 pb-6 pt-2">
    <p className="text-caption text-muted2">各部員が保存した現在の設定です。過去の記録は、保存時の設定で表示される場合があります。</p>
    <div className="relative">
      <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・シート名で検索" aria-label="名前・シート名で検索" className="pl-9" />
    </div>
    <p className="text-caption text-muted2" aria-live="polite"><span className="tabular-nums">{filtered.length} / {members.length}</span>人</p>
    {groups.map((group) => <section key={group.key} className="space-y-2" aria-label={group.label}>
      <h2 className="section-label">{group.label}<span className="ml-1.5 tabular-nums">{group.members.length}</span></h2>
      {group.members.map((member) => {
        const fields = member.record_fields.filter((field) => !field.hidden);
        const hasTimelineConfig = member.record_fields.some((field) => typeof field.showInTimeline === "boolean");
        const timelineFields = fields.filter((field) => field.showInTimeline === true);
        const isMiddleLong = member.blocks.includes("middle_long");
        return <Card key={member.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-[14px] font-semibold">{member.display_name || "名前未設定"}</h3>
            <BlockPills blocks={member.blocks} />
            {member.status === "graduated" && <span className="text-micro text-muted2">卒業</span>}
          </div>
          <dl className="space-y-3 text-caption">
            <div><dt className="text-muted2">連携シート</dt><dd className="mt-1 break-words">{member.sheet_name || "未選択"}</dd></div>
            <div><dt className="text-muted2">入力方法</dt><dd className="mt-1">{member.sheet_transition ? SHEET_INPUT_MODE_LABELS[member.sheet_transition.mode] : "10月以降の設定は未確認です"}</dd></div>
            <div><dt className="text-muted2">入力フォームの項目</dt><dd className="mt-1"><FieldList fields={fields} isMiddleLong={isMiddleLong} empty="保存された項目はありません" /></dd></div>
            <div><dt className="text-muted2">タイムラインに表示する項目</dt><dd className="mt-1">{hasTimelineConfig
              ? <FieldList fields={timelineFields} isMiddleLong={isMiddleLong} empty="表示する項目はありません" />
              : <span>標準の表示（保存済みの非表示設定を使用）</span>}</dd></div>
          </dl>
        </Card>;
      })}
    </section>)}
    {filtered.length === 0 && <p className="py-8 text-center text-caption text-muted2">{members.length === 0 ? "部員は登録されていません" : "該当する部員はいません"}</p>}
  </div>;
}

function FieldList({ fields, isMiddleLong, empty }: { fields: RecordFieldDef[]; isMiddleLong: boolean; empty: string }) {
  if (fields.length === 0) return <span>{empty}</span>;
  return <ul className="flex flex-wrap gap-1.5">
    {fields.map((field, index) => <li key={`${field.key}-${index}`} className="max-w-full break-words rounded-lg bg-accent/8 px-2 py-1">
      {field.label}
      {field.sourceColumn !== undefined && isFixedSheetColumn(field.sourceHeader ?? field.label, isMiddleLong) && <span className="text-muted2">（標準）</span>}
    </li>)}
  </ul>;
}
