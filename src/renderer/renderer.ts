import type { AccountStatus, AccountView, AppState, Notice, UsageLine } from '../core/types';
import type { Api } from '../main/preload';
import { isSupportedClaudeVersion, MIN_CLAUDE_VERSION } from '../core/claudeVersion';
import { describeExpiry, type ExpiryState } from '../core/expiry';
import { describeAge, formatDateTime } from '../core/format';
import { displayLabel } from '../core/labels';
import { MASCOT_NAMES, spriteFor } from '../core/mascot';
import { dropIndex, moveById } from '../core/reorder';
import { spriteToSvg } from './mascotSvg';

declare global {
  interface Window { api: Api }
}

type Screen = 'no-claude' | 'login' | 'empty' | 'cards';

const api = window.api;
const root = document.getElementById('app')!;

let state: AppState | null = null;
let refreshButton: HTMLButtonElement | null = null; // only the card screen has a live [새로고침]
let footer: HTMLElement | null = null; // the footer's text, kept current by tick()
let renderedMinute = -1;
let renderedScreen: Screen | null = null;
// A card drag in progress. A redraw would remove the dragged card and end the drag, so render() waits until it is over.
let drag: { id: string; from: number } | null = null;
// After a click on the character, the newly picked one says its name until this time.
const BUBBLE_MS = 2_000;
let bubbleUntil = 0;

// Every piece of text goes in through textContent; only spriteToSvg's own markup uses innerHTML.
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// `key` names the control across redraws (action, plus account id on a card), so focus can be put back.
function button(key: string, text: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el('button', className, text);
  b.dataset.key = key;
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function icon(name: 'warn' | 'check' | 'clock' | 'terminal' | 'spinner', size: number): Element {
  const template = document.getElementById(`icon-${name}`) as HTMLTemplateElement;
  const svg = template.content.firstElementChild!.cloneNode(true) as Element;
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  return svg;
}

function mascotButton(s: AppState, size: 'small' | 'big'): HTMLButtonElement {
  const b = button(`mascot-${size}`, '', `mascot ${size}`, () => {
    bubbleUntil = Date.now() + BUBBLE_MS;
    setTimeout(render, BUBBLE_MS); // takes the bubble away again
    api.cycleMascot();
  });
  const name = MASCOT_NAMES[s.mascot.id];
  b.setAttribute('aria-label', `캐릭터 바꾸기 (지금: ${name})`);
  b.innerHTML = spriteToSvg(spriteFor(s.mascot.id, s.mascot.flameStage), size === 'big' ? 9 : 3, null);
  if (Date.now() < bubbleUntil) {
    const bubble = el('span', 'bubble', `${name}!`);
    bubble.setAttribute('role', 'status');
    b.append(bubble);
  }
  return b;
}

function screenOf(s: AppState): Screen {
  if (!s.claude.found) return 'no-claude';
  if (s.login.inProgress) return 'login';
  return s.accounts.length === 0 ? 'empty' : 'cards';
}

function header(s: AppState, screen: Screen): HTMLElement {
  const top = el('header', 'top');
  const title = el('div', 'title');
  if (screen !== 'empty') title.append(mascotButton(s, 'small'));
  if (Date.now() < bubbleUntil) title.classList.add('talking'); // the bubble takes the heading's place while it shows
  title.append(el('h1', undefined, '계정 사용량'));
  const refresh = button('refresh', '새로고침', 'btn', () => api.refresh(), true);
  refreshButton = screen === 'cards' ? refresh : null;
  const add = button('add', '계정 추가', 'btn primary', () => api.addAccount(), screen === 'no-claude' || screen === 'login');
  const actions = el('div', 'actions');
  actions.append(refresh, add);
  top.append(title, actions);
  return top;
}

function noticeBand(n: Notice): HTMLElement {
  const band = el('div', `notice ${n.kind}`);
  band.append(icon(n.kind === 'warn' ? 'warn' : 'check', 18), el('span', undefined, n.text));
  return band;
}

const PAUSED: Notice = { kind: 'warn', text: '조회가 모델을 사용하기 시작해 자동 조회를 멈췄습니다. Claude Code가 업데이트되어 동작이 바뀐 것으로 보입니다.' };

// The pause warning comes from the state itself (the service never puts it in `notice`), so a later notice cannot replace it.
function bands(s: AppState): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (s.autoRefreshPaused) out.push(noticeBand(PAUSED));
  if (s.notice) out.push(noticeBand(s.notice));
  return out;
}

