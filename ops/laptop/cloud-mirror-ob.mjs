// Parents precede children so inserts and reverse-order deletes preserve FKs.
export const OB_TABLES = [
  { table: 'ob_duty_event_slots', pk: ['slot_time', 'event_name'] },
  { table: 'ob_duty_roles', pk: ['id'] },
  { table: 'ob_meet_entries', pk: ['id'] },
  { table: 'ob_party_responses', pk: ['id'] },
  { table: 'ob_meet_duties', pk: ['meet_key', 'profile_id', 'slot_time', 'event_name'] },
  { table: 'ob_entry_duties', pk: ['meet_key', 'entry_id', 'slot_time', 'event_name'] },
  { table: 'ob_entry_changes', pk: ['id'] },
  { table: 'ob_event_operations', pk: ['meet_key', 'event_name'] },
  { table: 'ob_operation_changes', pk: ['id'] },
];

export function changesPath(offset, page, maxAttempts, includeBlocked = false) {
  // Failed replay rows must remain protected against mirror overwrites.
  const retry = includeBlocked ? '' : `&attempts=lt.${maxAttempts}`;
  return `/rest/v1/failover_changes?select=*${retry}&order=id.asc&limit=${page}&offset=${offset}`;
}

// A trigger can enqueue the audit row before its newly inserted parent.
export function orderObReplay(changes) {
  let audits = changes.filter(c => c.table_name === 'ob_entry_changes');
  const ordered = [];
  for (const change of changes.filter(c => c.table_name !== 'ob_entry_changes')) {
    if (change.table_name === 'ob_meet_entries' && change.op === 'DELETE') {
      // A registration created and deleted during an outage can still have
      // queued audit inserts with a parent FK. Replay those before its deletion;
      // ON DELETE SET NULL then retains every historical snapshot.
      const belongs = c => c.row_data?.entry_id === change.pk.id || c.row_data?.after_data?.id === change.pk.id;
      ordered.push(...audits.filter(belongs));
      audits = audits.filter(c => !belongs(c));
    }
    ordered.push(change);
  }
  return [...ordered, ...audits];
}
export function obReplayHeaders(change, changes) {
  if (!['ob_meet_entries', 'ob_party_responses'].includes(change.table_name)) return {};
  const party = change.table_name === 'ob_party_responses';
  const recorded = changes.some(c => c.table_name === 'ob_entry_changes' && c.op === 'INSERT' &&
    (c.row_data?.after_data?.change_type === 'party') === party &&
    c.row_data?.after_data?.id === change.pk.id && c.row_data?.after_data?.revision === change.row_data?.revision);
  // Legacy queued writes without an original audit record still run the PC trigger.
  return recorded ? { 'x-tuat-mirror': '1' } : {};
}
