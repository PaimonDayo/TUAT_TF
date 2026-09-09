"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  MEASURE_TYPE_LABEL,
  isMeasureType,
  type MeasureType,
} from "@/lib/competition-record";
import type { CompetitionEvent } from "@/lib/competition-goals";

const selectClass =
  "w-full rounded-xl border border-separator bg-card p-3 text-base";

/**
 * 種目マスタの管理（システム管理者のみ）。
 * 結果と目標はここに登録された種目から選ぶ。「その他」で入力された種目名は
 * 未登録として並び、マスタへ追加するか、登録済みの種目へまとめて統一できる。
 */
export function CompetitionEventManager({
  initial,
  unregistered,
}: {
  initial: CompetitionEvent[];
  /** 結果に入力されていてマスタに無い種目名と、その件数 */
  unregistered: { name: string; count: number }[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState(unregistered);
  const [editing, setEditing] = useState<CompetitionEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState<{ name: string; count: number } | null>(
    null,
  );
  const [mergeTo, setMergeTo] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove(event: CompetitionEvent) {
    const { error } = await createClient()
      .from("competition_events")
      .delete()
      .eq("name", event.name);
    if (error) {
      showToast("目標が登録されている種目は削除できません");
      return false;
    }
    setItems((old) => old.filter((e) => e.name !== event.name));
    router.refresh();
    return true;
  }

  async function addToCatalog(name: string) {
    setBusy(true);
    const { data, error } = await createClient()
      .from("competition_events")
      .insert({
        name,
        sort_order: Math.max(0, ...items.map((e) => e.sort_order)) + 10,
        measure_type: "time",
      })
      .select("name,sort_order,measure_type")
      .single();
    setBusy(false);
    if (error || !data) {
      showToast("種目を追加できませんでした");
      return;
    }
    setItems((old) => [...old, data as CompetitionEvent]);
    setPending((old) => old.filter((e) => e.name !== name));
    showToast("種目を追加しました。記録の測り方を確認してください", "success");
    router.refresh();
  }

  async function mergeInto(from: string, to: string) {
    setBusy(true);
    const { data, error } = await createClient()
      .from("pb_records")
      .update({ event_name: to })
      .eq("event_name", from)
      .select("id");
    setBusy(false);
    if (error || !data) {
      showToast("種目名をまとめられませんでした");
      return;
    }
    setPending((old) => old.filter((e) => e.name !== from));
    setMerging(null);
    setMergeTo("");
    showToast(`${data.length}件の記録を「${to}」に統一しました`, "success");
    router.refresh();
  }

  return (
    <>
      <p className="text-caption">
        ここに登録した種目が、結果と目標の選択肢になります。種目名を変えると、登録済みの結果と目標の表記もまとめて変わります。
      </p>

      {pending.length > 0 && (
        <section className="space-y-2">
          <p className="section-label">未登録の種目（その他で入力されたもの）</p>
          {pending.map((e) => (
            <Card key={e.name} className="space-y-2 p-3">
              <p className="text-headline break-words">
                {e.name}
                <span className="ml-1.5 text-caption">{e.count}件</span>
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void addToCatalog(e.name)}
                >
                  種目に追加
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || items.length === 0}
                  onClick={() => {
                    setMerging(e);
                    setMergeTo("");
                  }}
                >
                  既存の種目にまとめる
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <p className="section-label">登録済みの種目</p>
        {items.map((e) => (
          <Card key={e.name} className="p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-headline break-words">{e.name}</p>
                <p className="text-caption">
                  {MEASURE_TYPE_LABEL[
                    (isMeasureType(e.measure_type)
                      ? e.measure_type
                      : "time") as MeasureType
                  ]}
                  ・表示順 {e.sort_order}
                </p>
              </div>
              <ActionMenu
                onEdit={() => setEditing(e)}
                onDelete={() => remove(e)}
                deleteTitle={`「${e.name}」を削除しますか？`}
                deleteDescription="目標が登録されている種目は削除できません。"
                triggerLabel={`${e.name}のメニュー`}
              />
            </div>
          </Card>
        ))}
      </section>

      <Button
        variant="outline"
        size="lg"
        onClick={() => setCreating(true)}
        className="gap-2"
      >
        <Plus size={18} /> 種目を追加
      </Button>

      {(creating || editing) && (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          title={editing ? "種目を編集" : "種目を追加"}
        >
          <EventForm
            event={editing ?? undefined}
            sortOrder={
              editing?.sort_order ??
              Math.max(0, ...items.map((e) => e.sort_order)) + 10
            }
            onSaved={(saved, previousName) => {
              setItems((old) => [
                ...old.filter((e) => e.name !== previousName),
                saved,
              ]);
              setCreating(false);
              setEditing(null);
              router.refresh();
            }}
          />
        </FormModal>
      )}

      {merging && (
        <FormModal
          open
          onOpenChange={(open) => !open && setMerging(null)}
          title="種目をまとめる"
        >
          <div className="space-y-4 pb-4">
            <p className="text-body">
              「{merging.name}」で入力された{merging.count}
              件の結果を、選んだ種目に付け替えます。
            </p>
            <select
              aria-label="まとめ先の種目"
              className={selectClass}
              value={mergeTo}
              onChange={(e) => setMergeTo(e.target.value)}
            >
              <option value="">種目を選択</option>
              {items.map((e) => (
                <option key={e.name}>{e.name}</option>
              ))}
            </select>
            <FormModalFooter>
              <Button
                size="lg"
                disabled={busy || !mergeTo}
                onClick={() => void mergeInto(merging.name, mergeTo)}
              >
                {busy ? "変更中…" : "この種目にまとめる"}
              </Button>
            </FormModalFooter>
          </div>
        </FormModal>
      )}
    </>
  );
}

function EventForm({
  event,
  sortOrder,
  onSaved,
}: {
  event?: CompetitionEvent;
  sortOrder: number;
  onSaved: (saved: CompetitionEvent, previousName?: string) => void;
}) {
  const [name, setName] = useState(event?.name ?? "");
  const [sort, setSort] = useState(sortOrder);
  const [measure, setMeasure] = useState<MeasureType>(
    event && isMeasureType(event.measure_type) ? event.measure_type : "time",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !Number.isInteger(sort) || sort < 0) {
      setError("種目名と0以上の表示順を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      sort_order: sort,
      measure_type: measure,
    };
    const { data, error: saveError } = event
      ? await supabase
          .from("competition_events")
          .update(payload)
          .eq("name", event.name)
          .select("name,sort_order,measure_type")
          .single()
      : await supabase
          .from("competition_events")
          .insert(payload)
          .select("name,sort_order,measure_type")
          .single();
    if (saveError || !data) {
      setError("保存できませんでした。同じ名前の種目がないか確認してください");
      setSaving(false);
      return;
    }
    onSaved(data as CompetitionEvent, event?.name);
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <p className="section-label mb-1.5">種目名</p>
        <Input
          maxLength={50}
          placeholder="例: 5000m"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <p className="section-label mb-1.5">記録の測り方</p>
        <select
          aria-label="記録の測り方"
          className={selectClass}
          value={measure}
          onChange={(e) =>
            setMeasure(
              isMeasureType(e.target.value) ? e.target.value : "time",
            )
          }
        >
          {(Object.keys(MEASURE_TYPE_LABEL) as MeasureType[]).map((key) => (
            <option key={key} value={key}>
              {MEASURE_TYPE_LABEL[key]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-caption">
          結果の入力欄がこの設定で切り替わります。
        </p>
      </div>
      <div>
        <p className="section-label mb-1.5">表示順（小さい順）</p>
        <Input
          type="number"
          min={0}
          step={1}
          value={sort}
          onChange={(e) => setSort(Number(e.target.value))}
        />
      </div>
      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving}>
          {saving ? "保存中…" : event ? "更新する" : "追加する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}
