"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar } from "@/components/common/Avatar";
import { BLOCKS, BLOCK_ORDER, GRADE_OPTIONS, gradeShort } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Attendee, Block } from "@/types";

/** 所属ブロック→学年→名前の順に並べる（見やすさのため） */
function sortAttendees(list: Attendee[]): Attendee[] {
  const blockIdx = (a: Attendee) => {
    const i = BLOCK_ORDER.indexOf(a.profile.blocks?.[0]);
    return i < 0 ? 99 : i;
  };
  const gradeIdx = (a: Attendee) => {
    const i = GRADE_OPTIONS.findIndex((g) => g.value === a.profile.grade);
    return i < 0 ? 99 : i;
  };
  return [...list].sort(
    (a, b) =>
      blockIdx(a) - blockIdx(b) ||
      gradeIdx(a) - gradeIdx(b) ||
      (a.profile.display_name || "").localeCompare(b.profile.display_name || "", "ja"),
  );
}

/** 「出席◯」表示。タップで出席者・欠席者一覧 */
export function AttendeesButton({
  attendees,
  viewerBlocks,
  showAllBlocks = false,
}: {
  attendees: Attendee[];
  viewerBlocks: Block[];
  showAllBlocks?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const visible = showAllBlocks
    ? attendees
    : attendees.filter((attendee) =>
        attendee.profile.blocks?.some((block) => viewerBlocks.includes(block)),
      );
  const present = sortAttendees(visible.filter((a) => a.status === "present"));
  const absent = sortAttendees(visible.filter((a) => a.status === "absent"));

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-bg border border-separator text-[13px] font-semibold text-muted2 active:opacity-60 shrink-0"
      >
        <Users size={15} />
        {/* 0でも消さず常に表示。数字は等幅＋2桁ぶんの固定幅で桁が増えてもガクつかない。 */}
        <span className="text-success">
          出席 <span className="inline-block min-w-[2ch] text-right tabular-nums">{present.length}</span>
        </span>
        <span className="text-danger">
          欠席 <span className="inline-block min-w-[2ch] text-right tabular-nums">{absent.length}</span>
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="出欠">
          <div className="pb-4 space-y-4 max-h-[60vh] overflow-y-auto">
            <Group title={`出席 ${present.length}`} color="#34c759" list={present} />
            {absent.length > 0 && <Group title={`欠席 ${absent.length}`} color="#ff3b30" list={absent} />}
            {visible.length === 0 && (
              <p className="text-caption text-center py-6">まだ誰も出欠を登録していません</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Group({ title, color, list }: { title: string; color: string; list: Attendee[] }) {
  if (list.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="section-label" style={{ color }}>{title}</p>
      {BLOCK_ORDER.map((block) => {
        const blockMembers = list.filter((attendee) => attendee.profile.blocks?.[0] === block);
        if (blockMembers.length === 0) return null;
        return (
          <div key={block} className="rounded-xl bg-bg/60 px-3 py-2">
            <p className="text-[12px] font-semibold" style={{ color: BLOCKS[block].color }}>
              {BLOCKS[block].label}
            </p>
            {[...GRADE_OPTIONS.map((grade) => grade.value), null].map((grade) => {
              const gradeMembers = blockMembers.filter((attendee) => attendee.profile.grade === grade);
              if (gradeMembers.length === 0) return null;
              return (
                <div key={grade ?? "unset"} className="mt-2">
                  <p className="text-[10px] font-semibold tracking-wide text-muted2">{gradeShort(grade) ?? "—"}</p>
                  <div className="divide-y divide-separator/60">
                    {gradeMembers.map((attendee) => (
                      <div key={attendee.user_id} className="flex min-h-10 items-center gap-2.5 py-1.5">
                        <Avatar name={attendee.profile.display_name} blocks={attendee.profile.blocks} avatarUrl={attendee.profile.avatar_url} size="sm" />
                        <span className={cn("min-w-0 flex-1 truncate text-[14px] font-semibold", attendee.is_late && "text-warning")}>
                          {attendee.profile.display_name || "名無し"}
                        </span>
                        {attendee.is_late && attendee.late_note && (
                          <span className="max-w-[45%] truncate text-[12px] text-muted2">{attendee.late_note}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
