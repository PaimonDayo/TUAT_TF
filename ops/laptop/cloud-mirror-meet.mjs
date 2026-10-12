// Canonical meet rows have no mutation side effects during replay. Apply a whole
// competition atomically so a partially replayed absence cannot occupy a lane.
export const MEET_TABLES = [
  { table: 'competition_meets', pk: ['competition_id'] },
  { table: 'competition_meet_events', pk: ['competition_id', 'name'] },
  { table: 'competition_participants', pk: ['id'] },
  { table: 'competition_appearances', pk: ['id'] },
  { table: 'competition_meet_duty_roles', pk: ['id'] },
  { table: 'competition_meet_duties', pk: ['id'] },
  { table: 'competition_meet_party', pk: ['id'] },
  { table: 'competition_meet_requests', pk: ['id'] },
];
export function meetMirrorRows(plans) {
  let id=0;
  return plans.filter(plan=>MEET_TABLES.some(spec=>spec.table===plan.spec.table)).flatMap(({spec,deletes,upserts})=>[
    ...deletes.map(pk=>({id:++id,table_name:spec.table,op:'DELETE',pk})),
    ...upserts.map(row_data=>({id:++id,table_name:spec.table,op:'UPDATE',pk:Object.fromEntries(spec.pk.map(key=>[key,row_data[key]])),row_data,changed:Object.keys(row_data).filter(key=>!spec.pk.includes(key))})),
  ]);
}
export function meetReplayConfirmed(response,count) {
  if(!response.ok)return `${response.status} Meet replay failed`;
  try { if(JSON.parse(response.text)?.count===count)return true; } catch { /* Keep the pending unit. */ }
  return 'Meet replay count could not be confirmed';
}
export function meetReplayUnits(changes) {
  const tables = new Set(MEET_TABLES.map(spec => spec.table)), grouped = new Map();
  const rest = [];
  for (const change of changes) {
    if (!tables.has(change.table_name)) { rest.push(change); continue; }
    const key = change.row_data?.competition_id ?? change.pk?.competition_id;
    // An unidentifiable deletion remains an explicit singleton; it cannot be silently omitted.
    const group = key ?? `unknown:${change.id}`;
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(change);
  }
  return { units: [...grouped.values()], rest };
}
export async function replayMeetChanges(changes, { maxAttempts, applyBatch, acknowledge }) {
  const { units, rest } = meetReplayUnits(changes);
  let applied = 0, failed = 0;
  for (const rows of units) {
    if (rows.some(row => (row.attempts ?? 0) >= maxAttempts)) { failed += rows.length; continue; }
    let outcome;
    try { outcome = await applyBatch(rows); } catch { outcome = 'Meet replay could not be confirmed'; }
    await acknowledge(rows, outcome);
    if (outcome === true) applied += rows.length; else failed += rows.length;
  }
  return { rest, applied, failed };
}
