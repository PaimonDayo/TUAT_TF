import crypto from "node:crypto";
import fs from "node:fs";
import type {
  PracticeSchedule,
  ScheduleSheetBlock,
  ScheduleSheetKind,
  ScheduleSheetWeekdayDefault,
  VenueRow,
} from "@/types";
import { BLOCKS } from "@/lib/constants";
import { assertPcAppWriteAllowed } from "./pc-backup-status";

type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
};

export function getGoogleOAuthCredentials(): OAuthCredentials {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI;
  if (clientId && clientSecret && redirectUri) {
    return { clientId, clientSecret, redirectUri };
  }

  const path = process.env.GOOGLE_DRIVE_OAUTH_CREDENTIALS_PATH;
  if (!path) throw new Error("Google Drive OAuth credentials are not configured");
  const file = JSON.parse(fs.readFileSync(path, "utf8")) as {
    web?: {
      client_id: string;
      client_secret: string;
      redirect_uris: string[];
    };
  };
  if (!file.web) throw new Error("Web OAuth credentials are required");
  const localRedirect =
    file.web.redirect_uris.find((uri) => uri.startsWith("http://localhost")) ??
    file.web.redirect_uris[0];
  return {
    clientId: file.web.client_id,
    clientSecret: file.web.client_secret,
    redirectUri: localRedirect,
  };
}

function cryptoKey(): Buffer {
  const dedicatedKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (dedicatedKey) {
    if (!/^[0-9a-f]{64}$/i.test(dedicatedKey)) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a 32-byte hex key");
    return Buffer.from(dedicatedKey, "hex");
  }
  // Preserve existing ciphertext until the derived key is configured separately.
  return crypto
    .createHash("sha256")
    .update(process.env.SUPABASE_SERVICE_ROLE_KEY!)
    .digest();
}

export function encryptGoogleToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptGoogleToken(value: string): string {
  const [iv, tag, encrypted] = value.split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    cryptoKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function signGoogleOAuthState(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, expiresAt: Date.now() + 10 * 60 * 1000 }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", cryptoKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(state: string): { userId: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = crypto
    .createHmac("sha256", cryptoKey())
    .update(payload)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    userId: string;
    expiresAt: number;
  };
  return parsed.expiresAt >= Date.now() ? { userId: parsed.userId } : null;
}

export function googleAuthorizationUrl(userId: string): string {
  const credentials = getGoogleOAuthCredentials();
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: credentials.redirectUri,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signGoogleOAuthState(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code: string): Promise<TokenResponse> {
  const credentials = getGoogleOAuthCredentials();
  return googleTokenRequest({
    code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: credentials.redirectUri,
    grant_type: "authorization_code",
  });
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const credentials = getGoogleOAuthCredentials();
  return googleTokenRequest({
    refresh_token: refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "refresh_token",
  });
}

async function googleTokenRequest(
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!response.ok) {
    throw new Error(`Google token request failed: ${await response.text()}`);
  }
  return response.json() as Promise<TokenResponse>;
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { email?: string };
  return data.email ?? null;
}

export type CreatedSpreadsheet = { spreadsheetId: string; url: string };
export class SpreadsheetCreationError extends Error {
  readonly retryable = false;
  constructor(readonly outcome: "partial" | "unknown", readonly phase: "create" | "setup" | "record",
    readonly resource: CreatedSpreadsheet | null, readonly protection: boolean, options?: ErrorOptions) {
    super(resource ? "作成済みのスプレッドシートがあります。作り直さず、表示されたシートを確認してください。"
      : "作成結果を確認できませんでした。作り直さず、Google Driveで作成済みのシートを確認してください。", options);
  }
}

export type ScheduleSpreadsheetInput = {
  accessToken: string; title: string; kind: ScheduleSheetKind; year: number | null; month: number | null;
  block: ScheduleSheetBlock; venues: VenueRow[]; schedules: PracticeSchedule[]; weekdayDefaults: ScheduleSheetWeekdayDefault[];
  /** Must persist the returned identity before the second provider mutation. */
  onCreated: (resource: CreatedSpreadsheet) => Promise<void>;
};

