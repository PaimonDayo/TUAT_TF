// Independent ordinary-member identity, created ONLY in the restored local DB.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
const root = resolve(import.meta.dirname, '../..');
const configFile = resolve(root, '.contingency/private-trial.json');
if (existsSync(configFile)) throw Error('Private identity already configured');
const origin = process.argv[2] ?? '';
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) throw Error('Expected dedicated trial URL');
const env = parseEnv(readFileSync(resolve(root, '.contingency/local-app.env'), 'utf8'));
if (env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:8000') throw Error('Local API only');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const email = `pc-trial-${randomUUID()}@example.invalid`;
const password = randomBytes(24).toString('base64url');
const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw Error('Cannot create local trial user');
const userId = created.data.user.id;
// Record immediately so a later failure never leaves an unidentified fixture.
writeFileSync(configFile, JSON.stringify({ origin, email, password, userId, dedicatedTestAccount: true }), { mode: 0o600, flag: 'wx' });
const updated = await sb.from('profiles').update({ display_name: 'PC試験ユーザー', blocks: ['middle_long'], status: 'active', record_source: 'app' }).eq('id', userId).select('id');
if (updated.error || updated.data?.length !== 1) throw Error('Cannot initialize local trial profile');
writeFileSync(resolve(root, '.contingency/PC試験版ログイン.txt'), `PC試験版（本人専用）\nURL: ${origin}\n専用パスワード: ${password}\n\nPC内だけに作成した「PC試験ユーザー」で入ります。\n本番アカウント・Googleパスワードは変更していません。\nこのファイルとパスワードは共有しないでください。\n入力はPC内だけに保存され、本番・スプシへ反映されません。\n画像変更・Push通知・外部連携・リアルタイム配信は停止中です。\nPCのスリープ・終了・回線断で試験版は停止します。\n`, { mode: 0o600 });
console.log('Created a private local trial member. Login details remain in the local file.');
