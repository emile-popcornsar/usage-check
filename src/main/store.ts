import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoreFile, StoredAccount } from '../core/types';
import { MASCOT_ORDER } from '../core/mascot';
import { clampZoom } from '../core/zoom';

export const EMPTY_STORE: StoreFile = { version: 1, mascot: 'flame', claudePath: null, zoom: 0, autoRefresh: true, accounts: [] };

const FILE = 'accounts.json';
// The id is also the account folder's name, so it may never reach outside profiles/ (no '.', '/' or '\').
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// A hand-edited entry that would point outside profiles/ or break the screen is dropped; missing fields get defaults.
function validAccount(v: unknown): StoredAccount | null {
  if (v === null || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'string' || !SAFE_ID.test(a.id) || typeof a.email !== 'string' || a.email === '') return null;
  return {
    id: a.id,
    email: a.email,
    addedAt: typeof a.addedAt === 'string' ? a.addedAt : '',
    lines: Array.isArray(a.lines) ? a.lines : [],
    fetchedAt: strOrNull(a.fetchedAt),
    credentialExpiresAt: strOrNull(a.credentialExpiresAt),
  };
}

export function loadStore(dataDir: string): StoreFile {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return { ...EMPTY_STORE, accounts: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && parsed.version === 1 && Array.isArray(parsed.accounts)) {
      return {
        version: 1,
        mascot: MASCOT_ORDER.includes(parsed.mascot) ? parsed.mascot : 'flame',
        claudePath: strOrNull(parsed.claudePath),
        zoom: clampZoom(parsed.zoom),
        autoRefresh: typeof parsed.autoRefresh === 'boolean' ? parsed.autoRefresh : true,
        accounts: (parsed.accounts as unknown[]).map(validAccount).filter((a): a is StoredAccount => a !== null),
      };
    }
  } catch {
    // fall through: set the broken file aside
  }
  renameSync(file, `${file}.bad-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  return { ...EMPTY_STORE, accounts: [] };
}

export function saveStore(dataDir: string, store: StoreFile): void {
  const file = join(dataDir, FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  renameSync(tmp, file);
}
