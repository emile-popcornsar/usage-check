import { it, expect } from 'vitest';
import { parseAuthStatus } from '../../src/core/authStatus';

it('reads a logged-in status', () => {
  const out = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'account2@example.com', planTier: 'max_20x', loginExpiresAt: '2026-12-03T22:17:02.335Z' });
  expect(parseAuthStatus(out)).toEqual({ known: true, loggedIn: true, email: 'account2@example.com', planTier: 'max_20x', loginExpiresAt: '2026-12-03T22:17:02.335Z' });
});
it('reads a logged-out status and tolerates garbage', () => {
  const empty = { loggedIn: false, email: null, planTier: null, loginExpiresAt: null };
  expect(parseAuthStatus(JSON.stringify({ loggedIn: false, authMethod: 'none', loginExpiresAt: null }))).toEqual({ ...empty, known: true });
  expect(parseAuthStatus('not json')).toEqual({ ...empty, known: false });
});
it('tells a logged-out status apart from no status at all', () => {
  expect(parseAuthStatus(JSON.stringify({ authMethod: 'none' })).known).toBe(true); // an object without loggedIn: true is logged out
  expect(parseAuthStatus('').known).toBe(false); // timeout or spawn error: nothing printed
  expect(parseAuthStatus('Error: EBUSY: resource busy or locked').known).toBe(false);
  expect(parseAuthStatus('').loggedIn).toBe(false);
});
it('reads the multi-line status the real CLI prints', () => {
  const out = String.raw`{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "C:\\Users\\u\\profiles\\p1\\projects",
  "configDirectory": "C:\\Users\\u\\profiles\\p1",
  "loginExpiresAt": "2026-12-03T22:17:02.335Z",
  "email": "account2@example.com",
  "orgId": "00000000",
  "orgName": "account2@example.com's Organization",
  "subscriptionType": "max",
  "storedClaudeAiLogin": true,
  "planTier": "max_20x"
}`;
  const expected = { known: true, loggedIn: true, email: 'account2@example.com', planTier: 'max_20x', loginExpiresAt: '2026-12-03T22:17:02.335Z' };
  expect(parseAuthStatus(out)).toEqual(expected);
  expect(parseAuthStatus(`Update available: 2.1.320\n${out}\n`)).toEqual(expected);
});
it('reads a multi-line logged-out status', () => {
  const out = '{\n  "loggedIn": false,\n  "authMethod": "none",\n  "loginExpiresAt": null\n}\n';
  expect(parseAuthStatus(out)).toEqual({ known: true, loggedIn: false, email: null, planTier: null, loginExpiresAt: null });
});
