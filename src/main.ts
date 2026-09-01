import './style.css';

import { HUD_TITLE, KIOSK_MODE, TUNING, type Entry } from './config';
import { GuestbookStore, type StoreStatus } from './lib/store';
import { createWorld } from './scene/world';
import { createOverlay } from './ui/overlay';
import { createComposer } from './ui/composer';
import { createAdmin } from './ui/admin';

/* =====================================================================
   SYMPOIESIS · GUESTBOOK
   ===================================================================== */

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const overlayHost = document.getElementById('overlay') as HTMLElement;
const hudTitle = document.getElementById('hud-title') as HTMLElement;
const hudStat = document.getElementById('hud-stat') as HTMLElement;
const hintEl = document.getElementById('hint') as HTMLElement;
const toastEl = document.getElementById('cmp-toast') as HTMLElement;

hudTitle.textContent = `${HUD_TITLE} · GUESTBOOK`;

/* ── 알림 (관리자 기능이 함께 쓴다) ─────────────────────────────── */
let toastTimer: number | undefined;
function toast(text: string, tone: 'ok' | 'warn' = 'ok'): void {
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.dataset.tone = tone;
  toastEl.dataset.show = '1';
  toastTimer = window.setTimeout(() => {
    toastEl.dataset.show = '0';
  }, 3600);
}

/* ── 저장소 ─────────────────────────────────────────────────────── */
const store = new GuestbookStore();

/* ── 씬 ─────────────────────────────────────────────────────────── */
let pinnedEntry: Entry | null = null;

const world = createWorld(canvas, {
  onFocus(entry, _screen, pinned) {
    app.dataset.hover = entry ? '1' : '0';
    app.dataset.pinned = pinned ? '1' : '0';
    pinnedEntry = pinned ? entry : null;
    if (entry) hideHint();
  },
});

const overlay = createOverlay(overlayHost);
world.onFrame((s) => overlay.update(s));

/* ── 목록 반영 ──────────────────────────────────────────────────── */
let entryCount = 0;

function renderStatus(status: StoreStatus): void {
  const n = String(entryCount).padStart(3, '0');
  switch (status) {
    case 'connecting':
      hudStat.textContent = 'CONNECTING…';
      hudStat.dataset.state = '';
      break;
    case 'live':
      hudStat.textContent = `LIVE · ${n} TRACES`;
      hudStat.dataset.state = '';
      break;
    case 'local':
      hudStat.textContent = `LOCAL · ${n} TRACES`;
      hudStat.dataset.state = 'local';
      break;
    case 'offline':
      hudStat.textContent = `OFFLINE · ${n} TRACES`;
      hudStat.dataset.state = 'error';
      break;
  }
}

store.subscribe((entries, status) => {
  entryCount = entries.length;
  world.setEntries(entries);
  renderStatus(status);
});

/* ── 입력 ───────────────────────────────────────────────────────── */
const composer = createComposer({
  submit: (body, nickname) => store.submit(body, nickname),
  sent(from) {
    hideHint();
    // 방금 등록된 글 = 목록의 마지막
    const latest = store.entries[store.entries.length - 1];
    if (latest) world.flyIn(latest, from);
  },
});

/* ── 관리자 ─────────────────────────────────────────────────────── */
createAdmin(store, {
  target: () => pinnedEntry,
  afterHide() {
    world.unpin();
    pinnedEntry = null;
  },
  toast,
});

/* ── 안내문 ─────────────────────────────────────────────────────── */
let hintHidden = false;
function hideHint(): void {
  if (hintHidden) return;
  hintHidden = true;
  hintEl.dataset.hide = '1';
}
window.setTimeout(hideHint, TUNING.hintTimeout);
if (KIOSK_MODE) hintEl.dataset.hide = '0';

/* ── 전시장 운영 편의 ───────────────────────────────────────────── */

// 캔버스를 클릭해도 바로 타이핑할 수 있게 (노드 고정은 그대로 동작한다)
canvas.addEventListener('click', () => {
  const admin = document.getElementById('admin');
  if (admin && !admin.hidden) return;
  if (window.getSelection()?.toString()) return;
  composer.focus();
});

// 오른쪽 클릭 메뉴 · 확대 제스처 · 파일 드래그 차단
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  // Ctrl +/-/0 확대 차단 (전시 중 실수로 레이아웃이 깨지는 것 방지)
  if (e.ctrlKey && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
  // F11 대신 F 로 전체화면
  if (e.key === 'F11') return;
  if ((e.key === 'f' || e.key === 'F') && e.altKey) {
    e.preventDefault();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }
});

// 노트북이 절전으로 들어가 화면이 꺼지는 것을 막는다
async function keepAwake(): Promise<void> {
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<{ addEventListener(t: string, f: () => void): void }> };
  };
  if (!nav.wakeLock) return;
  try {
    const lock = await nav.wakeLock.request('screen');
    lock.addEventListener('release', () => void keepAwake());
  } catch {
    /* 배터리 모드 등에서 거절될 수 있다 — 무시 */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void keepAwake();
});
void keepAwake();

/* ── 시작 ───────────────────────────────────────────────────────── */
void store.start();
composer.focus();

// 전시 중 콘솔에서 상태를 확인할 수 있게 (관리자용)
Object.assign(window as unknown as Record<string, unknown>, {
  __guestbook: { store, world, tips: world.tipCount() },
});
