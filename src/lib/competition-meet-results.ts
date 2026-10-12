import {gradeShort} from "./constants";
import { appearancePerformance, availableAppearance, competitionEventData, competitionFamilyData, meetRule, type CompetitionMeet } from "./competition-meet";
import { fieldOrderRows } from "./meet-field-order";
import { MeetEvent } from "./meet-operations";
import { obResultRanks } from "./ob-result-ranking";
import type { ParsedProgramRow } from "./competition-program";

/** Results DTO: operational identities, qualification marks and party/duty data stay on the server. */
export function meetResultRows(meet: CompetitionMeet, date: string): ParsedProgramRow[] {
  const people = new Map(meet.participants.map(p => [p.id, p]));
  return meet.events.map(event => {
    const data = competitionEventData(meet, event), aggregate = new MeetEvent(meetRule(event), data);
    const ranks = obResultRanks(meetRule(event), data.participants);
    const fieldOrder = event.discipline === "track" ? [] : fieldOrderRows(competitionFamilyData(meet, event));
    return {
      eventDate: date, block: event.discipline === "track" ? "track" : "field", sortOrder: event.sort_order,
      timeLabel: event.starts_at, roundKey: event.name, eventLabel: event.name, status: event.confirmed ? "確定" : "速報",
      tuatEntries: meet.appearances.filter(a => a.event_name === event.name && a.state !== "deleted" && !people.get(a.participant_id)?.deleted).map(a => {
        const person = people.get(a.participant_id), p = appearancePerformance(person, a);
        const best = aggregate.best(p), wind = aggregate.bestTrial(p)?.wind;
        const multiple = meet.appearances.filter(other => other.participant_id === a.participant_id && other.event_name === a.event_name).length > 1;
        const number = fieldOrder.find(row => row.person.entryId === a.id)?.number;
        const details = a.performance.trials.flatMap((t, i) => t.status === "pending" ? [] : [`試技${i + 1}: ${t.status === "foul" ? `${t.mark ? t.mark + " " : ""}×` : t.status === "pass" ? `${t.mark ? t.mark + " " : ""}−` : t.mark}${t.wind ? `（風 ${t.wind}）` : ""}`]);
        if (!availableAppearance(person, a)) details.unshift(person?.absent ? "大会欠席" : "出場取消済み");
        return {
          id: a.id, name: `${person?.name ?? "参加者確認中"}${multiple ? `（${a.ordinal}件目）` : ""}`, grade: gradeShort(person?.grade ?? null) ?? "",
          heat: event.discipline === "track" ? p.group : null, lane: event.discipline === "track" ? p.order : null, bib: null,
          positionLabel: event.discipline === "track" ? p.group === null ? "組未定" : `${p.heatScope ?? event.division}${p.group}組 ${p.order ?? "未定"}番` : number == null ? "試技順未定" : `試技順 ${number}番`,
          separateResult: true, details,
          ...(best !== "—" ? { result: { place: ranks.has(a.id) ? String(ranks.get(a.id)) : null, record: best, ...(wind && p.status === "entered" ? { wind } : {}) } } : {}),
        };
      }),
    };
  });
}
