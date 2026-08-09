import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ITO_PHASE_ORDER,
  ITO_PHASE_TRANSITIONS,
  canAdvanceItoGameStatus,
  canAdvanceItoPhase,
  isItoAnswerEditable,
  isItoPredictionVisible,
  isItoResultVisible,
  nextItoPhase,
} from "./ito-phase";
import type { ItoPhase } from "@/types";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260810010000_ito_game.sql",
);

describe("ito phase transitions", () => {
  it("moves forward through every phase", () => {
    let phase: ItoPhase | null = "grouping";
    const visited: ItoPhase[] = [];
    while (phase) {
      visited.push(phase);
      phase = nextItoPhase(phase);
    }
    expect(visited).toEqual(ITO_PHASE_ORDER);
  });

  it("allows reopening answers but nothing else backwards", () => {
    expect(canAdvanceItoPhase("locked", "ordering")).toBe(true);
    expect(canAdvanceItoPhase("revealed", "locked")).toBe(false);
    expect(canAdvanceItoPhase("result", "revealed")).toBe(false);
    expect(canAdvanceItoPhase("finished", "result")).toBe(false);
  });

  it("rejects skipping a phase", () => {
    expect(canAdvanceItoPhase("grouping", "numbers")).toBe(false);
    expect(canAdvanceItoPhase("ordering", "revealed")).toBe(false);
    expect(canAdvanceItoPhase("leader_select", "ordering")).toBe(false);
  });

  it("keeps the same transition table as ito_advance_phase() in SQL", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const block = sql.slice(
      sql.indexOf("allowed := (current_phase, to_phase) IN ("),
      sql.indexOf("IF NOT allowed THEN"),
    );
    const sqlPairs = [...block.matchAll(/\('(\w+)',\s*'(\w+)'\)/g)]
      .map(([, from, to]) => `${from}->${to}`)
      .sort();
    const tsPairs = Object.entries(ITO_PHASE_TRANSITIONS)
      .flatMap(([from, targets]) => targets.map((to) => `${from}->${to}`))
      .sort();
    expect(sqlPairs.length).toBeGreaterThan(0);
    expect(sqlPairs).toEqual(tsPairs);
  });

  it("opens editing and disclosure at the right phases", () => {
    expect(ITO_PHASE_ORDER.filter(isItoAnswerEditable)).toEqual(["ordering"]);
    expect(ITO_PHASE_ORDER.filter(isItoPredictionVisible)).toEqual([
      "revealed",
      "result",
      "finished",
    ]);
    expect(ITO_PHASE_ORDER.filter(isItoResultVisible)).toEqual(["result", "finished"]);
  });

  it("advances the game status one step at a time", () => {
    expect(canAdvanceItoGameStatus("draft", "entry")).toBe(true);
    expect(canAdvanceItoGameStatus("entry", "active")).toBe(true);
    expect(canAdvanceItoGameStatus("draft", "active")).toBe(false);
    expect(canAdvanceItoGameStatus("finished", "active")).toBe(false);
  });
});
