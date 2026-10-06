// GAS Web App への HTTP 呼び出し（読み書きの入口）。
// シートとの通信はすべてこのモジュールを通す。

import { fetchPublicMember, fetchPublicMemberSnapshot, fetchPublicSheetMembers, type RawMember, type SheetMember } from "@/lib/sheet-public-csv";
import { fetchGasResponse } from "./gas-http";

// ── 設定 / GAS 呼び出し ──────────────────────────────────────────────────────
export function gasConfig() {
  const url = process.env.SHEET_SYNC_GAS_URL;
  const secret = process.env.SHEET_SYNC_SECRET ?? "";
  if (!url) throw new Error("SHEET_SYNC_GAS_URL is not configured");
  return { url, secret };
}


export async function gasPost<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const { url, secret } = gasConfig();
  const res = await fetchGasResponse(url, JSON.stringify({ ...body, secret }), signal);
  const result = await readGasJson<T>(res);
  if (["writeCells", "writeReply", "deleteReply", "writeMiddleLongMenu"].includes(String(body.action))
    && (result as { success?: boolean }).success !== true) {
    throw new Error("スプレッドシートへの書き込み完了を確認できませんでした。送信結果を確認するまで再送を保留してください。");
  }
  return result;
}

// 本文・認証情報をエラーへ含めず、HTTP状態と応答形式だけを知らせる。
export async function readGasJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: T & { error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `スプレッドシートから正常な応答を受け取れませんでした（HTTP ${res.status}・${/^\s*</.test(text) ? "HTML" : "JSON以外"}）。公開設定の不備とは限らないため、送信結果を確認してください。`,
    );
  }
  if (!res.ok) throw new Error(`スプレッドシートとの通信に失敗しました（HTTP ${res.status}・JSON）。送信結果を確認してください。`);
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("スプレッドシートの応答形式が不正です。送信結果を確認してください。");
  if (json.error) throw new Error(`GASエラー: ${json.error}`);
  return json;
}

/** アプリのコメントを、その人のスプシ当日行の右側（列名なし列）にリプライとして書く */
export async function writeSheetReply(
  memberName: string,
  date: string,
  text: string,
  sourceId?: string,
  spreadsheetId?: string,
): Promise<number | null> {
  const result = await gasPost<{ success?: boolean; col?: number }>({
    action: "writeReply",
    spreadsheetId,
    memberName,
    date,
    text,
    sourceId,
  });
  return result.success && Number.isInteger(result.col) ? Number(result.col) - 1 : null;
}


export type MiddleLongMenuSheetWrite = {
  content: string;
  pace: string;
  remark: string;
  supplement: string;
};

/** 中長距離の月別メニュー行（E:H）をGAS経由で更新する。 */
export async function writeMiddleLongMenuToSheet(
  date: string,
  menu: MiddleLongMenuSheetWrite,
): Promise<{ success: boolean; sheet: string; row: number }> {
  return gasPost({
    action: "writeMiddleLongMenu",
    date,
    content: menu.content,
    pace: menu.pace,
    remark: menu.remark,
    supplement: menu.supplement,
  });
}
/** プロフィール選択用：部員シート名一覧 */

export async function fetchSheetMembers(spreadsheetId?: string): Promise<SheetMember[]> {
  return fetchPublicSheetMembers(spreadsheetId);
}

export type ProtectedFetchResult = {
  members: RawMember[];
  failedMembers: { member: string; reason: string }[];
  unchangedMembers: string[];
  signatures: Map<string, string>;
};

export type MemberFetchInput = {
  name: string;
  previousSignature: string | null;
  forceParse: boolean;
};

/**
 * 公開CSVを少数並列で取得する。失敗したタブを空データとして扱わず、
 * 他の部員だけ同期を継続しつつ failedMembers に残す。
 */
export async function fetchAllRaw(inputs: MemberFetchInput[], spreadsheetId?: string): Promise<ProtectedFetchResult> {
  const allMembers = await fetchSheetMembers(spreadsheetId);
  const byName = new Map(allMembers.map((member) => [member.name.normalize("NFC").trim(), member]));
  const inputByName = new Map(inputs.map((input) => [input.name.normalize("NFC").trim(), input]));
  const requested = [...inputByName.keys()];
  const sheetMembers = requested.flatMap((name) => {
    const member = byName.get(name);
    return member ? [member] : [];
  });
  const members: RawMember[] = [];
  const unchangedMembers: string[] = [];
  const signatures = new Map<string, string>();
  const foundNames = new Set(sheetMembers.map((member) => member.name.normalize("NFC").trim()));
  const failedMembers: { member: string; reason: string }[] = requested
    .filter((name) => !foundNames.has(name))
    .map((member) => ({ member, reason: "公開シートに部員タブが見つかりません" }));
  const configuredConcurrency = Number.parseInt(process.env.SHEET_SYNC_CONCURRENCY ?? "4", 10);
  const concurrency = Number.isFinite(configuredConcurrency)
    ? Math.min(8, Math.max(1, configuredConcurrency))
    : 4;

  for (let index = 0; index < sheetMembers.length; index += concurrency) {
    const batch = sheetMembers.slice(index, index + concurrency);
    const fetched = await Promise.allSettled(
      batch.map(async (member) => {
        const input = inputByName.get(member.name.normalize("NFC").trim());
        return fetchPublicMemberSnapshot(member.name, {
          timeoutMs: 15_000,
          members: allMembers,
          spreadsheetId,
          expectedSignature: input?.previousSignature,
          forceParse: input?.forceParse,
        });
      }),
    );
    fetched.forEach((item, batchIndex) => {
      if (item.status === "fulfilled") {
        signatures.set(batch[batchIndex].name.trim(), item.value.signature);
        if (item.value.member) members.push(item.value.member);
        else unchangedMembers.push(batch[batchIndex].name.trim());
      } else {
        failedMembers.push({
          member: batch[batchIndex].name,
          reason: item.reason instanceof Error ? item.reason.message : "公開CSVを取得できませんでした",
        });
      }
    });
  }

  return {
    members: members.sort((a, b) => a.name.localeCompare(b.name)),
    failedMembers,
    unchangedMembers: unchangedMembers.sort((a, b) => a.localeCompare(b)),
    signatures,
  };
}

/** 部員1人だけを軽量取得（write-through保存直後の確認・個人の記録画面用） */
export async function fetchMemberRaw(
  memberName: string,
  opts: { timeoutMs?: number; spreadsheetId?: string } = {},
): Promise<RawMember> {
  return fetchPublicMember(memberName, opts);
}
