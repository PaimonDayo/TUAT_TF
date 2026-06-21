"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { IntensityInput, type IntensityValues } from "@/components/features/IntensityInput";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CONDITIONS, CONDITION_ORDER } from "@/lib/constants";
import type { Condition, PracticeRecord } from "@/types";

const EMPTY: IntensityValues = { low: "", mid: "", high: "", speed: "" };

const numStr = (n: number) => (n && n > 0 ? String(n) : "");

/**
 * 練習記録フォーム。新規投稿と編集の両対応。
 * record を渡すと編集モード（その記録を更新）になる。
 */
export function RecordForm({
  userId,
  isMiddleLong,
  record,
  onDone,
}: {
  userId: string;
  isMiddleLong: boolean;
  record?: PracticeRecord;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = !!record;

  const [date, setDate] = useState(record?.recorded_date ?? format(new Date(), "yyyy-MM-dd"));
  const [dist, setDist] = useState<IntensityValues>(
    record
      ? {
          low: numStr(record.dist_low),
          mid: numStr(record.dist_mid),
          high: numStr(record.dist_high),
          speed: numStr(record.dist_speed),
        }
      : EMPTY,
  );
  const [strides, setStrides] = useState(numStr(record?.strides ?? 0));
  const [resultText, setResultText] = useState(record?.result_text ?? "");
  const [strengthText, setStrengthText] = useState(record?.strength_text ?? "");
  const [menuText, setMenuText] = useState(record?.menu_text ?? "");
  const [focusText, setFocusText] = useState(record?.focus_text ?? "");
  const [memo, setMemo] = useState(record?.memo ?? "");
  const [condition, setCondition] = useState<Condition | null>(record?.condition ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const distTotal =
      (parseFloat(dist.low) || 0) +
      (parseFloat(dist.mid) || 0) +
      (parseFloat(dist.high) || 0) +
      (parseFloat(dist.speed) || 0);
    const hasContent = isMiddleLong
      ? distTotal > 0 ||
        (parseInt(strides) || 0) > 0 ||
        !!resultText.trim() ||
        !!strengthText.trim() ||
        !!memo.trim() ||
        !!condition
      : !!menuText.trim() ||
        !!focusText.trim() ||
        !!resultText.trim() ||
        !!memo.trim() ||
        !!condition;
    if (!hasContent) {
      setError(
        isMiddleLong
          ? "距離・タイム・補強・感想のいずれかを入力してください"
          : "メニュー・目的・タイム・感想のいずれかを入力してください",
      );
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();

    // 中長距離は距離系、それ以外はメニュー/目的系。使わない側は null/0 にする。
    const payload = isMiddleLong
      ? {
          recorded_date: date,
          dist_low: parseFloat(dist.low) || 0,
          dist_mid: parseFloat(dist.mid) || 0,
          dist_high: parseFloat(dist.high) || 0,
          dist_speed: parseFloat(dist.speed) || 0,
          strides: parseInt(strides) || 0,
          result_text: resultText.trim() || null,
          strength_text: strengthText.trim() || null,
          menu_text: null,
          focus_text: null,
          memo: memo.trim() || null,
          condition,
        }
      : {
          recorded_date: date,
          dist_low: 0,
          dist_mid: 0,
          dist_high: 0,
          dist_speed: 0,
          strides: 0,
          result_text: resultText.trim() || null,
          strength_text: null,
          menu_text: menuText.trim() || null,
          focus_text: focusText.trim() || null,
          memo: memo.trim() || null,
          condition,
        };

    if (editing) {
      const result = await safeUpdate(supabase, "practice_records", payload, { id: record!.id });
      if (!result.ok) {
        setError(safeUpdateMessage(result.reason));
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("practice_records")
        .insert({ user_id: userId, ...payload });
      if (error) {
        setError("記録の保存に失敗しました");
        setSaving(false);
        return;
      }
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-4 pb-4 max-h-[72vh] overflow-y-auto">
      {/* 日付 */}
      <div>
        <p className="section-label mb-1.5">日付</p>
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>

      {/* 強度別距離（中長距離のみ） */}
      {isMiddleLong && (
        <div>
          <p className="section-label mb-1.5">強度別距離</p>
          <IntensityInput values={dist} onChange={setDist} />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[13px] font-medium">流し</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={strides}
              onChange={(e) => setStrides(e.target.value)}
              className="h-9 w-20 text-right"
            />
            <span className="text-caption">本</span>
          </div>
        </div>
      )}

      {/* メニュー（短距離・跳躍・投擲） */}
      {!isMiddleLong && (
        <div>
          <p className="section-label mb-1.5">メニュー</p>
          <Textarea
            rows={2}
            placeholder="今日取り組んだメニュー"
            value={menuText}
            onChange={(e) => setMenuText(e.target.value)}
          />
        </div>
      )}

      {/* 目的・意識すること（短距離・跳躍・投擲） */}
      {!isMiddleLong && (
        <div>
          <p className="section-label mb-1.5">目的・意識すること</p>
          <Textarea
            rows={2}
            placeholder="このメニューの狙い・意識したポイント"
            value={focusText}
            onChange={(e) => setFocusText(e.target.value)}
          />
        </div>
      )}

      {/* 結果・タイム */}
      <div>
        <p className="section-label mb-1.5">{isMiddleLong ? "結果・タイム" : "タイム"}</p>
        <Textarea
          rows={2}
          placeholder={isMiddleLong ? "例: 5000m 16'20\"" : "例: 100m 11.2 (+1.5)"}
          value={resultText}
          onChange={(e) => setResultText(e.target.value)}
        />
      </div>

      {/* 補強（中長距離のみ） */}
      {isMiddleLong && (
        <div>
          <p className="section-label mb-1.5">補強</p>
          <Textarea
            rows={2}
            placeholder="腹筋・背筋・体幹 など"
            value={strengthText}
            onChange={(e) => setStrengthText(e.target.value)}
          />
        </div>
      )}

      {/* 感想 */}
      <div>
        <p className="section-label mb-1.5">感想・振り返り</p>
        <Textarea
          rows={3}
          placeholder="今日の練習はどうだった？"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </div>

      {/* コンディション */}
      <div>
        <p className="section-label mb-1.5">コンディション</p>
        <div className="grid grid-cols-3 gap-2">
          {CONDITION_ORDER.map((c) => {
            const meta = CONDITIONS[c];
            const active = condition === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(active ? null : c)}
                className="h-14 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-active active:scale-[0.98]"
                style={{
                  borderColor: active ? meta.color : "#e5e5ea",
                  backgroundColor: active ? meta.color + "14" : "#fff",
                }}
              >
                <span
                  className="text-[22px] leading-none font-semibold"
                  style={{ color: active ? meta.color : "#c7c7cc" }}
                >
                  {meta.symbol}
                </span>
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: active ? meta.color : "#8e8e93" }}
                >
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving}>
        {saving ? "保存中…" : editing ? "更新する" : "記録する"}
      </Button>
    </div>
  );
}
