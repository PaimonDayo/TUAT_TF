// Parents precede children so inserts and reverse-order deletes preserve FKs.
export const OB_TABLES = [
  { table: 'ob_duty_event_slots', pk: ['slot_time', 'event_name'] },
  { table: 'ob_duty_roles', pk: ['id'] },
  { table: 'ob_meet_entries', pk: ['id'] },
  { table: 'ob_party_responses', pk: ['id'] },
  { table: 'ob_meet_duties', pk: ['meet_key', 'profile_id', 'slot_time', 'event_name'] },
  { table: 'ob_entry_changes', pk: ['id'] },
];

export function changesPath(offset, page, maxAttempts, includeBlocked = false) {
  // Failed replay rows must remain protected against mirror overwrites.
  const retry = includeBlocked ? '' : `&attempts=lt.${maxAttempts}`;
  return `/rest/v1/failover_changes?select=*${retry}&order=id.asc&limit=${page}&offset=${offset}`;
}
