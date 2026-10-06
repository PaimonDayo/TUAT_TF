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

const operationChange = change => change.table_name === 'ob_event_operations' && ['INSERT', 'UPDATE'].includes(change.op);
const familyOf = change => {
  const event = change.row_data?.event_name ?? change.pk?.event_name;
  return (change.row_data?.meet_key ?? change.pk?.meet_key) === 'ob-2026' && typeof event === 'string'
    ? event.match(/^(男子|女子)(.+)$/)?.[2] : undefined;
};

/** The two operation rows share transaction now(); retain every original journal snapshot. */
export function obOperationReplayUnits(changes) {
  const pairs = new Map();
  for (const change of changes) {
    const family = operationChange(change) && familyOf(change), time = change.row_data?.updated_at;
    if (!family || typeof time !== 'string' || !time) continue;
    const key = JSON.stringify([family, time]);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(change);
  }
  const byId = new Map();
  for (const pair of pairs.values()) for (const change of pair) byId.set(change.id, pair);
  const emitted = new Set(), units = [];
  for (const change of orderObReplay(changes)) {
    if (emitted.has(change.id)) continue;
    const members = byId.get(change.id) ?? [change];
    members.forEach(member => emitted.add(member.id));
    units.push({ changes: members, operations: operationChange(change) });
  }
  return units;
}

/** A held operation also protects its sibling division from becoming an inconsistent mirror. */
export function obReplayProtection(changes) {
  const pending = new Map();
  const hold = (table, pk) => {
    if (!pending.has(table)) pending.set(table, new Set());
    pending.get(table).add(JSON.stringify(pk));
  };
  for (const change of changes) {
    hold(change.table_name, change.pk);
    const family = operationChange(change) && familyOf(change);
    if (family) for (const division of ['男子', '女子']) hold('ob_event_operations', { meet_key: 'ob-2026', event_name: division + family });
  }
  return pending;
}

/** RPC and journal acknowledgement each operate on the complete family unit. */
export async function replayObChanges(changes, { maxAttempts, applyChange, applyOperations, acknowledge }) {
  const result = { applied: 0, failed: 0 };
  for (const unit of obOperationReplayUnits(changes)) {
    if (unit.changes.some(change => change.attempts >= maxAttempts)) continue;
    let outcome;
    try {
      const events = unit.changes.map(change => change.row_data?.event_name);
      const ambiguous = unit.operations && (unit.changes.length > 2 || new Set(events).size !== events.length);
      outcome = ambiguous ? 'operation_replay_conflict' : unit.operations
        ? await applyOperations(unit.changes.map(change => change.row_data))
        : await applyChange(unit.changes[0], obReplayHeaders(unit.changes[0], changes));
    } catch (error) { outcome = error instanceof Error ? error.message : String(error); }
    // An uncertain acknowledgement leaves the whole unit pending for an idempotent replay.
    await acknowledge(unit.changes, outcome);
    result[outcome === true ? 'applied' : 'failed'] += unit.changes.length;
  }
  return result;
}
