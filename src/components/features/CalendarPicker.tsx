"use client";

import { useState } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  addMonths,
  isSameMonth,
  isSameDay,
  isToday,
} from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WD = ["日", "月", "火", "水", "木", "金", "土"];

/** 月カレンダーで日付を1つ選択する */
export function CalendarPicker({
  value,
  onChange,
}: {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
}) {
  const selected = value ? new Date(value + "T00:00:00") : new Date();
  const [cursor, setCursor] = useState(startOfMonth(selected));

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor)),
    end: endOfWeek(endOfMonth(cursor)),
  });

  return (
    <div className="rounded-xl bg-card border border-separator p-3">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, -1))}
          className="h-8 w-8 flex items-center justify-center text-accent active:opacity-50"
          aria-label="前の月"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-headline">
          {format(cursor, "yyyy年 M月", { locale: ja })}
        </span>
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, 1))}
          className="h-8 w-8 flex items-center justify-center text-accent active:opacity-50"
          aria-label="次の月"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WD.map((w, i) => (
          <div
            key={w}
            className="text-center text-[11px] font-semibold py-1"
            style={{ color: i === 0 ? "#ff3b30" : i === 6 ? "#007aff" : "#8e8e93" }}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day) => {
          const inMonth = isSameMonth(day, cursor);
          const isSelected = isSameDay(day, selected);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onChange(format(day, "yyyy-MM-dd"))}
              className="flex items-center justify-center py-0.5"
            >
              <span
                className={[
                  "h-9 w-9 flex items-center justify-center rounded-full text-[15px] tabular-nums",
                  isSelected
                    ? "bg-accent text-white font-bold"
                    : isToday(day)
                      ? "text-accent font-bold"
                      : inMonth
                        ? "text-ink"
                        : "text-faint",
                ].join(" ")}
              >
                {format(day, "d")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
