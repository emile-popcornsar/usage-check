import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStore, saveStore, EMPTY_STORE } from '../../src/main/store';

const dir = () => mkdtempSync(join(tmpdir(), 'usage check 테스트 '));

it('starts empty and round-trips', () => {
  const d = dir();
  expect(loadStore(d)).toEqual(EMPTY_STORE);
  const s = { ...EMPTY_STORE, mascot: 'squid' as const, accounts: [{ id: 'a', email: 'x@t.com', addedAt: 'n', lines: [], fetchedAt: null, credentialExpiresAt: null }] };
  saveStore(d, s);
  expect(loadStore(d)).toEqual(s);
});
it('keeps only well-formed entries and fills in missing fields', () => {
  const d = dir();
  const good = { id: 'b0f3c1e2-7a4d-4e5f-9a8b-1c2d3e4f5a6b', email: 'x@t.com', addedAt: 'n', lines: [], fetchedAt: null, credentialExpiresAt: null };
  writeFileSync(join(d, 'accounts.json'), JSON.stringify({
    version: 1, mascot: 'dragon', claudePath: 5,
    accounts: [
      good,
      { ...good, id: '..' }, { ...good, id: '../x' }, { ...good, id: 'a/b' }, { ...good, id: 'a\\b' }, { ...good, id: 'a.b' }, { ...good, id: '' }, { ...good, id: 7 },
      { ...good, id: 'e1', email: '' }, { ...good, id: 'e2', email: 3 }, { id: 'e3' },
      null, 'text',
      { id: 'f_1', email: 'y@t.com', lines: 'no', fetchedAt: 5, credentialExpiresAt: {} },
    ],
  }));
  expect(loadStore(d)).toEqual({
    version: 1, mascot: 'flame', claudePath: null, zoom: 0, autoRefresh: true,
    accounts: [good, { id: 'f_1', email: 'y@t.com', addedAt: '', lines: [], fetchedAt: null, credentialExpiresAt: null }],
  });
  expect(readdirSync(d).some((f) => f.startsWith('accounts.json.bad-'))).toBe(false);
});
it('keeps a known mascot and a saved path', () => {
  const d = dir();
  writeFileSync(join(d, 'accounts.json'), JSON.stringify({ version: 1, mascot: 'octopus', claudePath: 'C:\\x\\claude.exe', accounts: [] }));
  expect(loadStore(d)).toEqual({ version: 1, mascot: 'octopus', claudePath: 'C:\\x\\claude.exe', zoom: 0, autoRefresh: true, accounts: [] });
});
it('keeps a saved zoom within -3 to +3 and a saved auto-refresh choice', () => {
  const d = dir();
  const write = (extra: object) => writeFileSync(join(d, 'accounts.json'), JSON.stringify({ version: 1, mascot: 'flame', claudePath: null, accounts: [], ...extra }));
  write({ zoom: 1.5, autoRefresh: false });
  expect(loadStore(d)).toMatchObject({ zoom: 1.5, autoRefresh: false });
  write({ zoom: 7 });
  expect(loadStore(d)).toMatchObject({ zoom: 3, autoRefresh: true });
  write({ zoom: -7 });
  expect(loadStore(d).zoom).toBe(-3);
  for (const bad of ['2', null, true, {}]) {
    write({ zoom: bad, autoRefresh: bad });
    expect(loadStore(d)).toMatchObject({ zoom: 0, autoRefresh: true });
  }
  writeFileSync(join(d, 'accounts.json'), '{ "version": 1, "zoom": 1e999, "accounts": [] }'); // parses as Infinity
  expect(loadStore(d).zoom).toBe(0);
});
it('sets a broken file aside and starts empty', () => {
  const d = dir();
  writeFileSync(join(d, 'accounts.json'), '{ broken');
  expect(loadStore(d)).toEqual(EMPTY_STORE);
  expect(readdirSync(d).some((f) => f.startsWith('accounts.json.bad-'))).toBe(true);
});
