import { formatDateTime } from './format';
import type { Notice, StoredAccount } from './types';

type Login = { id: string; email: string; credentialExpiresAt: string | null; now: string };

export function reconcileLogin(
  accounts: StoredAccount[],
  login: Login,
  intendedEmail: string | null,
): { accounts: StoredAccount[]; replacedIds: string[]; notice: Notice } {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const old = accounts.filter((a) => same(a.email, login.email));
  const first = old[0];
  const entry: StoredAccount = first
    ? { ...first, id: login.id, email: login.email, credentialExpiresAt: login.credentialExpiresAt }
    : { id: login.id, email: login.email, addedAt: login.now, lines: [], fetchedAt: null, credentialExpiresAt: login.credentialExpiresAt };

  const next: StoredAccount[] = [];
  for (const a of accounts) {
    if (a === first) next.push(entry);
    else if (!old.includes(a)) next.push(a);
  }
  if (!first) next.push(entry);

  const replacedIds = old.map((a) => a.id);
  const e = login.email;
  let notice: Notice;
  if (intendedEmail === null || same(intendedEmail, e)) {
    if (!first) notice = { kind: 'info', text: `${e} 계정을 등록했습니다.` };
    else {
      const date = login.credentialExpiresAt ? formatDateTime(login.credentialExpiresAt).split(' ').slice(0, 2).join(' ') : null;
      notice = { kind: 'info', text: date ? `${e} 로그인을 연장했습니다. 새 만료일은 ${date}입니다.` : `${e} 로그인을 연장했습니다.` };
    }
  } else {
    const what = first ? '이 계정의 로그인을 연장했습니다.' : '이 계정을 새로 등록했습니다.';
    notice = {
      kind: 'warn',
      text: `브라우저에 로그인된 계정은 ${e}입니다. ${what} ${intendedEmail} 계정을 연장하려면 브라우저에서 그 계정으로 로그인한 뒤 [다시 로그인]을 다시 눌러 주세요.`,
    };
  }
  return { accounts: next, replacedIds, notice };
}
