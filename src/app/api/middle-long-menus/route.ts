import { connection, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { permissionsOf } from "@/lib/permissions";
import { writeMiddleLongMenuToSheet } from "@/lib/sheet-sync";
import { fetchMiddleLongMenuSnapshot } from "@/lib/middle-long-menu-sheet";

export async function GET(request: Request) {
  await connection();
  try {
    const profile = await getCurrentProfile();
    const permissions = permissionsOf(profile.roles);
    if (!profile.blocks.includes("middle_long") && !profile.menu_view_all_blocks && !permissions.createMenu) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const months = [...new Set(
      (url.searchParams.get("months") ?? "")
        .split(",")
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 12),
    )].slice(0, 12);
    if (months.length === 0) {
      return NextResponse.json({ rows: [], loadedMonths: [] });
    }

    const snapshot = await fetchMiddleLongMenuSnapshot(months);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Failed to load middle-long menu CSV", error);
    return NextResponse.json(
      { error: "Failed to load middle-long menus" },
      { status: 500 },
    );
  }
}

const MAX_MENU_FIELD_LENGTH = 20_000;

export async function POST(request: Request) {
  await connection();
  try {
    const profile = await getCurrentProfile();
    if (!permissionsOf(profile.roles).createMenu) {
      return NextResponse.json({ error: "メニュー編集権限がありません" }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const scheduleId = typeof body.scheduleId === "string" ? body.scheduleId : "";
    if (!scheduleId) {
      return NextResponse.json({ error: "対象の予定が指定されていません" }, { status: 400 });
    }

    const fields = {
      content: typeof body.content === "string" ? body.content.trim() : "",
      pace: typeof body.pace === "string" ? body.pace.trim() : "",
      remark: typeof body.remark === "string" ? body.remark.trim() : "",
      supplement: typeof body.supplement === "string" ? body.supplement.trim() : "",
    };
    if (Object.values(fields).some((value) => value.length > MAX_MENU_FIELD_LENGTH)) {
      return NextResponse.json({ error: "入力内容が長すぎます" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: schedule, error: scheduleError } = await supabase
      .from("practice_schedules")
      .select("schedule_date, schedule_type")
      .eq("id", scheduleId)
      .maybeSingle();
    if (scheduleError || !schedule || schedule.schedule_type !== "practice") {
      return NextResponse.json({ error: "対象の練習予定が見つかりません" }, { status: 404 });
    }

    const result = await writeMiddleLongMenuToSheet(schedule.schedule_date, fields);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Failed to write middle-long menu", error);
    return NextResponse.json(
      { error: "スプレッドシートへメニューを保存できませんでした" },
      { status: 502 },
    );
  }
}
