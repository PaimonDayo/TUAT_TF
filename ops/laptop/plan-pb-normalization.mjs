// Generate a reviewed SQL plan from a protected snapshot; never connects for writes.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { writePrivate, directory } from './backend-files.mjs';
import { serverProfile, wslArgs } from './server-profile.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const compiled = resolve('.contingency/normalize-runtime');
mkdirSync(compiled, { recursive: true });
writeFileSync(resolve(compiled,'package.json'),'{"type":"commonjs"}');
for (const name of ['competition-record','pb-normalize']) {
  const input = readFileSync(resolve('src/lib',name+'.ts'),'utf8');
  writeFileSync(resolve(compiled,name+'.js'), ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
}
const { planPbNormalization } = require(resolve(compiled,'pb-normalize.js'));
const label = process.argv[2];
if (!['rehearsal-migrated','pc-migrated','pc-normalization-before'].includes(label)) throw Error('Use an explicit migration snapshot');
const source = `${serverProfile().stackDir}/transfer/competition-v2/${label}.jsonl`;
const raw = execFileSync('wsl',[...wslArgs(),'cat',source],{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
const tables = raw.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
const rows = tables.find(t=>t.schema==='public' && t.name==='pb_records').rows;
const events = tables.find(t=>t.schema==='public' && t.name==='competition_events').rows;
const plan = planPbNormalization(rows,events);
const literal = value => "'"+value.replaceAll("'","''")+"'";
const projection = row => Object.fromEntries(Object.entries(row).filter(([k])=>k!=='updated_at'));
function assertion(expected) {
  const payload=literal(JSON.stringify(expected.map(projection)));
  return `DO $verify$ BEGIN IF EXISTS((SELECT to_jsonb(t)-'updated_at' FROM public.pb_records t EXCEPT ALL SELECT value FROM jsonb_array_elements(${payload}::jsonb)) UNION ALL (SELECT value FROM jsonb_array_elements(${payload}::jsonb) EXCEPT ALL SELECT to_jsonb(t)-'updated_at' FROM public.pb_records t)) THEN RAISE EXCEPTION 'PB snapshot differs; generate and review a new plan'; END IF; END $verify$;`;
}
const lines=['BEGIN;',"SET LOCAL lock_timeout='10s';","SET LOCAL statement_timeout='30s';",'LOCK TABLE public.pb_records IN SHARE ROW EXCLUSIVE MODE;',assertion(rows)];
for (const stage of ['event','value']) for (const {id,changes} of plan.patches) {
  const entries=Object.entries(changes).filter(([k])=>stage==='event'?k==='event_name':k!=='event_name');
  if (!entries.length) continue;
  const set=entries.map(([key,value])=>`${key}=${typeof value==='number'?value:literal(value)}`).join(',');
  lines.push(`UPDATE public.pb_records SET ${set} WHERE id=${literal(id)};`);
}
const changesById=new Map(plan.patches.map(p=>[p.id,p.changes]));
lines.push(assertion(rows.map(r=>({...r,...changesById.get(r.id)}))),'COMMIT;');
const sql=lines.join('\n')+'\n';
const prefix=`pb-normalization-${label}`;
writePrivate(resolve(directory,prefix+'.sql'),sql);
writePrivate(resolve(directory,prefix+'.review.json'),JSON.stringify(plan,null,2));
const summary={source:label,total:rows.length,changedRows:plan.patches.length,eventNames:plan.patches.filter(p=>p.changes.event_name).length,recordValues:plan.patches.filter(p=>Object.keys(p.changes).some(k=>k.startsWith('value_'))).length,manualReview:plan.review.length,duplicateFlagGroups:plan.duplicateGroups.length,sha256:createHash('sha256').update(sql).digest('hex'),writes:0};
writePrivate(resolve(directory,prefix+'.summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
