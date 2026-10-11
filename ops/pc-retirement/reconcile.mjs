import { createHash } from 'node:crypto';
import { OB_TABLES, obReplayProtection } from '../laptop/cloud-mirror-ob.mjs';

// Do not import cloud-mirror.mjs: its module entry reads live settings and runs.
const basicTables = [
  ['login_email_allowlist',['email']], ['role_categories',['id']], ['roles',['id']], ['profiles',['id']],
  ['profile_roles',['profile_id','role_id']], ['venues',['id']], ['competitions',['id']], ['competition_events',['name']],
  ['sheet_reply_deletions',['id']], ['schedule_sheets',['id']], ['practice_schedules',['id']], ['practice_menus',['id']],
  ['practice_menu_targets',['menu_id','user_id']], ['notices',['id']], ['record_form_config_versions',['id']],
  ['note_themes',['id']], ['notes',['id']], ['note_editors',['note_id','user_id']], ['note_articles',['id']],
  ['note_article_images',['id']], ['note_poll_options',['id']], ['note_poll_votes',['option_id','user_id']],
  ['threads',['id']], ['thread_posts',['id']], ['pb_records',['id']], ['competition_goals',['id']],
  ['competition_entries',['id']], ['competition_program_entries',['id']], ['favorites',['user_id','favorite_user_id']],
  ['notice_reactions',['notice_id','user_id','reaction']], ['notice_dismissals',['notice_id','user_id']],
  ['menu_target_presets',['id']], ['notifications',['id']], ['attendances',['id']], ['practice_records',['id']],
  ['tweets',['id']], ['tweet_poll_options',['id']], ['tweet_poll_votes',['option_id','user_id']],
  ['tweet_mentions',['tweet_id','profile_id']], ['comments',['id']], ['likes',['id']],
];
const tables = new Map([...basicTables, ...OB_TABLES.map(({ table,pk }) => [table,pk])]);
const naturalKeys = { practice_records:['user_id','recorded_date'], attendances:['schedule_id','user_id','attend_date'],
  likes:['user_id','target_type','target_id'], competition_goals:['competition_id','user_id','event'] };
const identifier = /^[a-z_][a-z0-9_]*$/;
const queueColumns = 'id,table_name,op,pk,row_data,changed,created_at,attempts,last_error';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof JsonNumber);

