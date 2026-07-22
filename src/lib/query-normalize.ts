import type {
  AppNotificationWithActor,
  NoteArticleWithAuthor,
  NoteEditPolicy,
  NoteScope,
  NoteStatus,
  NoteWithRelations,
  NotificationReferenceType,
  NotificationType,
  ThreadPostWithAuthor,
  ThreadWithAuthor,
} from "@/types";
import type { Database } from "@/types/database";
import { normalizeAuthorRow } from "@/lib/profile-normalize";

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables> = Tables[T]["Row"];
type AuthorInput = Parameters<typeof normalizeAuthorRow>[0];

type NoteQueryRow = Row<"notes"> & {
  author: AuthorInput;
  theme: Row<"note_themes"> | null;
  articles?: { id: string }[];
  editors?: { user_id: string; profile: AuthorInput | null }[];
};

const NOTE_SCOPES = new Set<NoteScope>(["shared", "personal"]);
const NOTE_STATUSES = new Set<NoteStatus>(["draft", "published"]);
const NOTE_POLICIES = new Set<NoteEditPolicy>(["everyone", "specified", "author"]);

export function normalizeNoteRow(row: NoteQueryRow): NoteWithRelations | null {
  if (
    !NOTE_SCOPES.has(row.scope as NoteScope) ||
    !NOTE_STATUSES.has(row.status as NoteStatus) ||
    !NOTE_POLICIES.has(row.edit_policy as NoteEditPolicy)
  ) {
    return null;
  }
  return {
    ...row,
    scope: row.scope as NoteScope,
    status: row.status as NoteStatus,
    edit_policy: row.edit_policy as NoteEditPolicy,
    author: normalizeAuthorRow(row.author),
    editors: row.editors?.map((editor) => ({
      user_id: editor.user_id,
      profile: editor.profile ? normalizeAuthorRow(editor.profile) : null,
    })),
  };
}

type ThreadQueryRow = Row<"threads"> & {
  author: AuthorInput;
  posts?: { id: string }[];
};

export function normalizeThreadRow(row: ThreadQueryRow): ThreadWithAuthor {
  return {
    ...row,
    author: normalizeAuthorRow(row.author),
  };
}

type ThreadPostQueryRow = Row<"thread_posts"> & { author: AuthorInput };

export function normalizeThreadPostRow(row: ThreadPostQueryRow): ThreadPostWithAuthor {
  return {
    ...row,
    author: normalizeAuthorRow(row.author),
  };
}

type NoteArticleQueryRow = Row<"note_articles"> & { author: AuthorInput };

export function normalizeNoteArticleRow(row: NoteArticleQueryRow): NoteArticleWithAuthor {
  return {
    ...row,
    author: normalizeAuthorRow(row.author),
  };
}

type NotificationActor = Pick<Row<"profiles">, "id" | "display_name" | "avatar_url">;
type NotificationQueryRow = Row<"notifications"> & { actor: NotificationActor | null };

const NOTIFICATION_TYPES = new Set<NotificationType>([
  "comment",
  "notice",
  "schedule_update",
  "sync_failure",
  "thread_reply",
]);
const REFERENCE_TYPES = new Set<NotificationReferenceType>([
  "record",
  "tweet",
  "schedule",
  "notice",
  "thread",
]);

export function normalizeNotificationRow(
  row: NotificationQueryRow,
): AppNotificationWithActor | null {
  if (!NOTIFICATION_TYPES.has(row.type as NotificationType)) return null;
  if (
    row.reference_type !== null &&
    !REFERENCE_TYPES.has(row.reference_type as NotificationReferenceType)
  ) {
    return null;
  }
  return {
    ...row,
    type: row.type as NotificationType,
    reference_type: row.reference_type as NotificationReferenceType | null,
  };
}


type ScheduleQueryRow = Row<"practice_schedules"> & {
  menus: Array<
    Row<"practice_menus"> & {
      author: { id: string; display_name: string } | null;
      targets: Array<
        Row<"practice_menu_targets"> & { profile: AuthorInput | null }
      >;
    }
  >;
  attendances?: Array<
    Pick<
      Row<"attendances">,
      "schedule_id" | "user_id" | "status" | "is_late" | "late_note"
    > & { profile: AuthorInput }
  >;
};

function normalizeBlock(value: string): import("@/types").Block | null {
  return value === "middle_long" || value === "short" || value === "jump" || value === "throw"
    ? value
    : null;
}

export function normalizeScheduleRow(
  row: ScheduleQueryRow,
): (import("@/types").ScheduleWithMenus & {
  attendances?: (import("@/types").Attendee & { schedule_id: string })[];
}) | null {
  const scheduleType =
    row.schedule_type === "practice" ||
    row.schedule_type === "meet" ||
    row.schedule_type === "event" ||
    row.schedule_type === "time_trial"
      ? row.schedule_type
      : null;
  if (!scheduleType) return null;

  const menus = row.menus.flatMap((menu) => {
    const targetBlock = menu.target_block === null ? null : normalizeBlock(menu.target_block);
    if (
      (menu.target_block !== null && targetBlock === null) ||
      (menu.status !== "draft" && menu.status !== "published")
    ) {
      return [];
    }
    return [{
      ...menu,
      target_block: targetBlock,
      status: menu.status as "draft" | "published",
      targets: menu.targets.map((target) => ({
        menu_id: target.menu_id,
        user_id: target.user_id,
        profile: target.profile ? normalizeAuthorRow(target.profile) : null,
      })),
    }];
  });

  const attendances = row.attendances?.flatMap((attendance) => {
    if (attendance.status !== "present" && attendance.status !== "absent") return [];
    return [{
      ...attendance,
      status: attendance.status as "present" | "absent",
      profile: normalizeAuthorRow(attendance.profile),
    }];
  });

  return {
    ...row,
    schedule_type: scheduleType,
    target_blocks: row.target_blocks.flatMap((block) => {
      const normalized = normalizeBlock(block);
      return normalized ? [normalized] : [];
    }),
    menus,
    attendances,
  };
}
