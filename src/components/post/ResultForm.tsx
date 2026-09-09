"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { FormModalFooter } from "@/components/ui/form-modal";
import {
  RESULT_STATUS_LABEL,
  STAGE_LABEL,
  formatRecord,
  fromCentiseconds,
  measureTypeOf,
  parseRecordText,
  toCentiseconds,
  type DatePrecision,
  type RecordStage,
  type ResultStatus,
} from "@/lib/competition-record";
import { cn } from "@/lib/utils";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { CompetitionRow, PbRecord } from "@/types";

const OTHER = "__other__";
const selectClass =
  "w-full rounded-xl border border-separator bg-card p-3 text-base";

export type ResultFormHandle = { save: () => void };

/** 数値だけを受け取る小さな入力欄（空文字は未入力） */
function NumberField({
  label,
  value,
  onChange,
  max,
  width = "flex-1",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  width?: string;
}) {
  return (
    <label className={cn("text-caption", width)}>
      {label}
      <Input
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9]/g, "");
          if (max !== undefined && next !== "" && Number(next) > max) return;
          onChange(next);
        }}
      />
    </label>
  );
}

/**
 * 大会・記録会の結果の入力フォーム（追加・編集 共通）。
 * 種目はマスタから選び、記録は種目ごとに決まった形（時間・距離・得点）で入力する。
 * 表記ブレを防ぐため、大会も登録済みのものから選べる（記録会などは自由入力）。
 */
export const ResultForm = forwardRef<
  ResultFormHandle,
  {
    userId: string;
    events: CompetitionEvent[];
    competitions: CompetitionRow[];
    initial?: PbRecord;
    onDone: (saved?: PbRecord) => void;
    onDirtyChange?: (dirty: boolean) => void;
  }
