"use client";

import { INTENSITY_ORDER, INTENSITY_LABELS } from "@/lib/constants";
import type { Intensity } from "@/types";

export type IntensityValues = Record<Intensity, string>;

/** 強度別距離入力（4フィールド・km） */
export function IntensityInput({
  values,
  onChange,
}: {
  values: IntensityValues;
  onChange: (v: IntensityValues) => void;
}) {
  const total = INTENSITY_ORDER.reduce(
    (sum, k) => sum + (parseFloat(values[k]) || 0),
    0,
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {INTENSITY_ORDER.map((key) => {
          const meta = INTENSITY_LABELS[key];
          return (
            <div
              key={key}
              className="rounded-xl bg-card border border-separator p-2.5"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                <span className="text-[12px] font-semibold">{meta.label}</span>
                <span className="text-micro">{meta.sub}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  placeholder="0"
                  value={values[key]}
                  onChange={(e) =>
                    onChange({ ...values, [key]: e.target.value })
                  }
                  className="w-full text-right text-[20px] font-bold tabular-nums outline-none bg-transparent"
                />
                <span className="text-caption">km</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between items-baseline px-1">
        <span className="section-label">合計</span>
        <span className="text-headline">
          {Math.round(total * 10) / 10}
          <span className="text-caption ml-0.5">km</span>
        </span>
      </div>
    </div>
  );
}