function emptyBody(s: AppState): HTMLElement {
  const body = el('main', 'body center');
  body.append(...bands(s));
  const steps = el('ol', 'steps');
  steps.append(
    el('li', undefined, '브라우저에서 등록할 계정으로 claude.ai에 로그인합니다.'),
    el('li', undefined, '아래 [계정 추가]를 누릅니다.'),
    el('li', undefined, '브라우저에서 승인하면 이 창에 사용량이 나타납니다.'),
  );
  body.append(
    mascotButton(s, 'big'),
    el('h2', undefined, '등록된 계정이 없습니다'),
    steps,
    button('add-big', '계정 추가', 'btn primary large', () => api.addAccount()),
    el('p', 'fine', '로그인은 Claude Code의 공식 화면에서 이루어집니다. 이 프로그램은 로그인 정보를 보관하지 않습니다.'),
  );
  return body;
}

function noClaudeBody(s: AppState): HTMLElement {
  const body = el('main', 'body center');
  if (s.notice) body.append(noticeBand(s.notice)); // e.g. a picked file that is not Claude Code
  const terminal = icon('terminal', 48);
  terminal.classList.add('terminal');
  const row = el('div', 'row');
  row.append(
    button('pick-path', '경로 직접 지정', 'btn primary large wide', () => api.pickClaudePath()),
    button('retry-find', '다시 찾기', 'btn large wide', () => api.retryFindClaude()),
  );
  body.append(
    terminal,
    el('h2', undefined, 'Claude Code를 찾을 수 없습니다'),
    el('p', 'lead', '이 프로그램은 PC에 설치된 Claude Code를 통해 사용량을 읽습니다. Claude Code가 설치돼 있다면 실행 파일의 위치를 알려 주세요.'),
    row,
    el('p', 'fine', '찾아본 위치: 실행 경로(PATH), 사용자 폴더의 .local\\bin, npm 전역 폴더'),
  );
  return body;
}

function loginOverlay(): HTMLElement {
  const overlay = el('div', 'overlay');
  const dialog = el('div', 'dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.append(
    icon('spinner', 40),
    el('h2', undefined, '브라우저에서 로그인을 마쳐 주세요'),
    el('p', 'lead', '기본 브라우저에 Claude의 공식 로그인 화면이 열렸습니다. 승인하면 이 창으로 돌아옵니다.'),
    el('p', 'dialog-note', '지금 브라우저에 로그인돼 있는 계정이 등록됩니다.'),
    button('cancel-login', '취소', 'btn wide', () => api.cancelLogin()),
  );
  overlay.append(dialog);
  return overlay;
}

// "N분 전" without the trailing "조회", for "N분 전 값".
function ageOf(fetchedAt: string, now: Date): string {
  const age = describeAge(fetchedAt, now).replace(/ 조회$/, '');
  return age === '방금' ? '방금 전' : age;
}

function usageLine(line: UsageLine, stale: boolean): HTMLElement {
  const limit = line.percent >= 100;
  const head = el('div', 'usage-head');
  const value = el('span', 'usage-value');
  value.append(el('strong', limit ? 'limit' : undefined, `${line.percent}%`), line.resetsText === null ? ' 사용' : ` 사용 · ${line.resetsText} 초기화`);
  head.append(el('span', undefined, displayLabel(line.label)), value);
  const bar = el('div', 'bar');
  const fill = el('div', limit ? 'bar-fill limit' : stale ? 'bar-fill stale' : 'bar-fill');
  fill.style.width = `${Math.max(0, Math.min(100, line.percent))}%`;
  bar.append(fill);
  const wrap = el('div', 'usage');
  wrap.append(head, bar);
  return wrap;
}

function badge(className: string, text: string, iconName?: 'warn' | 'clock'): HTMLElement {
  const b = el('span', className);
  if (iconName) b.append(icon(iconName, iconName === 'clock' ? 13 : 14));
  b.append(text);
  return b;
}

// Spec 3.1: [다시 로그인] shows only when the login needs attention (the user may later narrow this to expired only).
function needsRelogin(status: AccountStatus, expiry: ExpiryState): boolean {
  return status === 'login-required' || expiry === 'expired' || expiry === 'soon';
}

// Cards are reordered by drag and drop on the card body, or by Alt+ArrowUp/Down from a control inside the card.
function makeMovable(c: HTMLElement, a: AccountView, index: number, count: number): void {
  c.draggable = true;
  let pressedOnButton = false;
  c.addEventListener('pointerdown', (e) => {
    pressedOnButton = e.target instanceof Element && e.target.closest('button') !== null;
  });
  c.addEventListener('dragstart', (e) => {
    if (pressedOnButton) { // buttons stay buttons, not drag handles
      e.preventDefault();
      return;
    }
    drag = { id: a.id, from: index };
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => c.classList.add('dragging')); // after the browser has taken the drag image from the undimmed card
  });
  c.addEventListener('dragend', endDrag);
  c.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const to = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (to >= 0 && to < count) api.moveAccount(a.id, to);
  });
}

