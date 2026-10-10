import { MeetMark, type MeetEventRule, type MeetPerformance } from "./meet-operations";

/** Competition places, across heats in one division. Unresolved ties share a place. */
export function obResultRanks(rule: MeetEventRule, participants: MeetPerformance[]): Map<string, number> {
  const scores = participants.filter(p => p.status === "entered").flatMap(person => {
    const marks = person.trials.filter(t => t.status === "valid").map(t => MeetMark.parse(t.mark, rule.discipline)).filter((n): n is number => n !== null);
    if (!marks.length) return [];
    marks.sort((a, b) => rule.discipline === "track" ? a - b : b - a);
    let score = rule.discipline === "track" ? [marks[0]] : marks.map(n => -n);
    if (rule.discipline === "height") {
      const best = marks[0];
      const cleared = person.trials.findIndex(t => t.status === "valid" && MeetMark.parse(t.mark, "height") === best);
      const attempts = person.trials.slice(0, cleared + 1);
      score = [-best, attempts.filter(t => t.status === "foul" && MeetMark.parse(t.mark, "height") === best).length,
        attempts.filter(t => t.status === "foul" && (MeetMark.parse(t.mark, "height") ?? Infinity) <= best).length];
    }
    return [{ id: person.entryId, score }];
  });
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const delta = (a[i] ?? 0) - (b[i] ?? 0);
      if (delta) return delta;
    }
    return 0;
  };
  scores.sort((a, b) => compare(a.score, b.score));
  const ranks = new Map<string, number>();
  let rank = 0;
  scores.forEach((row, index) => {
    if (!index || compare(scores[index - 1].score, row.score)) rank = index + 1;
    ranks.set(row.id, rank);
  });
  return ranks;
}
