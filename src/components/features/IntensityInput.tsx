"use client";

import { INTENSITY_ORDER, INTENSITY_LABELS } from "@/lib/constants";
import type { Intensity } from "@/types";

export type IntensityValues = Record<Intensity, string>;

/** 強度別距離入力（4フィールド・km） */
export function IntensityInput({
  values,
  onChange,
  visible,
}: {
  values: IntensityValues;
  onChange: (values: IntensityValues) => void;
  visible?: Intensity[];
}) {
  const keys = visible ?? INTENSITY_ORDER;
  const total = keys.reduce((sum, key) => sum + (parseFloat(values[key]) || 0), 0);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {keys.map((key) => {
          const meta = INTENSITY_LABELS[key];
          return <div key={key} className="rounded-xl border border-separator bg-card p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
              <span className="text-[12px] font-semibold">{meta.label}</span>
              <span className="text-micro">{meta.sub}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <input type="number" inputMode="decimal" min={0} step="0.1" placeholder="0" value={values[key]} onChange={(event) => onChange({ ...values, [key]: event.target.value })} className="w-full bg-transparent text-right text-[20px] font-bold tabular-nums outline-none" />
              <span className="text-caption">km</span>
            </div>
          </div>;
        })}
      </div>
      <div className="flex items-baseline justify-between px-1">
        <span className="section-label">合計</span>
        <span className="text-headline">{Math.round(total * 10) / 10}<span className="ml-0.5 text-caption">km</span></span>
      </div>
    </div>
  );
}