import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { PracticeSchedule, ScheduleType } from "@/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/components/features/ScheduleSheetsManager", () => ({ ScheduleSheetsManager: () => null }));

import { ScheduleForm } from "./ScheduleForm";

describe("予定の集合時間入力", () => {
  it.each<ScheduleType>(["practice", "meet", "time_trial"])("新規の%sでも時刻を入力・クリアできる", (type) => {
    const html = renderToStaticMarkup(createElement(ScheduleForm, { initialType: type, onDone: () => {} }));
    expect(html).toMatch(/type="time"[^>]*aria-label="集合時間"[^>]*value=""/);
    expect(html).toContain('aria-label="集合時間をクリア"');
  });

  it.each<ScheduleType>(["meet", "time_trial"])("%sの保存済み集合時間を再編集できる", (type) => {
    const schedule = { id: "existing", schedule_type: type, meeting_time: "07:35:00", schedule_date: "2026-10-25", title: "大会" } as PracticeSchedule;
    const html = renderToStaticMarkup(createElement(ScheduleForm, { schedule, onDone: () => {} }));
    expect(html).toMatch(/type="time"[^>]*aria-label="集合時間"[^>]*value="07:35"/);
    expect(html).toContain("更新する");
  });
});
