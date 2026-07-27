import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind クラスを安全に結合する */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** イニシャル（表示名の先頭1文字）を返す */
export function initials(name: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed[0] : "?";
}

const KM_FORMATTER = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
  useGrouping: false,
});

/** 距離を小数第2位に丸める */
export function roundKm(km: number): number {
  return Math.round((km + Number.EPSILON) * 100) / 100;
}

/** 数値を小数第2位までのkm表記に整形（"12" / "12.5" / "12.34"） */
export function formatKm(km: number): string {
  return KM_FORMATTER.format(km);
}
