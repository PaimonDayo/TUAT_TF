import type { AppRole, AuthorMini, Block, Profile, RecordFieldDef, RecordWithAuthor, Role, TweetWithAuthor } from "@/types";
import type { Database, Json } from "@/types/database";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type PracticeRecordRow = Database["public"]["Tables"]["practice_records"]["Row"];
type TweetRow = Database["public"]["Tables"]["tweets"]["Row"];
type AuthorRow = Pick<
  ProfileRow,
  "id" | "display_name" | "avatar_url" | "blocks" | "grade"
> & Partial<Pick<ProfileRow, "record_source" | "record_fields">>;
const BLOCK_VALUES = new Set<Block>(["middle_long", "short", "jump", "throw"]);
const ROLE_VALUES = new Set<Role>(["admin", "menu_staff", "member"]);

export function recordFieldsFromJson(value: Json | null): RecordFieldDef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || Array.isArray(item) || typeof item !== "object") return [];
    const key = item.key;
    const label = item.label;
    const type = item.type;
    if (typeof key !== "string" || typeof label !== "string" || (type !== "text" && type !== "number")) {
      return [];
    }
    return [{
      key,
      label,
      type,
      ...(typeof item.hidden === "boolean" ? { hidden: item.hidden } : {}),
    } satisfies RecordFieldDef];
  });
}

export function recordFieldsToJson(fields: RecordFieldDef[]): Json {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    ...(typeof field.hidden === "boolean" ? { hidden: field.hidden } : {}),
  }));
}

export function profileRecordSource(value: string): "app" | "sheet" {
  return value === "sheet" ? "sheet" : "app";
}

export function normalizeAuthorRow(row: AuthorRow): AuthorMini {
  return {
    id: row.id,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    blocks: row.blocks.filter((block): block is Block => BLOCK_VALUES.has(block as Block)),
    grade: row.grade,
    record_source: profileRecordSource(row.record_source ?? "app"),
    record_fields: recordFieldsFromJson(row.record_fields ?? null),
  };
}

function recordValuesFromJson(value: Json): Record<string, string | number | null> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | null] =>
      entry[1] === null || typeof entry[1] === "string" || typeof entry[1] === "number"
    ),
  );
}

export function normalizeRecordWithAuthor(
  row: PracticeRecordRow & { author: AuthorRow },
): RecordWithAuthor {
  return {
    ...row,
    dist_low: row.dist_low ?? 0,
    dist_mid: row.dist_mid ?? 0,
    dist_high: row.dist_high ?? 0,
    dist_speed: row.dist_speed ?? 0,
    strides: row.strides ?? 0,
    condition:
      row.condition === "great" || row.condition === "normal" || row.condition === "bad"
        ? row.condition
        : null,
    custom: recordValuesFromJson(row.custom),
    author: normalizeAuthorRow(row.author),
  };
}

export function normalizeTweetWithAuthor(
  row: TweetRow & { author: AuthorRow },
): TweetWithAuthor {
  return {
    ...row,
    author: normalizeAuthorRow(row.author),
  };
}

export function normalizeProfileRow(row: ProfileRow, roles: AppRole[] = []): Profile {
  return {
    ...row,
    blocks: row.blocks.filter((block): block is Block => BLOCK_VALUES.has(block as Block)),
    role: ROLE_VALUES.has(row.role as Role) ? (row.role as Role) : "member",
    status: row.status === "graduated" ? "graduated" : "active",
    record_source: profileRecordSource(row.record_source ?? "app"),
    record_fields: recordFieldsFromJson(row.record_fields ?? null),
    roles,
  };
}