// Preserve PostgreSQL bigint/numeric digits: ordinary JSON.parse can falsely
// make two distinct queued/current values equal through floating point rounding.
export class JsonNumber {
  constructor(source) { this.source = source; }
  toJSON() { return { losslessNumber: this.source }; }
}
export function parseLosslessJson(text) {
  return JSON.parse(text, (_key,value,context) => typeof value === 'number' ? new JsonNumber(context.source) : value);
}
function numberKey(source) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) throw Error('Invalid numeric evidence');
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return 'n:0';
  let exponent = BigInt(match[4] ?? 0) - BigInt((match[3] ?? '').length);
  while (digits.endsWith('0')) { digits = digits.slice(0,-1); exponent++; }
  return `n:${match[1]}${digits}e${exponent}`;
}
export function canonical(value) {
  if (value instanceof JsonNumber) return numberKey(value.source);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw Error('Lossless numeric evidence required');
    return numberKey(String(value));
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const same = (a,b) => canonical(a) === canonical(b);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
function integer(value) {
  const text = value instanceof JsonNumber ? value.source : String(value);
  if (!/^\d+$/.test(text) || (typeof value === 'number' && !Number.isSafeInteger(value))) throw Error('Exact nonnegative integer required');
  return BigInt(text);
}
function scalar(value) {
  return value instanceof JsonNumber ? value.source : typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' ? String(value) : undefined;
}
function equality(value) {
  const text=scalar(value);
  if (text===undefined || /[\x00-\x1f\x7f]/.test(text)) throw new ReadFailure('target_key_invalid');
  // URL encoding alone does not escape PostgREST's filter grammar. Quote every
  // text scalar and escape quote/backslash before URLSearchParams encodes it.
  return `eq.${typeof value==='string'?`"${text.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`:text}`;
}
function schema(doc, table) { return doc?.definitions?.[table]?.properties; }
function schemaProblem(group, docs) {
  const expected = tables.get(group.table), source = schema(docs.cloud,group.table), target = schema(docs.pc,group.table);
  if (!source || !target) return 'table_schema_missing';
  for (const columns of [source,target]) {
    const declared = Object.entries(columns).filter(([,column]) => /<pk\/>|This is a Primary Key/i.test(column.description ?? '')).map(([name])=>name).sort();
    if (!same(declared,[...expected].sort())) return 'primary_key_schema_mismatch';
  }
  for (const change of group.changes) {
    if (!same(Object.keys(change.pk).sort(),[...expected].sort())) return 'queued_primary_key_mismatch';
    for (const column of new Set([...expected,...Object.keys(change.row_data ?? {}),...(change.changed ?? [])])) {
      if (!source[column] || !target[column] || !same([source[column].type,source[column].format],[target[column].type,target[column].format])) return 'queued_column_schema_mismatch';
    }
  }
}

export function groupChanges(changes) {
  const groups = new Map();
  for (const change of changes) {
    const supported = tables.has(change?.table_name), pk = change?.pk;
    let valid = supported && object(pk) && Object.keys(pk).length && Object.keys(pk).every(key=>identifier.test(key) && scalar(pk[key]) !== undefined);
    try { integer(change.id); integer(change.attempts); canonical(change); } catch { valid = false; }
    const key = valid ? `${change.table_name}:${canonical(pk)}` : `invalid:${groups.size}`;
    if (!groups.has(key)) groups.set(key,{ key, table:change?.table_name, pk, changes:[], invalid:!valid });
    groups.get(key).changes.push(change);
  }
  for (const group of groups.values()) if (!group.invalid) group.changes.sort((a,b)=>integer(a.id)<integer(b.id)?-1:1);
  return [...groups.values()];
}

export function finalExpectation(group, docs) {
  if (group.invalid) return { unknown:'unsupported_or_invalid_change' };
  if (group.changes.some(change=>!['INSERT','UPDATE','DELETE'].includes(change.op) ||
    (change.op!=='DELETE' && !object(change.row_data)) ||
    (change.changed!==null && change.changed!==undefined && !Array.isArray(change.changed)))) return { unknown:'invalid_operation_or_payload' };
  const mismatch = schemaProblem(group,docs);
  if (mismatch) return { schemaMismatch:mismatch };
  const fields = new Map();
  let deleted = false, natural;
  for (const change of group.changes) {
    if (!['INSERT','UPDATE','DELETE'].includes(change.op)) return { unknown:'invalid_operation' };
    if (change.op !== 'DELETE') {
      if (!object(change.row_data)) return { unknown:'missing_change_payload' };
      if (!Object.entries(change.pk).every(([key,value])=>Object.hasOwn(change.row_data,key) && same(value,change.row_data[key]))) return { unknown:'row_primary_key_disagreement' };
      if (naturalKeys[group.table]) {
        const columns = naturalKeys[group.table];
        natural = columns.every(key=>scalar(change.row_data[key]) !== undefined)
          ? Object.fromEntries(columns.map(key=>[key,change.row_data[key]])) : undefined;
      }
    }
    if (change.op === 'DELETE') { fields.clear(); deleted = true; continue; }
    if (change.op === 'INSERT') { fields.clear(); deleted = false; for (const entry of Object.entries(change.row_data)) fields.set(...entry); }
    else {
      if (deleted) return { unknown:'update_after_delete_without_insert' };
      if (!Array.isArray(change.changed) || !change.changed.length || new Set(change.changed).size !== change.changed.length ||
        change.changed.some(column=>typeof column !== 'string' || !Object.hasOwn(change.row_data,column))) return { unknown:'invalid_changed_columns' };
      if (change.changed.some(column=>Object.hasOwn(change.pk,column))) return { unknown:'primary_key_change_requires_review' };
      for (const column of change.changed) fields.set(column,change.row_data[column]);
    }
  }
  return { deleted,fields:Object.fromEntries(fields),natural,
    naturalRequired:naturalKeys[group.table] !== undefined, scope:deleted?'primary-key absence':'queued insert/changed columns' };
}

export function classify(group, expectation, evidence) {
  const result = (classification,reason) => ({ classification,reason,scope:expectation.scope ?? 'unproved',
    effectsVerified:false,acknowledgementAllowed:false,retryHeld:group.changes.some(change=>{try{return integer(change.attempts)>=5n;}catch{return true;}}) });
  if (expectation.unknown) return result('unknown',expectation.unknown);
  if (expectation.schemaMismatch) return result('schema_mismatch',expectation.schemaMismatch);
  if (evidence?.kind === 'schema_error') return result('schema_mismatch','target_schema_read_failed');
  if (evidence?.kind !== 'rows' || !Array.isArray(evidence.rows)) return result('unknown','target_read_not_confirmed');
  if (evidence.unstable || evidence.siblingReadFailed) return result('unknown','target_or_protected_sibling_not_stable');
  if (evidence.rows.length>1) return result('unknown','target_not_unique');
  if (evidence.rows.length && (!object(evidence.rows[0]) || !Object.entries(group.pk).every(([key,value])=>Object.hasOwn(evidence.rows[0],key) && same(value,evidence.rows[0][key])))) return result('unknown','target_primary_key_not_confirmed');
  if (!evidence.rows.length && expectation.naturalRequired) {
    if (!expectation.natural) return result('unknown','natural_key_identity_unproved');
    if (evidence.natural?.kind !== 'rows' || !Array.isArray(evidence.natural.rows)) return result('unknown','natural_key_read_not_confirmed');
    if (evidence.natural.rows.length) return result('divergence','natural_key_alternative_requires_review');
  }
  if (expectation.deleted) return evidence.rows.length ? result('divergence','deleted_primary_key_still_present') : result('pc_matches_final_change','deleted_primary_key_absent');
  if (!evidence.rows.length) return result('divergence','expected_primary_key_absent');
  for (const [key,value] of Object.entries(expectation.fields)) {
    if (!Object.hasOwn(evidence.rows[0],key)) return result('schema_mismatch','target_column_missing');
    if (!same(value,evidence.rows[0][key])) return result('divergence','queued_final_value_differs');
  }
  return result('pc_matches_final_change','queued_final_values_match');
}

class ReadFailure extends Error {
  constructor(code,schemaMismatch=false) { super(code); this.schemaMismatch=schemaMismatch; }
}
function allowedRead(side,path,count) {
  if (!['cloud','pc'].includes(side) || typeof path!=='string' || path.length>12_000 ||
    !/^\/rest\/v1\/(?:[a-z_][a-z0-9_]*)?(?:\?[^#\\]*)?$/.test(path)) return false;
  const url=new URL(path,'https://read.example.test'),table=url.pathname.slice('/rest/v1/'.length),params=url.searchParams;
  const names=[...params.keys()];
  if (new Set(names).size!==names.length) return false;
  if (!table) return path==='/rest/v1/' && !count;
  if (side==='cloud') {
    if (table!=='failover_changes' || params.get('order')!==(count?'id.desc':'id.asc')) return false;
    if (count) return names.length===3 && params.get('select')==='id' && params.get('limit')==='1';
    return names.length===4 && params.get('select')===queueColumns &&
      /^(?:[1-9]|[1-4]\d|50)$/.test(params.get('limit') ?? '') &&
      /^\(id\.gt\.\d+,id\.lte\.\d+\)$/.test(params.get('and') ?? '');
  }
  if (count || !tables.has(table) || params.get('select')!=='*' || params.get('limit')!=='2') return false;
  const filters=names.filter(name=>!['select','limit'].includes(name));
  if (![tables.get(table),naturalKeys[table]].filter(Boolean).some(columns=>same([...columns].sort(),[...filters].sort()))) return false;
  // A single equality scalar only: no logical filters, embeddings, modifier,
  // unescaped quote/backslash or PostgREST grammar expansion can be dispatched.
  return filters.every(name=>/^eq\.(?:"(?:[^"\\\x00-\x1f\x7f]|\\["\\])*"|(?:true|false|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))$/.test(params.get(name)));
}
export function createReadOnlyReader({ cloud,pc,expected,fetchImpl=globalThis.fetch,synthetic=false,maxRequests=832,maxBytes=16*1024*1024 }) {
  if (!expected || cloud?.url !== expected.cloudOrigin || pc?.url !== expected.pcOrigin || cloud.url===pc.url ||
    !cloud.key || !pc.key || expected.authoritativeSettingsVerified !== true || expected.pcRuntimeOwnershipVerified !== true ||
    !/^[a-f0-9]{64}$/.test(expected.cloudSettingsHash ?? '') || !/^[a-f0-9]{64}$/.test(expected.pcSettingsHash ?? '') ||
    !/^[a-f0-9]{64}$/.test(expected.pcRuntimeProofHash ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(expected.pcInstanceId ?? '')) throw Error('Independent authoritative target/runtime proof required');
  const cloudUrl = new URL(cloud.url), pcUrl = new URL(pc.url);
  if (cloudUrl.origin!==cloud.url || pcUrl.origin!==pc.url || cloudUrl.username || pcUrl.username) throw Error('Canonical target origins required');
  if (!synthetic && (cloudUrl.protocol!=='https:' || !/^[a-z0-9]+\.supabase\.co$/.test(cloudUrl.hostname) || pc.url!=='http://127.0.0.1:8000')) throw Error('Established cloud project and PC loopback target required');
  if (synthetic && (fetchImpl===globalThis.fetch || !cloudUrl.hostname.endsWith('.example.test') || !pcUrl.hostname.endsWith('.example.test'))) throw Error('Synthetic injected transport and fake targets required');
  if (!Number.isSafeInteger(maxRequests) || maxRequests<1 || maxRequests>832 || !Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>16*1024*1024) throw Error('Bounded read budget required');
  const responses=[]; let requests=0,bytes=0;
  const deadline=AbortSignal.timeout(300_000);
  return {
    targetProof:Object.fromEntries(['cloudOrigin','pcOrigin','cloudSettingsHash','pcSettingsHash','pcRuntimeProofHash','pcInstanceId',
      'authoritativeSettingsVerified','pcRuntimeOwnershipVerified'].map(name=>[name,expected[name]])), responses,
    async read(side,path,{ count=false }={}) {
      if (!allowedRead(side,path,count) || requests++>=maxRequests) throw new ReadFailure('read_scope_or_budget_rejected');
      const target=side==='cloud'?cloud:pc;
      let response,raw;
      try {
        response=await fetchImpl(`${target.url}${path}`, { method:'GET',redirect:'error',
          headers:{ apikey:target.key,Authorization:`Bearer ${target.key}`,Accept:path==='/rest/v1/'?'application/openapi+json':'application/json',...(count?{Prefer:'count=exact'}:{}) },
          signal:AbortSignal.any([deadline,AbortSignal.timeout(30_000)]) });
        const chunks=[]; let responseBytes=0;
        if (response.body) for await (const chunk of response.body) {
          responseBytes+=chunk.byteLength; bytes+=chunk.byteLength;
          if (responseBytes>2*1024*1024 || bytes>maxBytes) throw new ReadFailure('read_bytes_exceeded');
          chunks.push(Buffer.from(chunk));
        }
        raw=Buffer.concat(chunks).toString('utf8');
      } catch (error) { throw error instanceof ReadFailure?error:new ReadFailure('read_transport_failed'); }
      responses.push({ side,path,status:response.status,contentRange:response.headers.get('content-range'),raw });
      let body;
      try { body=parseLosslessJson(raw); } catch { throw new ReadFailure('read_json_invalid'); }
      if (!response.ok) throw new ReadFailure('read_http_failed',['PGRST204','PGRST205','42703','42P01'].includes(body?.code));
      return { body,count:count?parseCount(response.headers.get('content-range')):undefined };
    },
  };
}
function parseCount(range) {
  const match=/^(?:\d+-\d+|\*)\/(\d+)$/.exec(range ?? '');
  if (!match || BigInt(match[1])>200n) throw new ReadFailure('exact_bounded_count_required');
  return Number(match[1]);
}
async function readQueue(reader,{pageSize=50,maxRows=200}={}) {
  if (!Number.isInteger(pageSize) || pageSize<1 || pageSize>50 || !Number.isInteger(maxRows) || maxRows<1 || maxRows>200) throw Error('Bounded queue pagination required');
  const head=await reader.read('cloud','/rest/v1/failover_changes?select=id&order=id.desc&limit=1',{count:true});
  if (!Array.isArray(head.body) || head.body.length>1 || head.count>maxRows || (head.count===0)!==(head.body.length===0)) throw new ReadFailure('queue_head_not_confirmed');
  if (!head.count) return [];
  const ceiling=integer(head.body[0].id); let cursor=0n; const rows=[];
  for (let page=0;page<Math.ceil(maxRows/pageSize)+1;page++) {
    const path=`/rest/v1/failover_changes?select=${queueColumns}&and=(id.gt.${cursor},id.lte.${ceiling})&order=id.asc&limit=${pageSize}`;
    const next=(await reader.read('cloud',path)).body;
    if (!Array.isArray(next) || next.length>pageSize || rows.length+next.length>maxRows) throw new ReadFailure('queue_page_not_confirmed');
    for (const row of next) { const id=integer(row.id); if (id<=cursor || id>ceiling) throw new ReadFailure('queue_order_not_confirmed'); cursor=id; rows.push(row); }
    if (next.length<pageSize || cursor===ceiling) {
      if (rows.length!==head.count || cursor!==ceiling) throw new ReadFailure('queue_incomplete_or_changed');
      return rows;
    }
  }
  throw new ReadFailure('queue_page_budget_exceeded');
}
async function readTarget(reader,table,pk) {
  try {
    const query=new URLSearchParams({ select:'*',limit:'2' });
    for (const [column,value] of Object.entries(pk)) {
      if (!identifier.test(column) || scalar(value)===undefined) throw new ReadFailure('target_key_invalid');
      query.set(column,equality(value));
    }
    const path=`/rest/v1/${table}?${query}`;
    if (path.length>12_000) throw new ReadFailure('target_key_too_large');
    const rows=(await reader.read('pc',path)).body;
    return Array.isArray(rows) ? {kind:'rows',rows} : {kind:'invalid',rows};
  } catch (error) { return {kind:error.schemaMismatch?'schema_error':'read_error',reason:'target_read_failed'}; }
}

/** Reads only. The caller must privately encrypt the complete result/report pair.
 * No CLI or production settings loader is supplied until the execution plan is reviewed.
 */
export async function captureReadOnly(reader, options) {
  const docs={ cloud:(await reader.read('cloud','/rest/v1/')).body,pc:(await reader.read('pc','/rest/v1/')).body };
  for (const doc of Object.values(docs)) {
    const columns=schema(doc,'failover_changes');
    if (!columns || !same(Object.keys(columns).sort(),queueColumns.split(',').sort()) ||
      !/<pk\/>|This is a Primary Key/i.test(columns.id?.description ?? '')) throw Error('Failover queue schema proof required');
  }
  const changes=await readQueue(reader,options),groups=groupChanges(changes);
  const expectations=new Map(groups.map(group=>[group.key,finalExpectation(group,docs)]));
  const targets=new Map();
  for (const group of groups) if (!group.invalid && !expectations.get(group.key).unknown && !expectations.get(group.key).schemaMismatch) targets.set(group.key,{table:group.table,pk:group.pk});
  const held=obReplayProtection(groups.filter(group=>!group.invalid).flatMap(group=>group.changes));
  for (const [table,keys] of held) if (tables.has(table)) for (const key of keys) {
    const pk=JSON.parse(key),targetKey=`${table}:${canonical(pk)}`;
    // Lossless numeric queue keys are already in targets; generated OB keys are strings.
    if (!targets.has(targetKey) && Object.values(pk).every(value=>typeof value==='string')) targets.set(targetKey,{table,pk});
  }
  const observed=new Map();
  for (const [key,target] of targets) observed.set(key,await readTarget(reader,target.table,target.pk));
  for (const group of groups) {
    const expectation=expectations.get(group.key), evidence=observed.get(group.key);
    if (evidence?.kind==='rows' && !evidence.rows.length && expectation.natural) {
      evidence.natural=await readTarget(reader,group.table,expectation.natural);
    }
  }
  const secondQueue=await readQueue(reader,options);
  const secondDocs={ cloud:(await reader.read('cloud','/rest/v1/')).body,pc:(await reader.read('pc','/rest/v1/')).body };
  const queueStable=digest(changes)===digest(secondQueue),schemaStable=digest(docs)===digest(secondDocs);
  for (const [key,target] of targets) {
    const first=observed.get(key),second=await readTarget(reader,target.table,target.pk);
    first.unstable=digest({kind:first.kind,rows:first.rows,reason:first.reason})!==digest({kind:second.kind,rows:second.rows,reason:second.reason});
    first.second=second;
  }
  // Repeat natural-key evidence separately; never let a read error become absence.
  for (const group of groups) {
    const evidence=observed.get(group.key), expectation=expectations.get(group.key);
    if (evidence?.natural) {
      const second=await readTarget(reader,group.table,expectation.natural);
      evidence.unstable ||= digest(evidence.natural)!==digest(second);
      evidence.naturalSecond=second;
    }
    if (group.table==='ob_event_operations') {
      if (evidence) evidence.siblingReadFailed=[...targets].some(([key,target])=>target.table===group.table && target.pk.meet_key===group.pk.meet_key &&
        target.pk.event_name?.slice(2)===group.pk.event_name?.slice(2) && (observed.get(key).kind!=='rows' || observed.get(key).unstable));
    }
  }
  const classifications=groups.map(group=>({table:group.table,pk:group.pk,changeIds:group.changes.map(change=>change?.id),
    ...(!queueStable || !schemaStable ? {classification:'unknown',reason:!queueStable?'queue_changed_during_read':'schema_changed_during_read',effectsVerified:false,acknowledgementAllowed:false,
      retryHeld:group.changes.some(change=>{try{return integer(change.attempts)>=5n;}catch{return true;}})}
      : classify(group,expectations.get(group.key),observed.get(group.key))) }));
  const counts=Object.fromEntries(['pc_matches_final_change','divergence','schema_mismatch','unknown'].map(kind=>[kind,classifications.filter(row=>row.classification===kind).length]));
  return {
    snapshot:{ version:1,createdAt:new Date().toISOString(),targetProof:reader.targetProof,docs,changes,secondQueue,secondDocs,
      targets:[...targets.values()],observed:[...observed],responses:reader.responses },
    report:{ version:1,readOnly:true,retirementReady:false,triggerAndJournalEffectsVerified:false,
      consistency:'bounded double reads; no cross-server transaction',queueStable,schemaStable,
      queuedChanges:changes.length,groups:groups.length,counts,classifications },
  };
}
