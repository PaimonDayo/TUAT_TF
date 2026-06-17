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

/** 数値を 0.1km 単位で整形（"12.5"） */
export function formatKm(km: number): string {
  return (Math.round(km * 10) / 10).toString();
}
