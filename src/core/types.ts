export type UsageLine = { label: string; percent: number; resetsText: string | null };

export type UsageParse =
  | { kind: 'ok'; lines: UsageLine[]; credentialExpiresAt: string | null; modelCalled: boolean }
  | { kind: 'no-lines'; preview: string[]; credentialExpiresAt: string | null; modelCalled: boolean }
  | { kind: 'unreadable'; preview: string[] };

// known: false when no status object was printed at all (timeout, spawn error), so "logged out" cannot be told.
export type AuthStatus = { known: boolean; loggedIn: boolean; email: string | null; planTier: string | null; loginExpiresAt: string | null };

export type MascotId = 'flame' | 'jellyfish' | 'octopus' | 'squid';

export type FlameStage = 1 | 2 | 3;

export type StoredAccount = {
  id: string; // 계정 폴더 이름이기도 하다 (profiles/<id>)
  email: string;
  addedAt: string; // ISO
  lines: UsageLine[]; // 마지막으로 읽은 값. 읽은 적이 없으면 []
  fetchedAt: string | null;
  credentialExpiresAt: string | null;
};
export type StoreFile = { version: 1; mascot: MascotId; claudePath: string | null; zoom: number; autoRefresh: boolean; accounts: StoredAccount[] };
export type Notice = { kind: 'info' | 'warn'; text: string };

export type AccountStatus = 'loading' | 'ok' | 'stale' | 'login-required';
export type AccountView = StoredAccount & { status: AccountStatus; failurePreview: string[] | null };
export type AppState = {
  claude: { found: boolean; version: string | null };
  accounts: AccountView[];
  activeEmail: string | null; // 기본 로그인의 계정
  login: { inProgress: boolean };
  notice: Notice | null;
  refreshing: boolean;
  lastFetchAt: string | null; // 마지막 조회가 시작된 때
  cooldownUntil: string | null; // 이때까지 [새로고침]이 잠긴다
  autoRefreshPaused: boolean;
  autoRefresh: boolean; // 자동 새로고침 켜짐/꺼짐 (사용자가 고른 것)
  mascot: { id: MascotId; flameStage: FlameStage };
};
