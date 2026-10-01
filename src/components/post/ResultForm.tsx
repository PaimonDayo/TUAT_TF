"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
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
  parseDecimalSeconds,
  parseDecimalMetres,
  decimalMetresInput,
  type DatePrecision,
  type RecordStage,
  type ResultStatus,
  type TimeFormat,
} from "@/lib/competition-record";
import {
  initialResultInput,
  initialResultValues,
  measureForResultInput,
  resultInputPreset,
  resultTimeFields,
  type ResultInputFormat,
} from "@/lib/competition-result-input";
import { cn } from "@/lib/utils";
import { competitionDays } from "@/lib/competition-days";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { CompetitionRow, PbRecord } from "@/types";

const OTHER = "__other__";
const selectClass =
  "w-full rounded-xl border border-separator bg-card p-3 text-base";

export type ResultFormHandle = { save: () => void };


/** 小数で入れる欄（秒・メートル）。小数点は1つだけ、小数部は2桁まで。 */
function DecimalField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex-1 text-caption">
      {label}
      <Input
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          const cleaned = event.target.value.replace(/[^0-9.]/g, "");
          const [whole, ...rest] = cleaned.split(".");
          onChange(
            rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole,
          );
        }}
      />
    </label>
  );
}

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
  // Initialize from saved values once. A catalog refresh must not reinterpret a draft.
  const [initialInput] = useState(() => initialResultInput(initial, events));
  const [recordFormat, setRecordFormat] = useState<ResultInputFormat>(initialInput.format);
  const [otherFormat, setOtherFormat] = useState<ResultInputFormat>(initialInput.format);
  const [windEnabled, setWindEnabled] = useState(initialInput.wind);
  const [otherWindEnabled, setOtherWindEnabled] = useState(initialInput.wind);
  const measure = measureForResultInput(recordFormat);
  const timeFormat: TimeFormat = recordFormat === "seconds" ? "seconds" : "minutes";
  const showWind = measure !== "points" && windEnabled;
  const distanceLabel = resultInputPreset(eventName, events).distanceLabel;
  const [initialValues] = useState(() => initialResultValues(initial, initialInput.format));
  const [initialTime] = useState(() => resultTimeFields(initialValues.value_cs, initialInput.format));
  const [timeDraftFormat, setTimeDraftFormat] = useState<ResultInputFormat>(
    measureForResultInput(initialInput.format) === "time" ? initialInput.format : "minutes",
  );
  const [hours, setHours] = useState(initialTime.hours);
  const [minutes, setMinutes] = useState(initialTime.minutes);
  const [seconds, setSeconds] = useState(initialTime.seconds);
  const [metres, setMetres] = useState(
    initialValues.value_cm !== null ? decimalMetresInput(initialValues.value_cm) : "",
  );
  const [points, setPoints] = useState(
    initialValues.value_points !== null ? String(initialValues.value_points) : "",
  );
  const [status, setStatus] = useState<ResultStatus>(
    (initial?.result_status as ResultStatus) ?? "ok",
  );
  const [wind, setWind] = useState(
    initial?.wind !== null && initial?.wind !== undefined
      ? String(Math.abs(initial.wind))
      : "",
  );
  const [windDirection, setWindDirection] = useState<"tailwind" | "headwind">(
    (initial?.wind ?? 0) < 0 ? "headwind" : "tailwind",
  );

  const [competitionId, setCompetitionId] = useState(
    initial?.competition_id ?? "",
  );
  const [meetOther, setMeetOther] = useState(
    initial && !initial.competition_id ? (initial.meet_name ?? "") : "",
  );
  const [meetMode, setMeetMode] = useState<"catalog" | "other">(
    !initial || initial.competition_id ? "catalog" : "other",
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
    recordFormat,
    otherFormat,
    windEnabled,
    otherWindEnabled,
    hours,
    minutes,
    seconds,

    metres,

    points,
    status,
    wind,
    windDirection,
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

  function timeValue(format: ResultInputFormat): number | null {
    const secondsValue = seconds.trim() === "" ? 0 : parseDecimalSeconds(seconds);
    if (secondsValue === null) return null;
    const total = secondsValue + (format === "seconds" ? 0 : Number(minutes || 0) * 6_000)
      + (format === "hours" ? Number(hours || 0) * 360_000 : 0);
    return Number.isSafeInteger(total) && total <= 2_147_483_647 ? total : null;
  }

  function changeFormat(format: ResultInputFormat) {
    if (measureForResultInput(format) === "time" && format !== timeDraftFormat) {
      const value = timeValue(timeDraftFormat);
      if (value === null) {
        setError("入力中のタイムを確認してください");
        return false;
      }
      const hasTime = hours !== "" || minutes !== "" || seconds !== "";
      const next = resultTimeFields(hasTime ? value : null, format);
      setHours(next.hours);
      setMinutes(next.minutes);
      setSeconds(next.seconds);
      setTimeDraftFormat(format);
    }
    setRecordFormat(format);
    setError(null);
    return true;
  }

  function chooseEvent(value: string) {
    const preset = value === OTHER
      ? { format: otherFormat, wind: otherWindEnabled }
      : resultInputPreset(value, events);
    if (!changeFormat(preset.format)) return;
    setEventChoice(value);
    setWindEnabled(preset.wind);
  }

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
    if (measure === "distance")
      return {
        value_cs: null,
        value_cm: parseDecimalMetres(metres),
        value_points: null,
      };
    if (measure === "points")
      return {
        value_cs: null,
        value_cm: null,
        value_points: Number(points || 0),
      };
    // 秒で書く種目は秒だけ、分と秒で書く種目は時・分も足して 1/100秒 へ直す。
    return {
      value_cs: timeValue(recordFormat),
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
    const windValue = status !== "ok" || !showWind || wind.trim() === ""
      ? null
      : Number(wind) * (windDirection === "headwind" ? -1 : 1);
    if (windValue !== null && !Number.isFinite(windValue)) {
      setError("風速は数値で入力してください");
      return;
    }
    if (windValue !== null && (Math.abs(windValue) > 20 || !/^\d*(?:\.\d)?$/.test(wind))) {
      setError("風速は20.0m/s以内、小数第1位までで入力してください");
      return;
    }
    setSaving(true);
    setError(null);

    const date = normalizedDate();
    const payload = {
      event_name: eventName,
      ...values,
      result_status: status,
      wind: windValue,
      record: formatRecord({ ...values, result_status: status }, measure, timeFormat),
      competition_id: meetMode === "catalog" ? competitionId || null : null,
      meet_name:
        meetMode === "catalog"
          ? (competitions.find((c) => c.id === competitionId)?.name ?? null)
          : meetOther.trim() || null,
      stage,
      ...date,
      is_pb: isPb,
      is_ub: stage === "university" && isUb,
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
        <div data-ui-group="segmented" className="flex rounded-xl bg-separator/50 p-0.5">
          {(Object.keys(STAGE_LABEL) as RecordStage[]).map((key) => (
            <button data-ui-action
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
        <select data-ui-field
          aria-label="種目"
          className={selectClass}
          value={eventChoice}
          onChange={(e) => chooseEvent(e.target.value)}
        >
          <option value="">種目を選択</option>
          {events.map((e) => (
            <option key={e.name}>{e.name}</option>
          ))}
          {eventChoice && eventChoice !== OTHER && !known(eventChoice) && (
            <option value={eventChoice}>{eventChoice}</option>
          )}
          <option value={OTHER}>その他（自由入力）</option>
        </select>
        {eventChoice === OTHER && (
          <div className="mt-2 space-y-3">
            <Input
              aria-label="種目名"
              maxLength={50}
              placeholder="例: 2000mSC"
              value={eventOther}
              onChange={(e) => setEventOther(e.target.value)}
            />
            <label className="block space-y-1.5">
              <span className="section-label">記録の入力形式</span>
              <select data-ui-field
                aria-label="記録の入力形式"
                className={selectClass}
                value={recordFormat}
                onChange={(e) => {
                  const format = e.target.value as ResultInputFormat;
                  if (changeFormat(format)) setOtherFormat(format);
                }}
              >
                <option value="seconds">秒（例: 12.34）</option>
                <option value="minutes">分・秒（例: 15分32.40秒）</option>
                <option value="hours">時・分・秒（例: 1時間10分30秒）</option>
                <option value="meters">メートル（例: 6.85m）</option>
                <option value="points">得点（例: 5432点）</option>
              </select>
            </label>
            {measure !== "points" && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-accent"
                  checked={windEnabled}
                  onChange={(e) => {
                    setWindEnabled(e.target.checked);
                    setOtherWindEnabled(e.target.checked);
                  }}
                />
                風速を入力する
              </label>
            )}
          </div>
        )}
      </div>

      {eventChoice && <div>
        <p className="section-label mb-1.5">記録</p>
        <select data-ui-field
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
            {recordFormat === "hours" && (
              <NumberField label="時" value={hours} onChange={setHours} max={5965} />
            )}
            {recordFormat !== "seconds" && (
              <NumberField label="分" value={minutes} onChange={setMinutes} max={recordFormat === "hours" ? 59 : 357913} />
            )}
            <DecimalField
              label="秒"
              placeholder={timeFormat === "seconds" ? "61.85" : "32.40"}
              value={seconds}
              onChange={setSeconds}
            />
          </div>
        )}
        {status === "ok" && measure === "distance" && (
          <div className="mt-2 flex items-end gap-2">
            <DecimalField label={distanceLabel} placeholder={distanceLabel === "高さ（m）" ? "1.80" : "6.85"} value={metres} onChange={setMetres} />
          </div>
        )}
        {status === "ok" && measure === "points" && (
          <div className="mt-2">
            <NumberField label="点" value={points} onChange={setPoints} max={99999} />
          </div>
        )}
        {status === "ok" && showWind && (
          <fieldset className="mt-2 min-w-0 space-y-2">
            <legend className="text-caption">風速（任意）</legend>
            <div data-ui-group className="grid grid-cols-2 gap-2">
              {([
                { value: "tailwind", label: "＋ 追い風" },
                { value: "headwind", label: "− 向かい風" },
              ] as const).map((item) => (
                <button data-ui-action
                  key={item.value}
                  type="button"
                  aria-pressed={windDirection === item.value}
                  onClick={() => setWindDirection(item.value)}
                  className={cn(
                    "min-h-11 rounded-xl border px-3 py-2 text-[13px] font-semibold pressable",
                    windDirection === item.value
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-separator bg-card text-muted",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <span aria-hidden="true" className="w-4 shrink-0 text-center tabular-nums">
                {windDirection === "headwind" ? "−" : "＋"}
              </span>
              <Input
                aria-label="風速（m/s）"
                inputMode="decimal"
                placeholder="1.2"
                value={wind}
                onChange={(e) => {
                  // 符号はボタンで選べる。PC入力・貼り付けの符号も受け取る。
                  const next = e.target.value.normalize("NFKC").replace(/−/g, "-").trim();
                  if (!/^[+-]?\d*(?:\.\d*)?$/.test(next)) return;
                  if (next.startsWith("-")) setWindDirection("headwind");
                  if (next.startsWith("+")) setWindDirection("tailwind");
                  setWind(next.replace(/^[+-]/, ""));
                }}
              />
              <span aria-hidden="true" className="shrink-0 text-caption">m/s</span>
            </label>
          </fieldset>
        )}
      </div>}

      <div>
        <p className="section-label mb-1.5">大会</p>
        <div data-ui-group="segmented" className="flex rounded-xl bg-separator/50 p-0.5">
          {(
            [
              { value: "catalog", label: "大会から選ぶ" },
              { value: "other", label: "自由入力" },
            ] as const
          ).map((item) => (
            <button data-ui-action
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
            <select data-ui-field
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
            {(() => {
              const chosen = competitions.find((c) => c.id === competitionId);
              const days = chosen ? competitionDays(chosen.starts_on, chosen.ends_on) : [];
              if (stage !== "university" || days.length < 2) {
                return <p className="mt-1 text-caption">選ぶと記録日に大会の初日が入ります。</p>;
              }
              // 複数日の大会は何日目の記録かを選ぶ
              return (
                <div className="mt-2">
                  <p className="text-caption">何日目の記録ですか</p>
                  <div data-ui-group className="mt-1.5 flex flex-wrap gap-2">
                    {days.map((day, i) => {
                      const active = precision === "day" && recordedOn === day;
                      return (
                        <button data-ui-action
                          key={day}
                          type="button"
                          aria-pressed={active}
                          onClick={() => { setRecordedOn(day); setPrecision("day"); }}
                          className={cn(
                            "inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-xl border px-3 py-2 text-[14px] font-semibold pressable",
                            active ? "border-accent bg-accent/10 text-accent" : "border-separator bg-card",
                          )}
                        >
                          <span>{i + 1}日目</span><span className="text-caption tabular-nums">{Number(day.slice(5, 7))}/{Number(day.slice(8, 10))}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
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
          <select data-ui-field
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
      {/* UB は大学の記録に対する印なので、高校以前には出さない。 */}
      {stage === "university" && (
        <Toggle
          label="UB（大学ベスト）として記録"
          checked={isUb}
          onChange={() => setIsUb((v) => !v)}
        />
      )}
      <Toggle
        label="公認記録"
        checked={isOfficial}
        onChange={() => setIsOfficial((v) => !v)}
      />
      <p className="text-caption">
        PB・UB は種目ごとに1件だけ付きます。新しく付けると、同じ種目の前の記録からは外れます。UBは大学の記録だけに付きます。
      </p>

      {error && <p role="alert" className="text-caption text-danger text-center">{error}</p>}
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
