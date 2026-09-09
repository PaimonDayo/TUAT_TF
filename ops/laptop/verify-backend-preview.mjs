import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, localEnv, writePrivate, directory } from './backend-files.mjs';
const env = localEnv();
const trial = JSON.parse(readFileSync(resolve(root, '.contingency/private-trial.json'), 'utf8'));
const local = 'http://127.0.0.1:8000';
const admin = createClient(local, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// Generate a link for the existing isolated trial account; this API does not send email.
const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: trial.email });
if (link.error || !link.data.properties?.hashed_token) throw Error('Could not create local trial verification link');
const client = createClient(local, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const login = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
if (login.error || !login.data.session || login.data.user?.id !== trial.userId) throw Error('Local trial authentication failed');
writePrivate(resolve(directory, 'verified-trial-session.json'), JSON.stringify(login.data.session));
const base = 'https://tuat-tf-pc-preview.vercel.app';
const headers = { authorization: `Bearer ${login.data.session.access_token}`, origin: base, 'content-type': 'application/json', prefer: 'return=representation' };
const request = async (path, method='GET', body) => {
  const response = await fetch(base + '/api/pc-supabase' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`Preview API failed: ${method} ${path.split('?')[0]} ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const user = await request('/auth/v1/user');
if (user.id !== trial.userId) throw Error('Preview identity mismatch');
const profiles = await request(`/rest/v1/profiles?id=eq.${trial.userId}&select=id`);
if (profiles.length !== 1) throw Error('Preview profile missing');
const competitions = await request('/rest/v1/competitions?select=id&limit=1');
const marker = 'PC final verification ' + Date.now();
let inserted;
try {
  [inserted] = await request('/rest/v1/competition_goals', 'POST', { competition_id: competitions[0].id, user_id: trial.userId, event: '100m', target: marker });
  const [changed] = await request(`/rest/v1/competition_goals?id=eq.${inserted.id}`, 'PATCH', { target: marker + ' edited' });
  if (changed.target !== marker + ' edited') throw Error('Preview edit mismatch');
  console.log('Vercel→PC identity, member profile, insert and update verified.');
} finally {
  if (inserted) await request(`/rest/v1/competition_goals?id=eq.${inserted.id}`, 'DELETE');
}
console.log('Trial goal removed; production data unchanged.');