function spreadsheetCreateBody(input: Omit<ScheduleSpreadsheetInput, "accessToken" | "onCreated">) {
  const values = buildSheetValues(input);
  return { properties: { title: input.title }, sheets: [{ properties: { title: "予定", gridProperties: {
    rowCount: Math.max(values.length + 20, 100), columnCount: values[0].length, frozenRowCount: 1,
  } }, data: [{ startRow: 0, startColumn: 0, rowData: values.map(toRowData) }] }] };
}

/** Hash the actual create body and formatting template, never token or raw rows. */
export function scheduleSpreadsheetFingerprint(input: Omit<ScheduleSpreadsheetInput, "accessToken" | "onCreated">): string {
  const create = spreadsheetCreateBody(input);
  return crypto.createHash("sha256").update(JSON.stringify({ version: 1, endpoint: "https://sheets.googleapis.com/v4/spreadsheets",
    spec: { kind: input.kind, block: input.block, year: input.year, month: input.month }, create,
    setup: sheetFormattingRequests({ sheetId: 0, kind: input.kind, rowCount: create.sheets[0].properties.gridProperties.rowCount, venues: input.venues }),
  })).digest("hex");
}

export async function createScheduleSpreadsheet({
  accessToken,
  title,
  kind,
  year,
  month,
  block,
  venues,
  schedules,
  weekdayDefaults,
  onCreated,
}: ScheduleSpreadsheetInput): Promise<CreatedSpreadsheet> {
  const values = buildSheetValues({
    kind,
    year,
    month,
    block,
    schedules,
    weekdayDefaults,
  });
  await assertPcAppWriteAllowed();
  if (typeof onCreated !== "function") throw new Error("Creation receipt is required");
  let createResponse: Response;
  try { createResponse = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: googleJsonHeaders(accessToken),
    body: JSON.stringify(spreadsheetCreateBody({ title, kind, year, month, block, venues, schedules, weekdayDefaults })),
  }); } catch (cause) { throw new SpreadsheetCreationError("unknown", "create", null, false, { cause }); }
  if (!createResponse.ok) {
    if (createResponse.status >= 500) throw new SpreadsheetCreationError("unknown", "create", null, false);
    throw new Error("Spreadsheet create rejected");
  }
  let created: {
    spreadsheetId: string;
    spreadsheetUrl: string;
    sheets: { properties: { sheetId: number } }[];
  };
  try {
    created = await createResponse.json();
    if (!created || typeof created.spreadsheetId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(created.spreadsheetId)) throw new Error();
  } catch (cause) { throw new SpreadsheetCreationError("unknown", "create", null, false, { cause }); }
  const resource = { spreadsheetId: created.spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit` };
  try { await onCreated(resource); } catch (cause) {
    throw new SpreadsheetCreationError("partial", "record", resource,
      typeof cause === "object" && cause !== null && (("code" in cause && cause.code === "PC_BACKUP_UNAVAILABLE")
        || ("protection" in cause && cause.protection === true)), { cause });
  }
  try {
  const sheetId = created.sheets[0].properties.sheetId;
  if (!Number.isSafeInteger(sheetId) || sheetId < 0) throw new Error("Spreadsheet setup response missing");
  const requests = sheetFormattingRequests({
    sheetId,
    kind,
    rowCount: Math.max(values.length + 20, 100),
    venues,
  });
  await assertPcAppWriteAllowed();
  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      headers: googleJsonHeaders(accessToken),
      body: JSON.stringify({ requests }),
    },
  );
  if (!updateResponse.ok) {
    throw new Error("Spreadsheet setup rejected");
  }
  return resource;
  } catch (cause) {
    throw new SpreadsheetCreationError("partial", "setup", resource,
      typeof cause === "object" && cause !== null && "code" in cause && cause.code === "PC_BACKUP_UNAVAILABLE", { cause });
  }
}

function googleJsonHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

function buildSheetValues({
  kind,
  year,
  month,
  block,
  schedules,
  weekdayDefaults,
}: {
  kind: ScheduleSheetKind;
  year: number | null;
  month: number | null;
  block: ScheduleSheetBlock;
  schedules: PracticeSchedule[];
  weekdayDefaults: ScheduleSheetWeekdayDefault[];
}): string[][] {
  if (schedules.length > 0) {
    return buildExistingValues(schedules, kind);
  }
  if (kind === "practice") {
    if (!year || !month) throw new Error("Practice sheet requires year and month");
    const headers = ["予定ID", "日付", "曜日", "対象ブロック", "時間", "場所", "詳細"];
    const days = new Date(year, month, 0).getDate();
    const blockLabel = block === "all" ? "全体" : BLOCKS[block].label;
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const defaultsByWeekday = new Map(
      weekdayDefaults.map((item) => [item.weekday, item]),
    );
    return [
      headers,
      ...Array.from({ length: days }, (_, index) => {
        const day = index + 1;
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const weekday = new Date(`${date}T00:00:00`).getDay();
        const defaults = defaultsByWeekday.get(weekday);
        return [
          "",
          date,
          weekdays[weekday],
          blockLabel,
          defaults?.time ?? "",
          defaults?.venueName ?? "",
          "",
        ];
      }),
    ];
  }
  return [
    [
      "予定ID",
      kind === "meet" ? "大会名" : "記録会名",
      "開始日",
      "終了日",
      "エントリー開始日",
      "エントリー締切日",
      "場所",
      "詳細",
    ],
    ...Array.from({ length: 10 }, () => ["", "", "", "", "", "", "", ""]),
  ];
}

function buildExistingValues(
  schedules: PracticeSchedule[],
  kind: ScheduleSheetKind,
): string[][] {
  if (kind === "practice") {
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return [
      ["予定ID", "日付", "曜日", "対象ブロック", "時間", "場所", "詳細"],
      ...schedules.map((schedule) => [
        schedule.id,
        schedule.schedule_date,
        weekdays[new Date(`${schedule.schedule_date}T00:00:00`).getDay()],
        schedule.target_blocks.length === 0
          ? "全体"
          : schedule.target_blocks.map((item) => BLOCKS[item].label).join(","),
        schedule.meeting_time?.slice(0, 5) ?? "",
        schedule.venue_name ?? "",
        schedule.note ?? "",
      ]),
    ];
  }
  return [
    [
      "予定ID",
      kind === "meet" ? "大会名" : "記録会名",
      "開始日",
      "終了日",
      "エントリー開始日",
      "エントリー締切日",
      "場所",
      "詳細",
    ],
    ...schedules.map((schedule) => [
      schedule.id,
      schedule.title ?? "",
      schedule.schedule_date,
      schedule.end_date ?? "",
      schedule.entry_start ?? "",
      schedule.entry_end ?? "",
      schedule.venue_name ?? "",
      schedule.note ?? "",
    ]),
  ];
}

function toRowData(values: string[]) {
  return {
    values: values.map((value) => ({
      userEnteredValue: { stringValue: value },
    })),
  };
}

function sheetFormattingRequests({
  sheetId,
  kind,
  rowCount,
  venues,
}: {
  sheetId: number;
  kind: ScheduleSheetKind;
  rowCount: number;
  venues: VenueRow[];
}) {
  const venueColumn = kind === "practice" ? 5 : 6;
  const requests: object[] = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.0, green: 0.48, blue: 1.0 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
          startColumnIndex: venueColumn,
          endColumnIndex: venueColumn + 1,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: venues.map((venue) => ({ userEnteredValue: venue.name })),
          },
          strict: false,
          showCustomUi: true,
        },
      },
    },
  ];
  if (kind === "practice") {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
          startColumnIndex: 3,
          endColumnIndex: 4,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: ["全体", "中長距離", "短距離", "跳躍", "投擲"].map((value) => ({
              userEnteredValue: value,
            })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    });
  }
  return requests;
}
