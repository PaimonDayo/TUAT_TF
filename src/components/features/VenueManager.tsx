"use client";

import { useState } from "react";
import { MapPin, Plus, SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu } from "@/components/ui/action-menu";
import { Card } from "@/components/ui/card";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ReorderList } from "@/components/ui/reorder-list";
import type { VenueRow } from "@/types";

/** 練習場所の管理（追加・編集・削除・選択リスト表示の切替） */
export function VenueManager({ initial }: { initial: VenueRow[] }) {
  const [items, setItems] = useState<VenueRow[]>(initial);
  const [editing, setEditing] = useState<VenueRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);

  async function togglePinned(v: VenueRow) {
    const previous = items;
    setItems((arr) => arr.map((x) => (x.id === v.id ? { ...x, pinned: !x.pinned } : x)));
    const supabase = createClient();
    const { error } = await supabase.from("venues").update({ pinned: !v.pinned }).eq("id", v.id);
    if (error) {
      setItems(previous);
      alert("リスト表示を更新できませんでした");
    }
  }

  async function remove(v: VenueRow) {
    const supabase = createClient();
    const { error } = await supabase.from("venues").delete().eq("id", v.id);
    if (error) {
      alert("会場を削除できませんでした");
      return false;
    }
    setItems((arr) => arr.filter((x) => x.id !== v.id));
    return true;
  }

  async function reorder(next: VenueRow[]) {
    const previous = items;
    setItems(next);
    const supabase = createClient();
    const { error } = await supabase.rpc("reorder_venues", {
      venue_ids: next.map((venue) => venue.id),
    });
    if (error) {
      setItems(previous);
      alert("並び順を更新できませんでした");
    }
  }

  return (
    <>
      <p className="text-caption">
        オンにした会場が、予定作成の「場所」リストに表示されます。
      </p>

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant={reorderMode ? "primary" : "outline"}
          onClick={() => setReorderMode((value) => !value)}
        >
          <SlidersHorizontal size={16} />
          {reorderMode ? "完了" : "並べ替え"}
        </Button>
      </div>

      <ReorderList
        items={items}
        enabled={reorderMode}
        onReorder={(next) => void reorder(next)}
        renderItem={(v) => (
          <Card key={v.id} className="p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                {v.short && (
                  <p className="mb-1">
                    <span className="inline-flex rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] font-bold text-accent">
                      {v.short}
                    </span>
                  </p>
                )}
                <p className="text-headline break-words">{v.name}</p>
                {v.access && <p className="text-caption whitespace-pre-wrap mt-0.5">{v.access}</p>}
                {v.fee && <p className="text-caption">参加費：{v.fee}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-3">
                <ActionMenu
                  onEdit={() => setEditing(v)}
                  onDelete={() => remove(v)}
                  deleteTitle={`「${v.name}」を削除しますか？`}
                  deleteDescription="削除した会場は予定作成の候補からも消えます。"
                  triggerLabel={`${v.name}のメニュー`}
                />
              </div>
            </div>
            <Toggle
              label="予定作成に表示"
              checked={v.pinned}
              onChange={() => togglePinned(v)}
              className="mt-3 border-0 bg-transparent p-0"
            />
          </Card>
        )}
      />

      <Button variant="outline" size="lg" onClick={() => setCreating(true)} className="gap-2">
        <Plus size={18} /> 会場を追加
      </Button>

      {creating && (
        <FormModal open onOpenChange={setCreating} title="会場を追加">
          <VenueForm
            sort={items.length + 1}
            onSaved={(v) => {
              setItems((arr) => [...arr, v]);
              setCreating(false);
            }}
          />
        </FormModal>
      )}

      {editing && (
        <FormModal open onOpenChange={(open) => !open && setEditing(null)} title="会場を編集">
          <VenueForm
            venue={editing}
            sort={editing.sort}
            onSaved={(v) => {
              setItems((arr) => arr.map((x) => (x.id === v.id ? v : x)));
              setEditing(null);
            }}
          />
        </FormModal>
      )}
    </>
  );
}

function VenueForm({
  venue,
  sort,
  onSaved,
}: {
  venue?: VenueRow;
  sort: number;
  onSaved: (v: VenueRow) => void;
}) {
  const [name, setName] = useState(venue?.name ?? "");
  const [short, setShort] = useState(venue?.short ?? "");
  const [access, setAccess] = useState(venue?.access ?? "");
  const [fee, setFee] = useState(venue?.fee ?? "");
  const [url, setUrl] = useState(venue?.url ?? "");
  const [pinned, setPinned] = useState(venue?.pinned ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("会場名を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      short: short.trim() || null,
      access: access.trim() || null,
      fee: fee.trim() || null,
      url: url.trim() || null,
      pinned,
      sort,
    };
    const { data, error } = venue
      ? await supabase.from("venues").update(payload).eq("id", venue.id).select().single()
      : await supabase.from("venues").insert(payload).select().single();

    if (error || !data) {
      setError("保存に失敗しました");
      setSaving(false);
      return;
    }
    onSaved(data as VenueRow);
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <p className="section-label mb-1.5">会場名</p>
        <Input placeholder="例: 府中市民陸上競技場" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">略称（任意・カードに表示）</p>
        <Input placeholder="例: 府中" value={short} onChange={(e) => setShort(e.target.value)} maxLength={6} />
      </div>
      <div>
        <p className="section-label mb-1.5">アクセス（任意・改行で複数）</p>
        <Textarea rows={3} placeholder={"例: 北府中駅から徒歩7分\n府中駅から徒歩15分"} value={access} onChange={(e) => setAccess(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">参加費（任意）</p>
        <Input placeholder="例: 100円" value={fee} onChange={(e) => setFee(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">地図URL（任意）</p>
        <Input placeholder="https://maps…" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
      </div>
      <Toggle label="予定作成に表示" checked={pinned} onChange={() => setPinned((v) => !v)} />
      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving} className="gap-1">
        <MapPin size={16} /> {saving ? "保存中…" : venue ? "更新する" : "追加する"}
      </Button>
    </div>
  );
}