function card(a: AccountView, index: number, s: AppState, now: Date): HTMLElement {
  const loginRequired = a.status === 'login-required';
  const stale = a.status === 'stale';
  const showLines = !loginRequired && a.lines.length > 0;
  const limit = showLines && a.lines.some((l) => l.percent >= 100);
  const expiry = describeExpiry(a.credentialExpiresAt, now);
  const expiring = expiry.state === 'soon' || expiry.state === 'expired';
  const active = s.activeEmail !== null && s.activeEmail.toLowerCase() === a.email.toLowerCase();

  const c = el('section', loginRequired || limit ? 'card alert' : 'card');
  makeMovable(c, a, index, s.accounts.length);
  const head = el('div', 'card-head');
  head.append(el('span', 'email', a.email));
  const badges = el('div', 'badges');
  if (stale) badges.append(badge('badge-stale', a.fetchedAt ? `${ageOf(a.fetchedAt, now)} 값` : '조회 실패', 'clock'));
  if (loginRequired) badges.append(badge('badge-alert', '로그인 필요', 'warn'));
  if (active) {
    const b = badge('badge-active', '지금 사용 중');
    b.prepend(el('span', 'dot'));
    badges.append(b);
  }
  const remove = button(`remove:${a.id}`, '×', 'btn close', () => api.removeAccount(a.id), s.login.inProgress);
  remove.setAttribute('aria-label', `${a.email} 계정 삭제`);
  badges.append(remove);
  head.append(badges);
  c.append(head);

  if (loginRequired) {
    c.append(el('p', 'card-text', '로그인이 만료되어 사용량을 읽을 수 없습니다.'));
    const first = a.lines[0];
    if (first && a.fetchedAt) {
      c.append(el('p', 'card-text sub', `마지막 조회 ${formatDateTime(a.fetchedAt)} · ${displayLabel(first.label)} ${first.percent}% 사용`));
    }
  } else if (showLines) {
    const lines = el('div', a.status === 'loading' ? 'lines dim' : 'lines');
    if (limit) {
      const row = el('div', 'limit-row');
      row.append(icon('warn', 16), el('span', undefined, '한도에 도달했습니다'));
      lines.append(row);
    }
    for (const line of a.lines) lines.append(usageLine(line, stale));
    c.append(lines);
  } else if (a.status === 'loading') {
    c.append(el('p', 'card-text', '조회 중…'));
  }

  if (stale) {
    const preview = el('div', 'preview');
    const lines = a.failurePreview ?? [];
    preview.append(el('span', 'preview-title', lines.length > 0 ? '이번 조회는 실패했습니다. Claude Code의 응답:' : '이번 조회는 실패했습니다.'));
    for (const line of lines) preview.append(el('span', 'preview-line', line));
    c.append(preview);
  }

  const foot = el('div', loginRequired ? 'card-foot end' : 'card-foot');
  if (!loginRequired) {
    const ex = el('span', expiring ? 'expiry soon' : 'expiry');
    if (expiring) ex.append(icon('warn', 14));
    ex.append(expiry.text);
    foot.append(ex);
  }
  if (needsRelogin(a.status, expiry.state)) {
    const buttons = el('div', 'card-buttons');
    buttons.append(button(`relogin:${a.id}`, '다시 로그인', 'btn small primary', () => api.relogin(a.id)));
    foot.append(buttons);
  }
  c.append(foot);
  return c;
}

// The gap the pointer is over: 0 above the first card, n below the last; each card's middle is the border.
function gapAt(y: number): number {
  const cards = [...root.querySelectorAll<HTMLElement>('section.card')];
  const i = cards.findIndex((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return i < 0 ? cards.length : i;
}

// Draws the drop line at `gap`, or none for null or for a drop that would not move the card.
function showGap(gap: number | null): void {
  const cards = [...root.querySelectorAll<HTMLElement>('section.card')];
  for (const c of cards) c.classList.remove('drop-before', 'drop-after');
  if (!drag || gap === null || dropIndex(drag.from, gap) === null) return;
  if (gap < cards.length) cards[gap].classList.add('drop-before');
  else cards[cards.length - 1]?.classList.add('drop-after');
}

function endDrag(): void {
  drag = null;
  render(); // the latest state, held back while the drag ran; also clears the dimming and the drop line
}

function cardsBody(s: AppState, now: Date): HTMLElement {
  const body = el('main', 'body');
  body.addEventListener('dragenter', (e) => { if (drag) e.preventDefault(); });
  body.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault(); // accept the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    showGap(gapAt(e.clientY));
  });
  body.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault();
    const to = dropIndex(drag.from, gapAt(e.clientY));
    if (to !== null && state) {
      api.moveAccount(drag.id, to);
      // Draw the new order at once instead of the old one until the service answers. Every case where the
      // service ignores the move (login, removal, card gone) ends in a state:changed that brings the true order back.
      state = { ...state, accounts: moveById(state.accounts, drag.id, to) };
    }
    // dragend follows on the dragged card and ends the drag
  });
  body.append(...bands(s));
  s.accounts.forEach((a, i) => body.append(card(a, i, s, now)));
  if (s.accounts.length === 1) {
    body.append(el('p', 'hint', '다른 계정을 추가하려면 브라우저에서 그 계정으로 로그인한 뒤 [계정 추가]를 누릅니다.'));
  }
  return body;
}

