"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { jstToday } from "@/lib/date";
import { IntensityInput, type IntensityValues } from "@/components/features/IntensityInput";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormModalFooter } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { CONDITIONS, CONDITION_ORDER } from "@/lib/constants";
import type { Condition, PracticeRecord, RecordFieldDef } from "@/types";

/** write-through: 記録のメインがスプシの部員の保存を、その場でスプシへ反映する（タスク16） */
async function pushRecordToSheet(recordId: string): Promise<{ ok: boolean; error?: string; unmapped?: string[] }> {
  try {
    const res = await fetch("/api/sheets/push-record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordId }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error ?? "スプレッドシートへの反映に失敗しました" };
    }
    return { ok: true, unmapped: json.unmapped ?? [] };
  } catch {
    return { ok: false, error: "スプレッドシートへの反映に失敗しました（通信エラー）" };
  }
}

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
  recordSource = "app",
  recordFields,
  onDone,
}: {
  userId: string;
  isMiddleLong: boolean;
  record?: PracticeRecord;
  /** 記録の入力元。'sheet'ならスプレッドシートが正のためアプリからの投稿・編集はできない */
  recordSource?: "app" | "sheet";
  /** カスタム項目定義。取得済みプロフィールから渡す（省略時のみ内部でフェッチする） */
  recordFields?: RecordFieldDef[];
  onDone: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const editing = !!record;

  const [date, setDate] = useState(record?.recorded_date ?? jstToday());
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
  // 新規作成モードでその日の記録が既にあるか（1日1記録ルール。見つかったら編集扱いでフォームへ読み込む）
  const [hasExistingSameDay, setHasExistingSameDay] = useState(false);

  // カスタム項目（プロフィールで設定したもの）。フォームに動的に追加する。
  // 呼び出し側が取得済みプロフィールから渡していれば、それを使い再フェッチしない。
  const [customFields, setCustomFields] = useState<RecordFieldDef[]>(recordFields ?? []);
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [k, v] of Object.entries(record?.custom ?? {})) {
      init[k] = v == null ? "" : String(v);
    }
    return init;
  });

  useEffect(() => {
    if (recordFields) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("record_fields")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        const fields = (data?.record_fields ?? []) as RecordFieldDef[];
        setCustomFields(fields);
      });
  }, [userId, recordFields]);

  // 練習記録は1日1件（1日1記録ルール）。新規作成モードで日付を選ぶたび、その日の記録が
  // 既にあれば「新規作成」ではなく実質的な編集としてフォームへ読み込む（未入力に見える状態で
  // 保存し既存の内容を消してしまう事故を防ぐ）。DBをSupabase単独に統合した際は見直す可能性があるが、
  // 'sheet'メインの部員はシート行と1:1対応のため当面はこのルールを維持する。
  useEffect(() => {
    if (editing) return; // 記録カードからの編集は渡された record をそのまま使う（対象外）
    let active = true;
    const supabase = createClient();
    supabase
      .from("practice_records")
      .select("*")
      .eq("user_id", userId)
      .eq("recorded_date", date)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const found = data as PracticeRecord | null;
        setHasExistingSameDay(!!found);
        setDist(
          found
            ? {
                low: numStr(found.dist_low),
                mid: numStr(found.dist_mid),
                high: numStr(found.dist_high),
                speed: numStr(found.dist_speed),
              }
            : EMPTY,
        );
        setStrides(numStr(found?.strides ?? 0));
        setResultText(found?.result_text ?? "");
        setStrengthText(found?.strength_text ?? "");
        setMenuText(found?.menu_text ?? "");
        setFocusText(found?.focus_text ?? "");
        setMemo(found?.memo ?? "");
        setCondition(found?.condition ?? null);
        const custom: Record<string, string> = {};
        for (const [k, v] of Object.entries(found?.custom ?? {})) {
          custom[k] = v == null ? "" : String(v);
        }
        setCustomValues(custom);
      });
    return () => {
      active = false;
    };
  }, [date, editing, userId]);

  function buildCustom(): Record<string, string | number | null> {
    const out: Record<string, string | number | null> = { ...(record?.custom ?? {}) };
    for (const f of customFields) {
      const raw = (customValues[f.key] ?? "").trim();
      if (!raw) out[f.key] = null;
      else out[f.key] = f.type === "number" ? parseFloat(raw) || 0 : raw;
    }
    return out;
  }

  async function submit() {
    if (date > jstToday()) {
      setError("未来の日付は選べません");
      return;
    }
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

    const custom = buildCustom();

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
          custom,
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
          custom,
        };

    let savedId: string;
    if (editing) {
      const result = await safeUpdate(supabase, "practice_records", payload, { id: record!.id });
      if (!result.ok) {
        setError(safeUpdateMessage(result.reason));
        setSaving(false);
        return;
      }
      savedId = record!.id;
    } else {
      // 同じ日の記録が既にあれば新規ではなく更新する（1日1件に保つ＝重複防止。
      // 'sheet'メインの部員はシート行と1:1対応のため特に重要）
      const { data: sameDay } = await supabase
        .from("practice_records")
        .select("id")
        .eq("user_id", userId)
        .eq("recorded_date", date)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (sameDay) {
        const result = await safeUpdate(supabase, "practice_records", payload, { id: sameDay.id });
        if (!result.ok) {
          setError(safeUpdateMessage(result.reason));
          setSaving(false);
          return;
        }
        savedId = sameDay.id;
      } else {
        const { data: inserted, error } = await supabase
          .from("practice_records")
          // from_sheet はinsert時のみ設定する（アプリ投稿＝タイムラインに出す）。updateでは変更しない。
          .insert({ user_id: userId, from_sheet: false, ...payload })
          .select("id")
          .single();
        if (error || !inserted) {
          setError("記録の保存に失敗しました");
          setSaving(false);
          return;
        }
        savedId = inserted.id;
      }
    }

    // write-through: 記録のメインがスプシの部員は、保存直後にその場でスプシへ反映する（タスク16）。
    // アプリへの保存自体はすでに成功しているため、ここでの失敗はデータ消失にはならない
    // （次回の毎時同期が再送する）。ユーザーには警告として知らせる。
    if (recordSource === "sheet") {
      const pushResult = await pushRecordToSheet(savedId);
      if (!pushResult.ok) {
        showToast(
          `記録はアプリに保存されましたが、スプレッドシートへの反映に失敗しました（自動で再試行されます）: ${pushResult.error}`,
          "error",
        );
      } else if (pushResult.unmapped && pushResult.unmapped.length > 0) {
        showToast(
          `スプレッドシートに次の項目の列が見つからず反映できませんでした: ${pushResult.unmapped.join("・")}`,
          "error",
        );
      }
    }

    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-4 pb-4">
      {/* 日付 */}
      <div>
        <p className="section-label mb-1.5">日付</p>
        <Input
          type="date"
          value={date}
          max={jstToday()}
          onChange={(event) => setDate(event.target.value)}
        />
        {!editing && hasExistingSameDay && (
          <p className="text-caption text-muted2 mt-1">
            この日の記録は既にあります。内容を読み込みました（保存すると更新されます）
          </p>
        )}
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

      {/* 結果 */}
      <div>
        <p className="section-label mb-1.5">{isMiddleLong ? "結果" : "タイム"}</p>
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

      {/* カスタム項目（プロフィールで追加したもの） */}
      {customFields.map((f) => (
        <div key={f.key}>
          <p className="section-label mb-1.5">{f.label}</p>
          {f.type === "number" ? (
            <Input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={customValues[f.key] ?? ""}
              onChange={(e) =>
                setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          ) : (
            <Textarea
              rows={2}
              value={customValues[f.key] ?? ""}
              onChange={(e) =>
                setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          )}
        </div>
      ))}

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
      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving}>
          {saving ? "保存中…" : editing || hasExistingSameDay ? "更新する" : "記録する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}
