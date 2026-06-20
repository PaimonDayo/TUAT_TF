"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { gradeShort } from "@/lib/constants";
import type { Attendee } from "@/types";

/** 「参加◯」表示。タップで出席者・欠席者一覧 */
export function AttendeesButton({ attendees }: { attendees: Attendee[] }) {
  const [open, setOpen] = useState(false);
  const present = attendees.filter((a) => a.status === "present");
  const absent = attendees.filter((a) => a.status === "absent");

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
        {/* 0でも消さず常に表示（消えると枠が縮んでガクつくため）。数字は等幅。 */}
        <span className="text-success tabular-nums">参加 {present.length}</span>
        <span className="text-danger tabular-nums">欠席 {absent.length}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="出欠">
          <div className="pb-4 space-y-4 max-h-[60vh] overflow-y-auto">
            <Group title={`出席 ${present.length}`} color="#34c759" list={present} />
            {absent.length > 0 && <Group title={`欠席 ${absent.length}`} color="#ff3b30" list={absent} />}
            {attendees.length === 0 && (
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
    <div className="space-y-2">
      <p className="section-label" style={{ color }}>{title}</p>
      <div className="space-y-2">
        {list.map((a) => (
          <div key={a.user_id} className="flex items-center gap-2.5">
            <Avatar
              name={a.profile.display_name}
              blocks={a.profile.blocks}
              avatarUrl={a.profile.avatar_url}
              size="sm"
            />
            <span className="text-[14px] font-semibold">{a.profile.display_name || "名無し"}</span>
            <BlockPills blocks={a.profile.blocks} />
            {gradeShort(a.profile.grade) && (
              <span className="text-micro">{gradeShort(a.profile.grade)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
