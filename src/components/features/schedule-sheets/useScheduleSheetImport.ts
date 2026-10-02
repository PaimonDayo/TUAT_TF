import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { getCurrentUserId } from "@/lib/supabase/client-auth";
import { createClient } from "@/lib/supabase/client";
import { jstToday } from "@/lib/date";
import { INITIAL_WEEKDAY_DEFAULTS, createExistingRows, createTemplateRows, toRpcRow } from "./schedule-sheet-data";
import type { PracticeSchedule, ScheduleImportEditableRow, ScheduleImportPreview, ScheduleSheetBlock, ScheduleSheetKind, VenueRow } from "@/types";

/** 予定シートの取得・下書き・確認・反映。呼出元のマウントごとに1つだけ使う。 */
export function useScheduleSheetImport() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [kind, setKind] = useState<ScheduleSheetKind>("practice");
  const [block, setBlock] = useState<ScheduleSheetBlock>("all");
  const [inputMode, setInputMode] = useState<"new" | "edit">("new");
  const [existing, setExisting] = useState<PracticeSchedule[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [weekdayDefaults, setWeekdayDefaults] = useState(
    INITIAL_WEEKDAY_DEFAULTS,
  );
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [source, setSource] = useState<"url" | "file">("url");
  const [sheetUrl, setSheetUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScheduleImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastApplied, setLastApplied] = useState<PracticeSchedule[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [deletionIds, setDeletionIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/google/status")
      .then((response) => response.json())
      .then((status) => {
        if (!active) return;
        setGoogleConnected(!!status.connected);
        setGoogleEmail(status.email ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase
      .from("venues")
      .select("*")
      .order("sort", { ascending: true })
      .then(({ data }) => {
        if (active) setVenues((data ?? []) as VenueRow[]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    let query = supabase
      .from("practice_schedules")
      .select("*")
      .eq("schedule_type", kind)
      .order("schedule_date", { ascending: true });
    if (kind === "practice") {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const nextMonth =
        month === 12
          ? `${year + 1}-01-01`
          : `${year}-${String(month + 1).padStart(2, "0")}-01`;
      query = query.gte("schedule_date", start).lt("schedule_date", nextMonth);
    } else {
      query = query.gte("schedule_date", jstToday());
    }
    void query.then(({ data }) => {
      if (!active) return;
      const targetBlocks = block === "all" ? [] : [block];
      const filteredExisting = ((data ?? []) as PracticeSchedule[]).filter(
        (schedule) =>
          [...(schedule.target_blocks ?? [])].sort().join(",") ===
          [...targetBlocks].sort().join(","),
      );
      setExisting(filteredExisting);
      // 既存を編集は「全選択スタート」。必要な人だけ外す運用にする。
      setSelectedIds(filteredExisting.map((schedule) => schedule.id));
    });
    return () => {
      active = false;
    };
  }, [block, kind, month, year]);

  function downloadTemplate() {
    const selected = existing.filter((schedule) => selectedIds.includes(schedule.id));
    const rows =
      inputMode === "edit"
        ? createExistingRows(selected, kind, block)
        : createTemplateRows(year, month, kind, block);
    const content = `\uFEFF${Papa.unparse(rows)}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      kind === "practice"
        ? `${year}-${String(month).padStart(2, "0")}-practice-${block}.csv`
        : `${kind}-${block}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function issueSpreadsheet() {
    if (inputMode === "edit" && selectedIds.length === 0) {
      setError("編集する予定を選択してください");
      return;
    }
    setIssuing(true);
    setError(null);
    const popup = window.open("", "_blank");
    const response = await fetch("/api/google/sheets/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        block,
        year: kind === "practice" ? year : undefined,
        month: kind === "practice" ? month : undefined,
        scheduleIds: inputMode === "edit" ? selectedIds : [],
        weekdayDefaults:
          kind === "practice" && inputMode === "new"
            ? weekdayDefaults.filter((item) => item.time || item.venueName)
            : [],
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      popup?.close();
      setError(result.error ?? "スプレッドシートを作れませんでした");
      setIssuing(false);
      return;
    }
    setSheetUrl(result.url);
    setSheetId(result.id);
    setSource("url");
    setPreview(null);
    setIssuing(false);
    if (popup) popup.location.href = result.url;
  }

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setSheetId(null);
    setPreview(null);
    setError(null);
  }

  async function previewImport() {
    if (source === "url" && !sheetUrl.trim()) {
      setError("Googleスプレッドシートの共有URLを入力してください");
      return;
    }
    if (source === "file" && !csv) {
      setError("CSVファイルを選択してください");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const userId = await getCurrentUserId(supabase);
    if (!userId) {
      setLoading(false);
      return;
    }

    let targetSheetId = sheetId;
    if (!targetSheetId) {
      const { data, error: createError } = await supabase
        .from("schedule_sheets")
        .insert({
          author_id: userId,
          target_year: kind === "practice" ? year : null,
          target_month: kind === "practice" ? month : null,
          kind,
          target_block: block,
          sheet_url:
            source === "url"
              ? sheetUrl.trim()
              : `csv-upload://${fileName || "schedule.csv"}`,
          csv_url: source === "url" ? sheetUrl.trim() : null,
        })
        .select("id")
        .single();
      if (createError || !data) {
        setError("CSVの確認を開始できませんでした");
        setLoading(false);
        return;
      }
      targetSheetId = data.id as string;
      setSheetId(targetSheetId);
    }

    const response = await fetch("/api/schedule-sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: targetSheetId,
        csv: source === "file" ? csv : undefined,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "CSVを確認できませんでした");
      setLoading(false);
      return;
    }
    setPreview(result as ScheduleImportPreview);
    setDeletionIds((result as ScheduleImportPreview).deletions.map((row) => row.id));
    setLoading(false);
  }

  async function apply() {
    if (!preview || !sheetId || applying) return;
    setApplying(true);
    setError(null);
    const validated = await validateEditedRows(preview.rows);
    if (!validated) {
      setApplying(false);
      return;
    }
    const validRows = [...validated.additions, ...validated.updates];
    if (validRows.length === 0) {
      setPreview(validated);
      setApplying(false);
      return;
    }
    const rows = validRows.map(toRpcRow);
    const supabase = createClient();
    const beforeApply = new Date().toISOString();
    const { error: applyError } = await supabase.rpc("apply_schedule_sheet_import", {
      target_sheet_id: sheetId,
      import_rows: rows,
    });
    if (applyError) {
      setError("予定に登録できませんでした");
      setApplying(false);
      return;
    }
    // 直前の取込で新規追加された予定を控えておき、誤登録時にすぐ取り消せるようにする
    const { data: insertedData } = await supabase
      .from("practice_schedules")
      .select("*")
      .eq("source_sheet_id", sheetId)
      .gte("created_at", beforeApply);
    setLastApplied((insertedData ?? []) as PracticeSchedule[]);
    router.refresh();
    const remaining = validated.rows.filter((row) => row.status === "error");
    if (remaining.length > 0) {
      setPreview({
        ...validated,
        rows: remaining,
        additions: [],
        updates: [],
        deletions: [],
      });
    } else {
      setPreview(null);
      setCsv("");
      setFileName("");
      setSheetUrl("");
      setSheetId(null);
    }
    setApplying(false);
  }

  async function undoLastApply() {
    if (lastApplied.length === 0 || undoing) return;
    setUndoing(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("practice_schedules")
      .delete()
      .in("id", lastApplied.map((schedule) => schedule.id));
    if (deleteError) {
      setError("取り消せませんでした。もう一度お試しください");
      setUndoing(false);
      return;
    }
    setLastApplied([]);
    router.refresh();
    setUndoing(false);
  }

  async function deleteSelectedCandidates() {
    if (deletionIds.length === 0 || deleting) return;
    setDeleting(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("practice_schedules")
      .delete()
      .in("id", deletionIds);
    if (deleteError) {
      setError("削除できませんでした。もう一度お試しください");
      setDeleting(false);
      return;
    }
    setPreview((current) =>
      current
        ? {
            ...current,
            deletions: current.deletions.filter((row) => !deletionIds.includes(row.id)),
          }
        : current,
    );
    setDeletionIds([]);
    router.refresh();
    setDeleting(false);
  }

  async function validateEditedRows(
    rows: ScheduleImportEditableRow[],
  ): Promise<ScheduleImportPreview | null> {
    if (!sheetId) return null;
    setLoading(true);
    setError(null);
    const response = await fetch("/api/schedule-sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId,
        rows: rows.map(({ rowNumber, values }) => ({ rowNumber, values })),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "入力内容を再確認できませんでした");
      setLoading(false);
      return null;
    }
    const next = {
      ...(result as ScheduleImportPreview),
      deletions: preview?.deletions ?? [],
    };
    setPreview(next);
    setLoading(false);
    return next;
  }

  function updatePreviewCell(rowNumber: number, column: string, value: string) {
    setPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) =>
          row.rowNumber === rowNumber
            ? {
                ...row,
                values: { ...row.values, [column]: value },
                status: "editing",
                message: "未確認の変更があります",
                normalized: null,
              }
            : row,
        ),
      };
    });
  }

  const applicable = preview
    ? preview.rows.filter(
        (row) => row.status === "addition" || row.status === "update",
      ).length
    : 0;
  const errorCount = preview
    ? preview.rows.filter((row) => row.status === "error").length
    : 0;
  const dirtyCount = preview
    ? preview.rows.filter((row) => row.status === "editing").length
    : 0;

  return {
    year, setYear, month, setMonth, kind,
    setKind, block, setBlock, inputMode, setInputMode,
    existing, selectedIds, setSelectedIds, venues, weekdayDefaults,
    googleConnected, googleEmail, issuing, source, setSource,
    sheetUrl, setSheetUrl, fileName, csv, setSheetId,
    preview, setPreview, loading, applying, error,
    setError, lastApplied, undoing, deletionIds, setDeletionIds,
    deleting, downloadTemplate, issueSpreadsheet, selectFile, previewImport,
    apply, undoLastApply, deleteSelectedCandidates, validateEditedRows, updatePreviewCell,
    applicable, errorCount, dirtyCount, updateWeekdayDefault,
  };

  function updateWeekdayDefault(
    weekday: number,
    field: "time" | "venueName",
    value: string,
  ) {
    setWeekdayDefaults((items) =>
      items.map((item) =>
        item.weekday === weekday ? { ...item, [field]: value } : item,
      ),
    );
  }
}
