import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {encryptGoogleToken,decryptGoogleToken,signGoogleOAuthState,verifyGoogleOAuthState} from './google-drive';
afterEach(()=>vi.unstubAllEnvs());
it('keeps existing tokens and OAuth state valid after the Supabase key changes',()=>{
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','old-test-key');vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY','');
 const encrypted=encryptGoogleToken('test-refresh-token');const state=signGoogleOAuthState('test-user');
 vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY',createHash('sha256').update('old-test-key').digest('hex'));
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','new-test-key');
 expect(decryptGoogleToken(encrypted)).toBe('test-refresh-token');expect(verifyGoogleOAuthState(state)).toEqual({userId:'test-user'});
 expect(decryptGoogleToken(encryptGoogleToken('new-token'))).toBe('new-token');
});
it('rejects an invalid dedicated key instead of silently using a different key',()=>{vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY','invalid');expect(()=>encryptGoogleToken('token')).toThrow('32-byte');});
