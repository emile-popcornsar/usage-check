import type { AuthStatus } from './types';
import { findJsonObject } from './jsonLine';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function parseAuthStatus(stdout: string): AuthStatus {
  const obj = findJsonObject(stdout);
  if (!obj || obj.loggedIn !== true) {
    return { known: obj !== null, loggedIn: false, email: null, planTier: null, loginExpiresAt: null };
  }
  return { known: true, loggedIn: true, email: str(obj.email), planTier: str(obj.planTier), loginExpiresAt: str(obj.loginExpiresAt) };
}
