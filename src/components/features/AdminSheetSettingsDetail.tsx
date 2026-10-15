"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { AdminSheetSetupEditor, type AdminSheetSetup } from "@/components/features/AdminSheetSetupEditor";
import { gradeShort } from "@/lib/constants";
import type { MemberSheetSettingsDetail, SheetSettingsPeriod } from "@/lib/queries";
import { isFixedSheetColumn } from "@/lib/sheet-field-config";
import { SHEET_INPUT_MODE_LABELS, SHEET_LINK_STATUS_LABELS } from "@/lib/sheet-input-mode";
import type { RecordFieldDef } from "@/types";

export function AdminSheetSettingsDetail({ member }: { member: MemberSheetSettingsDetail }) {
  const router = useRouter();
  const [periodId, setPeriodId] = useState<SheetSettingsPeriod["id"]>("october");
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ base: MemberSheetSettingsDetail; setup: AdminSheetSetup } | null>(null);
  const originalPeriod = member.periods.find((value) => value.id === periodId)!;
  const period = originalPeriod.id === "october" && saved?.base === member ? {
    ...originalPeriod, fields: saved.setup.fields, mode: saved.setup.mode, sheet_name: saved.setup.sheetName,
    link_status: saved.setup.mode === "off" ? "off" as const : "linked" as const,
  } : originalPeriod;
  const fields = period.fields;
  const visibleFields = fields.filter((field) => !field.hidden);
  const timelineFields = visibleFields.filter((field) => field.showInTimeline === true);
  const hasTimelineConfig = fields.some((field) => typeof field.showInTimeline === "boolean");
  const isMiddleLong = member.blocks.includes("middle_long");
  return <div className="space-y-4 px-4 pb-6 pt-2">
    <Card className="flex items-center gap-3 p-3">
      <Avatar name={member.display_name || "?"} avatarUrl={member.avatar_url} blocks={member.blocks} size="sm" />
      <div className="min-w-0 flex-1"><h1 className="break-words text-[15px] font-semibold">{member.display_name || "名前未設定"}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2"><BlockPills blocks={member.blocks} /><span className="text-micro text-muted2">{gradeShort(member.grade)}{member.status === "graduated" ? "・卒業" : ""}</span></div>
      </div>
    </Card>
    <SegmentedControl items={[{ key: "october", label: "10月1日以降" }, { key: "legacy", label: "9月30日以前" }]} value={periodId} onChange={(value) => { setPeriodId(value === "legacy" ? "legacy" : "october"); }} />
    <section className="space-y-3" aria-label={period.label}>
      <h2 className="section-label">{period.label}</h2>
      <Card className="space-y-4 p-4">
        <dl className="space-y-4 text-caption">
          <div><dt className="text-muted2">連携状態</dt><dd className="mt-1">{SHEET_LINK_STATUS_LABELS[period.link_status]}</dd></div>
          <div><dt className="text-muted2">連携シート</dt><dd className="mt-1 break-words">{period.sheet_name || "未選択"}</dd></div>
          <div><dt className="text-muted2">入力方法</dt><dd className="mt-1">{period.mode ? SHEET_INPUT_MODE_LABELS[period.mode] : "この期間の設定は未確認です"}</dd></div>
          <div><dt className="text-muted2">入力フォームの項目</dt><dd className="mt-1"><FieldList fields={visibleFields} isMiddleLong={isMiddleLong} empty="保存された項目はありません" /></dd></div>
          <div><dt className="text-muted2">タイムラインに表示する項目</dt><dd className="mt-1">{hasTimelineConfig
            ? <FieldList fields={timelineFields} isMiddleLong={isMiddleLong} empty="表示する項目はありません" />
            : <span>{period.mode === null ? "この期間の設定は未確認です" : "標準の表示（保存済みの非表示設定を使用）"}</span>}</dd></div>
        </dl>
        {period.id === "october" ? <>
          <p className="text-micro text-muted2">変更は今後保存する記録に使われます。記録に保存済みの表示設定は維持されます。</p>
        </> : <p className="text-caption text-muted2">この期間の連携は終了しています。保存された設定を確認できます。</p>}
        <div hidden={period.id !== "october"}><AdminSheetSetupEditor memberId={member.id} memberName={member.display_name || "名前未設定"}
          onNotice={(message) => { setNotice(message); router.refresh(); }} onSaved={(setup) => { setSaved({ base: member, setup }); router.refresh(); }} /></div>
      </Card>
    </section>
    {notice && <p role="status" className="text-caption text-muted2">{notice}</p>}
  </div>;
}

function FieldList({ fields, isMiddleLong, empty }: { fields: RecordFieldDef[]; isMiddleLong: boolean; empty: string }) {
  if (fields.length === 0) return <span>{empty}</span>;
  return <ul className="flex flex-wrap gap-1.5">{fields.map((field, index) => <li key={`${field.key}-${index}`} className="max-w-full break-words rounded-lg bg-accent/8 px-2 py-1">
    {field.label}{field.sourceColumn !== undefined && isFixedSheetColumn(field.sourceHeader ?? field.label, isMiddleLong) && <span className="text-muted2">（標準）</span>}
  </li>)}</ul>;
}
