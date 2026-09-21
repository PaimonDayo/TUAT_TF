import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { directory, readConfig, writePrivate } from './backend-files.mjs';
import { serverProfile, wslArgs, wslRepoRoot, composeCommand } from './server-profile.mjs';

const input = resolve(directory, 'google-oauth.env');
if (!existsSync(input)) {
  writePrivate(input, 'GOOGLE_CLIENT_ID=728069526798-l3aa31t065h0i2jmmqq6mripqlcl7ss2.apps.googleusercontent.com\nGOOGLE_SECRET=\n');
  console.log('Created private Google OAuth input file. Client secret must be supplied by its owner.');
  process.exit(0);
}
const env = parseEnv(readFileSync(input, 'utf8'));
if (!env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') || !env.GOOGLE_SECRET?.startsWith('GOCSPX-')) throw new Error('Google client secret has not been supplied');
const state = readConfig();
const siteUrl = process.argv.includes('--preview') ? 'https://tuat-tf-pc-preview.vercel.app' : state.siteUrl;
const doc = { networks: {
  local_gateway: { ipam: { config: [{ subnet: '10.253.254.0/27' }] } },
  auth_outbound: { enable_ipv6: true, ipam: { config: [{ subnet: '10.253.254.32/27' }, { subnet: 'fdce:7b29:9c45::/64' }] } },
}, services: { auth: {
  networks: { default: {}, auth_outbound: {} },
  environment: {
    GOTRUE_SITE_URL: siteUrl,
    GOTRUE_URI_ALLOW_LIST: `${siteUrl}/auth/callback`,
    API_EXTERNAL_URL: `${siteUrl}/api/pc-supabase`,
    GOTRUE_EXTERNAL_GOOGLE_ENABLED: 'true',
    GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOTRUE_EXTERNAL_GOOGLE_SECRET: env.GOOGLE_SECRET,
    GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: `${siteUrl}/api/pc-supabase/auth/v1/callback`,
    GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK: 'false',
    GOTRUE_EXTERNAL_GOOGLE_ALLOW_NO_EMAIL: 'false',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'false',
    // Members who have never signed in yet still need to create their account here.
    // Blocking signups bounced every new Google account straight back to /login (2026-09-14).
    GOTRUE_DISABLE_SIGNUP: 'false',
    GOTRUE_SECURITY_CAPTCHA_ENABLED: 'false',
  },
} } };
// Preserve Push wiring when OAuth is reconfigured after a recovery.
if (existsSync(resolve(directory, 'push.env'))) {
  doc.services.functions = {
    networks: { default: {}, auth_outbound: {} },
    environment: Object.fromEntries(['NEXT_PUBLIC_VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','PUSH_WEBHOOK_SECRET'].map(key => [key, '${' + key + '}'])),
  };
}
const output = resolve(directory, 'compose.auth.json');
writePrivate(output, JSON.stringify(doc));
if (process.argv.includes('--prepare-only')) { console.log('Prepared private Auth/network configuration; runtime unchanged.'); process.exit(0); }
const profile = serverProfile();
const composeAuth = `${wslRepoRoot()}/.contingency/backend/compose.auth.json`;
const script = `set -eu; cd ${profile.stackDir}; install -m 0600 '${composeAuth}' compose.auth.json; ${composeCommand(profile)} -f compose.auth.json up -d --no-deps --wait auth`;
execFileSync('wsl', [...wslArgs(), 'bash', '-c', script], { stdio: 'pipe', timeout: 120_000 });
console.log('PC Google authentication configured. Existing cloud provider and user identities were preserved.');