>(function ResultForm(
  { userId, events, competitions, initial, onDone, onDirtyChange },
  ref,
) {
  const router = useRouter();
  const editing = !!initial;
  const known = (name: string) => events.some((e) => e.name === name);

  const [stage, setStage] = useState<RecordStage>(
    (initial?.stage as RecordStage) ?? "university",
  );
  const [eventChoice, setEventChoice] = useState(
    initial ? (known(initial.event_name) ? initial.event_name : OTHER) : "",
  );
  const [eventOther, setEventOther] = useState(
    initial && !known(initial.event_name) ? initial.event_name : "",
  );
  const eventName = eventChoice === OTHER ? eventOther.trim() : eventChoice;
  const measure = measureTypeOf(events, eventName);

  const legacy = useMemo(
    () =>
      initial &&
      initial.value_cs === null &&
      initial.value_cm === null &&
      initial.value_points === null
        ? parseRecordText(initial.record, measure)
        : null,
    [initial, measure],
  );
  const initialCs = initial?.value_cs ?? legacy?.value_cs ?? null;
  const initialCm = initial?.value_cm ?? legacy?.value_cm ?? null;
  const initialPoints = initial?.value_points ?? legacy?.value_points ?? null;
  const parts = initialCs !== null ? fromCentiseconds(initialCs) : null;

  const [hours, setHours] = useState(parts?.hours ? String(parts.hours) : "");
  const [minutes, setMinutes] = useState(
    parts && (parts.minutes || parts.hours) ? String(parts.minutes) : "",
  );
  const [seconds, setSeconds] = useState(parts ? String(parts.seconds) : "");
  const [centis, setCentis] = useState(
    parts ? String(parts.centis).padStart(2, "0") : "",
  );
  const [metres, setMetres] = useState(
    initialCm !== null ? String(Math.floor(initialCm / 100)) : "",
  );
  const [centimetres, setCentimetres] = useState(
    initialCm !== null ? String(initialCm % 100).padStart(2, "0") : "",
  );
  const [points, setPoints] = useState(
    initialPoints !== null ? String(initialPoints) : "",
  );
  const [status, setStatus] = useState<ResultStatus>(
    (initial?.result_status as ResultStatus) ?? "ok",
  );
  const [wind, setWind] = useState(
    initial?.wind !== null && initial?.wind !== undefined
      ? String(initial.wind)
      : "",
  );

  const [competitionId, setCompetitionId] = useState(
    initial?.competition_id ?? "",
  );
  const [meetOther, setMeetOther] = useState(
    initial && !initial.competition_id ? (initial.meet_name ?? "") : "",
  );
  const [meetMode, setMeetMode] = useState<"catalog" | "other">(
    initial?.competition_id ? "catalog" : "other",
  );

  const [precision, setPrecision] = useState<DatePrecision>(
    (initial?.date_precision as DatePrecision) ?? "day",
  );
  const [recordedOn, setRecordedOn] = useState(initial?.recorded_on ?? "");

  const [isPb, setIsPb] = useState(initial?.is_pb ?? false);
  const [isUb, setIsUb] = useState(initial?.is_ub ?? false);
  const [isOfficial, setIsOfficial] = useState(initial?.is_official ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshot = JSON.stringify([
    stage,
    eventName,
    hours,
    minutes,
    seconds,
    centis,
    metres,
    centimetres,
    points,
    status,
    wind,
    competitionId,
    meetOther,
    meetMode,
    precision,
    recordedOn,
    isPb,
    isUb,
    isOfficial,
  ]);
  const [baseline] = useState(snapshot);
  useEffect(() => {
    onDirtyChange?.(snapshot !== baseline);
  }, [snapshot, baseline, onDirtyChange]);
  useImperativeHandle(ref, () => ({ save: () => void submit() }));

  /** 大会を選んだら初日を記録日に入れる（複数日開催でも初日で統一する） */
  function chooseCompetition(id: string) {
    setCompetitionId(id);
    const found = competitions.find((c) => c.id === id);
    if (found && stage === "university") {
      setRecordedOn(found.starts_on);
      setPrecision("day");
    }
  }

  function buildValues() {
    if (status !== "ok")
      return { value_cs: null, value_cm: null, value_points: null };
    if (measure === "distance") {
      const cm =
        Number(metres || 0) * 100 + Number((centimetres || "0").padEnd(2, "0"));
      return { value_cs: null, value_cm: cm, value_points: null };
    }
    if (measure === "points")
      return {
        value_cs: null,
        value_cm: null,
        value_points: Number(points || 0),
      };
    return {
      value_cs: toCentiseconds({
        hours: Number(hours || 0),
        minutes: Number(minutes || 0),
        seconds: Number(seconds || 0),
        centis: Number((centis || "0").padEnd(2, "0")),
      }),
      value_cm: null,
      value_points: null,
    };
  }

  function normalizedDate(): { recorded_on: string | null; date_precision: DatePrecision } {
    if (stage === "pre_university")
      return {
        recorded_on: /^\d{4}$/.test(recordedOn)
          ? `${recordedOn}-01-01`
          : recordedOn || null,
        date_precision: "year",
      };
    if (!recordedOn) return { recorded_on: null, date_precision: precision };
    if (precision === "year")
      return {
        recorded_on: `${recordedOn.slice(0, 4)}-01-01`,
        date_precision: "year",
      };
    if (precision === "month")
      return {
        recorded_on: `${recordedOn.slice(0, 7)}-01`,
        date_precision: "month",
      };
    return { recorded_on: recordedOn, date_precision: "day" };
  }

  async function submit() {
    if (!eventName) {
      setError("種目を選んでください");
      return;
    }
    const values = buildValues();
    const empty =
      values.value_cs === 0 ||
      values.value_cm === 0 ||
      values.value_points === 0;
    if (status === "ok" && (empty || Object.values(values).every((v) => v === null))) {
      setError("記録を入力してください");
      return;
    }
    const windValue = wind.trim() === "" ? null : Number(wind);
    if (windValue !== null && !Number.isFinite(windValue)) {
      setError("風速は数値で入力してください");
      return;
    }
    setSaving(true);
    setError(null);

    const date = normalizedDate();
    const payload = {
      event_name: eventName,
      ...values,
      result_status: status,
      wind: measure === "points" ? null : windValue,
      record: formatRecord({ ...values, result_status: status }, measure),
      competition_id: meetMode === "catalog" ? competitionId || null : null,
      meet_name:
        meetMode === "catalog"
          ? (competitions.find((c) => c.id === competitionId)?.name ?? null)
          : meetOther.trim() || null,
      stage,
      ...date,
      is_pb: isPb,
      is_ub: isUb,
      is_official: isOfficial,
    };

    const supabase = createClient();
    const { data, error: saveError } = editing
      ? await supabase
          .from("pb_records")
          .update(payload)
          .eq("id", initial!.id)
          .select()
          .single()
      : await supabase
          .from("pb_records")
          .insert({ user_id: userId, ...payload })
          .select()
          .single();

    if (saveError || !data) {
      setError("保存できませんでした。もう一度お試しください");
      setSaving(false);
      return;
    }
    router.refresh();
    onDone(data as PbRecord);
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <p className="section-label mb-1.5">いつの記録か</p>
        <div className="flex rounded-xl bg-separator/50 p-0.5">
          {(Object.keys(STAGE_LABEL) as RecordStage[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={stage === key}
              onClick={() => setStage(key)}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold",
                stage === key ? "bg-card text-ink shadow-sm" : "text-muted",
              )}
            >
              {STAGE_LABEL[key]}
            </button>
          ))}
        </div>
        {stage === "pre_university" && (
          <p className="mt-1 text-caption">
            高校までの記録です。日付は入れなくてかまいません。
          </p>
        )}
      </div>

      <div>
        <p className="section-label mb-1.5">種目</p>
        <select
          aria-label="種目"
          className={selectClass}
          value={eventChoice}
          onChange={(e) => setEventChoice(e.target.value)}
        >
          <option value="">種目を選択</option>
          {events.map((e) => (
            <option key={e.name}>{e.name}</option>
          ))}
          <option value={OTHER}>その他（自由入力）</option>
        </select>
        {eventChoice === OTHER && (
          <Input
            className="mt-2"
            maxLength={50}
            placeholder="例: 2000mSC"
            value={eventOther}
            onChange={(e) => setEventOther(e.target.value)}
          />
        )}
      </div>

      <div>
        <p className="section-label mb-1.5">記録</p>
        <select
          aria-label="記録の状態"
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as ResultStatus)}
        >
          {(Object.keys(RESULT_STATUS_LABEL) as ResultStatus[]).map((key) => (
            <option key={key} value={key}>
              {RESULT_STATUS_LABEL[key]}
            </option>
          ))}
        </select>

        {status === "ok" && measure === "time" && (
          <div className="mt-2 flex items-end gap-2">
            <NumberField label="時（任意）" value={hours} onChange={setHours} max={23} />
            <NumberField label="分" value={minutes} onChange={setMinutes} max={999} />
            <NumberField label="秒" value={seconds} onChange={setSeconds} max={59} />
            <NumberField label="1/100" value={centis} onChange={setCentis} max={99} />
          </div>
        )}
        {status === "ok" && measure === "distance" && (
          <div className="mt-2 flex items-end gap-2">
            <NumberField label="m" value={metres} onChange={setMetres} max={99} />
            <NumberField label="cm" value={centimetres} onChange={setCentimetres} max={99} />
          </div>
        )}
        {status === "ok" && measure === "points" && (
          <div className="mt-2">
            <NumberField label="点" value={points} onChange={setPoints} max={99999} />
          </div>
        )}
        {status === "ok" && measure !== "points" && (
          <label className="mt-2 block text-caption">
            風速（任意・例: 1.2 / -0.3）
            <Input
              inputMode="decimal"
              placeholder="+1.2"
              value={wind}
              onChange={(e) =>
                setWind(e.target.value.replace(/[^0-9.+-]/g, ""))
              }
            />
          </label>
        )}
      </div>

      <div>
        <p className="section-label mb-1.5">大会</p>
        <div className="flex rounded-xl bg-separator/50 p-0.5">
          {(
            [
              { value: "catalog", label: "大会から選ぶ" },
              { value: "other", label: "自由入力" },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={meetMode === item.value}
              onClick={() => setMeetMode(item.value)}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold",
                meetMode === item.value
                  ? "bg-card text-ink shadow-sm"
                  : "text-muted",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {meetMode === "catalog" ? (
          <>
            <select
              aria-label="大会"
              className={cn(selectClass, "mt-2")}
              value={competitionId}
              onChange={(e) => chooseCompetition(e.target.value)}
            >
              <option value="">大会を選択</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-caption">
              選ぶと記録日に大会の初日が入ります。
            </p>
          </>
        ) : (
          <Input
            className="mt-2"
            placeholder="例: 東京都記録会"
            value={meetOther}
            onChange={(e) => setMeetOther(e.target.value)}
          />
        )}
      </div>

      {stage === "university" ? (
        <div>
          <p className="section-label mb-1.5">記録日（任意）</p>
          <select
            aria-label="記録日の細かさ"
            className={selectClass}
            value={precision}
            onChange={(e) => setPrecision(e.target.value as DatePrecision)}
          >
            <option value="day">日まで入れる</option>
            <option value="month">年と月だけ</option>
            <option value="year">年だけ</option>
          </select>
          {precision === "day" && (
            <Input
              className="mt-2"
              type="date"
              value={recordedOn}
              onChange={(e) => setRecordedOn(e.target.value)}
            />
          )}
          {precision === "month" && (
            <Input
              className="mt-2"
              type="month"
              value={recordedOn.slice(0, 7)}
              onChange={(e) => setRecordedOn(`${e.target.value}-01`)}
            />
          )}
          {precision === "year" && (
            <Input
              className="mt-2"
              inputMode="numeric"
              placeholder="例: 2026"
              value={recordedOn.slice(0, 4)}
              onChange={(e) =>
                setRecordedOn(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
              }
            />
          )}
        </div>
      ) : (
        <div>
          <p className="section-label mb-1.5">年（任意）</p>
          <Input
            inputMode="numeric"
            placeholder="例: 2024"
            value={recordedOn.slice(0, 4)}
            onChange={(e) =>
              setRecordedOn(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
            }
          />
        </div>
      )}

      <Toggle
        label="PB（自己ベスト）として記録"
        checked={isPb}
        onChange={() => setIsPb((v) => !v)}
      />
      <Toggle
        label="UB（大学ベスト）として記録"
        checked={isUb}
        onChange={() => setIsUb((v) => !v)}
      />
      <Toggle
        label="公認記録"
        checked={isOfficial}
        onChange={() => setIsOfficial((v) => !v)}
      />
      <p className="text-caption">
        PB・UB は種目ごとに1件だけ付きます。新しく付けると、同じ種目の前の記録からは外れます。
      </p>

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving}>
          {saving ? (
            <>
              <LoaderCircle size={18} className="animate-spin" />
              保存中…
            </>
          ) : editing ? (
            "更新する"
          ) : (
            "投稿する"
          )}
        </Button>
      </FormModalFooter>
    </div>
  );
});
