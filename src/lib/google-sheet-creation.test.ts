import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beginGoogleSheetCreation, creationReceipt, readGoogleSheetCreation, rememberGoogleSheetResource, rememberGoogleSheetSetup, validCreationSpec } from "./google-sheet-creation";
const attempt = "11111111-1111-4111-8111-111111111111";
const spec = { kind: "practice" as const, block: "all" as const, year: 2026, month: 11 };
const reserved = { outcome: "held", attempt_id: attempt, state: "reserved", spec, setup_confirmed: false, record_status: "unregistered", sheet_id: null, resource: null };
const resource = { spreadsheetId: "synthetic-book", url: "https://docs.google.com/spreadsheets/d/synthetic-book/edit" };
const known = { ...reserved, outcome: "known", state: "resource_known", resource };
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc } as unknown as SupabaseClient);
describe("strict durable creation boundary", () => {
  it.each([null, {}, { ...spec, kind: null }, { ...spec, block: null }, { ...spec, year: null }, { ...spec, month: 1.5 }, { ...spec, extra: true }, { ...spec, year: "2026" }])("rejects malformed registration spec %j", input => {
    expect(validCreationSpec(input)).toBe(false);
  });
  it.each([{ ...reserved, outcome: "registered" }, { ...known, resource: { ...resource, url: "https://other.example.test/" } }, { ...reserved, setup_confirmed: true }, { ...known, sheet_id: attempt }, { ...reserved, attempt_id: "synthetic" }])("rejects inconsistent evidence %j", input => {
    expect(() => creationReceipt(input)).toThrow();
  });
  it("does not turn status errors or missing status into an absent reservation", async () => {
    await expect(readGoogleSheetCreation(client(vi.fn().mockResolvedValue({ data: null, error: { code: "synthetic" } })))).rejects.toBeDefined();
    await expect(readGoogleSheetCreation(client(vi.fn().mockResolvedValue({ data: undefined, error: null })))).rejects.toThrow();
    await expect(readGoogleSheetCreation(client(vi.fn().mockResolvedValue({ data: null, error: null })))).resolves.toBeNull();
  });
  it.each(["transport", "nonce", "malformed"])("unknown %s begin cannot gain permission from one reread", async failure => {
    const reread = vi.fn().mockResolvedValue({ data: { attempt_id: attempt, state: "reserved" }, error: null });
    const q = { select: () => q, eq: () => q, maybeSingle: reread };
    const rpc = vi.fn().mockResolvedValue(failure === "transport" ? { error: { code: "synthetic" } }
      : { data: failure === "nonce" ? { ...reserved, outcome: "send" } : {} });
    const c = { rpc, from: () => q } as unknown as SupabaseClient;
    await expect(beginGoogleSheetCreation(c, { connected_at: "2026-10-11T00:00:00Z", refresh_token_encrypted: "synthetic-cipher" }, spec, "a".repeat(64)))
      .rejects.toMatchObject({ retryable: false, resultUnknown: true });
    expect(rpc).toHaveBeenCalledOnce(); expect(reread).toHaveBeenCalledOnce();
  });
  it.each(["conflict", "wrong-nonce", "wrong-id"])("rejects %s persistence while retaining returned resource", async kind => {
    const value = kind === "conflict" ? { ...known, outcome: "conflict" } : kind === "wrong-nonce" ? { ...known, attempt_id: "22222222-2222-4222-8222-222222222222" }
      : { ...known, resource: { spreadsheetId: "other", url: "https://docs.google.com/spreadsheets/d/other/edit" } };
    await expect(rememberGoogleSheetResource(client(vi.fn().mockResolvedValue({ data: value })), creationReceipt(reserved), attempt, resource))
      .rejects.toMatchObject({ phase: "record", resource, retryable: false });
  });
  it("never confirms formatting from missing/false setup receipt", async () => {
    await expect(rememberGoogleSheetSetup(client(vi.fn().mockResolvedValue({ data: known })), creationReceipt(known), attempt, resource)).rejects.toMatchObject({ phase: "record", resource });
  });
});