function footerText(s: AppState, screen: Screen, now: Date): string {
  if (screen === 'no-claude') return 'Claude Code 연결 안 됨';
  const claude = s.claude.version ? `Claude Code ${s.claude.version}` : 'Claude Code';
  let text: string;
  if (screen !== 'cards') {
    text = `${claude} 연결됨`;
  } else {
    const stale = s.accounts.find((a) => a.status === 'stale' && a.fetchedAt !== null);
    text = stale
      ? `${stale.email.split('@')[0]} 계정은 ${ageOf(stale.fetchedAt!, now)} 값입니다 · ${claude}`
      : `${describeAge(s.lastFetchAt, now)} · ${claude}`;
  }
  if (!isSupportedClaudeVersion(s.claude.version)) text += ` · ${MIN_CLAUDE_VERSION} 이상으로 업데이트해 주세요`;
  return text;
}

// Spec 3.1: switches the read every five minutes on and off. While the model-call pause holds, it is locked (the band says why).
function autoRefreshButton(s: AppState): HTMLButtonElement {
  const text = s.autoRefreshPaused ? '자동 새로고침 멈춤' : s.autoRefresh ? '자동 새로고침 켜짐' : '자동 새로고침 꺼짐';
  const b = button('auto-refresh', text, 'btn toggle', () => { if (state) api.setAutoRefresh(!state.autoRefresh); }, s.autoRefreshPaused);
  b.setAttribute('aria-pressed', String(s.autoRefresh));
  b.prepend(el('span', s.autoRefresh && !s.autoRefreshPaused ? 'toggle-dot on' : 'toggle-dot'));
  return b;
}

// Redraws only what changes by the second: the [새로고침] countdown and the footer.
function tick(): void {
  if (!state) return;
  const now = new Date();
  if (Math.floor(now.getTime() / 60_000) !== renderedMinute && !drag) {
    render(); // minute-based texts ("12분 전 값", "N일 남음") change; during a drag endDrag() redraws
    return;
  }
  if (refreshButton) {
    const left = state.cooldownUntil === null ? 0 : Math.ceil((Date.parse(state.cooldownUntil) - now.getTime()) / 1000);
    refreshButton.textContent = left > 0 ? `새로고침 (${left}초)` : '새로고침';
    refreshButton.disabled = left > 0 || state.refreshing || state.login.inProgress;
  }
  if (footer) footer.textContent = footerText(state, screenOf(state), now);
}

function render(): void {
  if (!state || drag) return; // state is kept up to date meanwhile; endDrag() draws the latest one
  const s = state;
  const now = new Date();
  renderedMinute = Math.floor(now.getTime() / 60_000);
  const screen = screenOf(s);
  // Keep the reader's place: a redraw of the same screen keeps the list's scroll position and the focused control.
  const oldBody = root.querySelector<HTMLElement>('main.body');
  const scrollTop = screen === renderedScreen && oldBody ? oldBody.scrollTop : 0;
  const focusKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
  const body = screen === 'no-claude' ? noClaudeBody(s)
    : screen === 'login' ? el('main', 'body')
    : screen === 'empty' ? emptyBody(s)
    : cardsBody(s, now);
  footer = el('span', 'foot-text');
  const foot = el('footer', 'foot');
  foot.append(footer);
  if (screen === 'cards' || screen === 'empty') foot.append(autoRefreshButton(s));
  const parts: Node[] = [header(s, screen), body, foot];
  if (screen === 'login') parts.push(loginOverlay());
  root.replaceChildren(...parts);
  renderedScreen = screen;
  body.scrollTop = scrollTop;
  tick(); // before focusing: tick() enables the live [새로고침]
  if (focusKey) root.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  if (!s.refreshing) requestAnimationFrame(() => requestAnimationFrame(() => api.reportPainted()));
}

api.onState((s) => {
  state = s;
  render();
});
void api.getState().then((s) => {
  if (s && !state) {
    state = s;
    render();
  }
});
setInterval(tick, 1000);
// Over anything but the list a drop is not taken, so no drop line shows; leaving the window ends the drag.
document.addEventListener('dragover', (e) => {
  if (drag && !(e.target instanceof Element && e.target.closest('main.body'))) showGap(null);
});
document.addEventListener('dragleave', (e) => {
  if (drag && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) endDrag();
});
