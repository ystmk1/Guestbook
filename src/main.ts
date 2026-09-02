import './style.css';

import { LIMITS, type Entry } from './config';
import { Store } from './store';
import { createPaper } from './grid';
import { exportLog } from './export';
import { blockAccidentalZoom, trackZoom } from './zoom';
import { startTicker } from './ticker';
import { startOrbit } from './orbit';

/* =====================================================================
   Sympoiesis · 방명록

   방명록 한 줄이 모눈 한 칸을 차지한다. 어느 칸인지는 기록이 직접
   들고 있다(slot) — 순서가 아니라 번호라서, 가운데 하나를 지워도
   나머지가 자리를 옮기지 않는다.
   ===================================================================== */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('paper');
const noteEl = $<HTMLElement>('note');
const noteN = $<HTMLElement>('note-n');
const noteT = $<HTMLElement>('note-t');
const noteD = $<HTMLElement>('note-d');
const noteWho = $<HTMLElement>('note-who');
const formEl = $<HTMLFormElement>('compose');
const inputEl = $<HTMLInputElement>('entry');
const whoEl = $<HTMLInputElement>('who');
const confirmEl = $<HTMLElement>('confirm');
const confirmBody = $<HTMLElement>('confirm-body');
const confirmOk = $<HTMLButtonElement>('confirm-ok');
const confirmCancel = $<HTMLButtonElement>('confirm-cancel');

/*  확대 대응은 판면을 만들기 전에 걸어둔다.
    --zoom 이 정해져야 --head 가 결정되고, 그래야 캔버스 높이가 맞다. */
trackZoom();
blockAccidentalZoom();

startTicker(
  $<HTMLElement>('ticker-track'),
  '양쪽 식물의 잎을 각각 줄기에 가깝게 잡고 기다려주세요',
);

startOrbit(document.querySelector('.shots') as HTMLElement);

const paper = createPaper(canvas);
const store = new Store();

let entries: Entry[] = [];

/** 칸 번호 → 기록 */
const bySlot = new Map<number, Entry>();
/** 기록 id → 앉은 칸 번호 */
const slotOf = new Map<string, number>();
/** 기록 id → 화면에 보이는 번호 */
const numberOf = new Map<string, number>();

let occupied: ReadonlySet<number> = new Set();

let hoverSlot = -1;

/** 방금 채워져 스며드는 중인 칸 */
let growSlot = -1;
let growT = 1;
let growAt = 0;

/**
 * 기록을 실제 칸에 앉힌다.
 *
 * 두 번에 나눠 도는 이유 — 먼저 제 번호가 멀쩡한 것들을 앉히고,
 * 남은 것(번호가 없거나 겹치거나 화면 밖)만 빈자리에 넣는다.
 * 한 번에 돌면 앞엣것이 뒤엣것의 번호를 먼저 차지해버린다.
 */
function remap(): void {
  bySlot.clear();
  slotOf.clear();
  numberOf.clear();

  const cap = paper.capacity;
  const rest: Entry[] = [];

  entries.forEach((e, i) => {
    numberOf.set(e.id, i + 1);
    const s = e.slot;
    if (Number.isInteger(s) && s >= 0 && s < cap && !bySlot.has(s)) bySlot.set(s, e);
    else rest.push(e);
  });

  // 판이 다 찼거나 화면이 작아져 번호가 범위를 벗어난 경우 빈자리로 되돌려 쓴다
  let scan = 0;
  for (const e of rest) {
    while (scan < cap && bySlot.has(scan)) scan++;
    if (scan >= cap) break;
    bySlot.set(scan, e);
  }

  for (const [slot, e] of bySlot) slotOf.set(e.id, slot);
  occupied = new Set(bySlot.keys());
}

/* ── 그리기 ─────────────────────────────────────────────────────
   칸이 숨쉬므로 루프는 상시 돌지만 30fps 로 제한한다. 6.5초에 한 번
   오가는 느린 변화라 그 이상은 의미가 없고, 하루 종일 켜두는 화면이라
   그만큼 덜 먹는다. 탭이 가려지면 rAF 자체가 멈춘다. */
const FRAME_MS = 1000 / 30;
let lastPaint = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (now - lastPaint < FRAME_MS) return;
  lastPaint = now;

  if (growT < 1) growT = Math.min(1, (now - growAt) / 500);
  paper.draw(occupied, growSlot, growT, now / 1000);
}

requestAnimationFrame(frame);

/* ── 왼쪽 열 크기 맞추기 ────────────────────────────────────────────
   전시장 화면 해상도를 모르므로 픽셀로 못 박지 않는다. 위아래 여백만
   지키고, 덩어리 전체를 남는 높이에 맞춰 확대·축소한다.

   transform 은 레이아웃 크기를 바꾸지 않으므로 offsetHeight 는 늘
   원래 높이다 — 재는 값과 그리는 값이 서로를 밀어내지 않는다. */
const sideEl = document.querySelector('.side') as HTMLElement;
const sideInner = $<HTMLElement>('side-inner');

/*  오른쪽 위 설명 줄글은 왼쪽 캡션의 둘째 줄(재료·크기)과 같은 높이에서
    시작한다. 그 줄이 화면 어디에 놓이는지는 왼쪽 열을 얼마나 확대했는지에
    달렸으므로, 계산하지 않고 실제로 그려진 자리를 잰다. */
const aboutEl = document.querySelector('.about') as HTMLElement | null;
const l2El = document.querySelector('.label .l2') as HTMLElement | null;

const tickerEl = document.querySelector('.ticker') as HTMLElement | null;

function placeAbout(): void {
  if (!aboutEl || !l2El) return;
  // 좁은 화면에서는 둘 다 숨어 있다 — 잰 값이 0이면 손대지 않는다
  const y = l2El.getBoundingClientRect().top;
  if (y <= 0) return;
  aboutEl.style.top = `${Math.round(y)}px`;

  /*  좌우 여백을 이 줄글의 위 여백과 같은 값으로 맞춘다 — 판면이 같은 폭
      으로 둘러싸인 것처럼 보인다. 좌우 여백은 세로 배치를 건드리지 않으므로
      되먹여도 다시 재는 일이 없다. */
  const top = tickerEl ? tickerEl.getBoundingClientRect().bottom : 0;
  const frame = Math.round(y - top);
  if (frame > 0) document.documentElement.style.setProperty('--frame', `${frame}px`);
}

function fitSide(): void {
  /*  왼쪽 열이 내려갈 수 있는 바닥 = 입력줄 윗변.
      높이를 상수로 박지 않고 실제로 잰다 — 글꼴이나 확대 배율에 따라
      입력줄 높이가 달라진다.
      밴드 높이를 읽기 전에 넣어야 이번 호출에서 바로 반영된다. */
  const composeTop = formEl.getBoundingClientRect().top;
  if (composeTop > 0) {
    const floor = Math.max(0, Math.round(window.innerHeight - composeTop));
    document.documentElement.style.setProperty('--side-bottom', `${floor}px`);
  }

  const band = sideEl.clientHeight;
  const natural = sideInner.offsetHeight;
  if (!band || !natural) return;

  const k = Math.max(0.5, Math.min(1.8, band / natural));
  sideInner.style.transform = `scale(${k.toFixed(4)})`;

  /*  오른쪽 줄글은 이 덩어리 밖에 있어 scale 을 못 받는다. 배율을 내어주면
      글자 크기를 같은 비율로 키워 두 글이 같은 크기로 읽힌다.
      행간은 단위 없는 비율이라 글자를 따라 저절로 벌어진다. */
  document.documentElement.style.setProperty('--side-k', k.toFixed(4));

  // transform 은 바로 반영되므로 이어서 재도 어긋나지 않는다
  placeAbout();
}

new ResizeObserver(fitSide).observe(sideEl);
new ResizeObserver(fitSide).observe(sideInner);

// 사진과 글꼴이 늦게 들어오면 높이가 달라진다
for (const img of sideInner.querySelectorAll('img')) {
  img.addEventListener('load', fitSide, { once: true });
}
void document.fonts?.ready.then(fitSide).catch(() => undefined);
fitSide();

/* ── 크기 ───────────────────────────────────────────────────────── */
function fit(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  paper.resize(w, h);
  remap();
  closeNote();
}

new ResizeObserver(fit).observe(canvas);
fit();

/* ── 기록 ───────────────────────────────────────────────────────── */
store.subscribe((next) => {
  const newest = next.length > entries.length ? next[next.length - 1] : null;
  entries = next;
  remap();

  if (newest) {
    // 새로 앉은 칸을 500ms 에 걸쳐 스며들게 한다
    growSlot = slotOf.get(newest.id) ?? -1;
    growT = 0;
    growAt = performance.now();
  }
});

/* ── 쪽지 ───────────────────────────────────────────────────────── */
function openNote(slot: number): void {
  const entry = bySlot.get(slot);
  if (!entry) return;

  noteN.textContent = String(numberOf.get(entry.id) ?? 0).padStart(3, '0');
  noteT.textContent = entry.body;
  noteWho.textContent = entry.name ?? '';

  const d = new Date(entry.createdAt);
  const p = (v: number) => String(v).padStart(2, '0');
  noteD.textContent =
    d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) +
    '  ' + p(d.getHours()) + ':' + p(d.getMinutes());

  // 숨김을 먼저 풀어야 실제 높이를 잴 수 있다.
  // 글자수 제한이 없어서 줄 수에 따라 높이가 매번 달라진다.
  noteEl.hidden = false;

  const r = paper.rectOf(slot);
  const top = canvas.getBoundingClientRect().top;
  const w = noteEl.offsetWidth;
  const h = noteEl.offsetHeight;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  /** 화면 테두리에서 최소한 이만큼은 띄운다 */
  const EDGE = 16;
  /** 칸과 쪽지 사이 */
  const GAP = 10;
  /** 아래쪽은 입력줄을 덮지 않게 더 띄운다 */
  const FLOOR = vh - 92;

  const nodeL = r.x;
  const nodeR = r.x + r.w;
  const nodeT = top + r.y;
  const nodeB = top + r.y + r.h;

  // 가로 — 오른쪽을 먼저 보고, 안 들어가면 왼쪽으로 뒤집는다
  let x = nodeR + GAP;
  if (x + w > vw - EDGE) x = nodeL - GAP - w;
  if (x < EDGE) x = Math.min(Math.max(EDGE, nodeR + GAP), vw - EDGE - w);
  if (x < EDGE) x = EDGE;

  // 세로 — 칸 위쪽에 맞춰 내려 그리다가, 바닥을 넘으면 칸 위로 올려 붙인다
  let y = nodeT - 6;
  if (y + h > FLOOR) y = nodeB + 6 - h;
  if (y < EDGE) y = EDGE;
  if (y + h > vh - EDGE) y = Math.max(EDGE, vh - EDGE - h);

  noteEl.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
}

function closeNote(): void {
  noteEl.hidden = true;
}

/* ── 포인터 ─────────────────────────────────────────────────────── */
function slotAt(ev: { clientX: number; clientY: number }): number {
  const r = canvas.getBoundingClientRect();
  const i = paper.hit(ev.clientX - r.left, ev.clientY - r.top);
  return i >= 0 && bySlot.has(i) ? i : -1;
}

canvas.addEventListener('pointermove', (ev) => {
  const next = slotAt(ev);
  if (next === hoverSlot) return;

  hoverSlot = next;
  canvas.style.cursor = next >= 0 ? 'pointer' : 'default';

  // 캔버스에 그려지는 호버 표시가 없으므로 다시 그리지 않는다.
  // 바뀌는 건 커서 모양과 쪽지뿐이다.
  if (next >= 0) openNote(next);
  else closeNote();
});

canvas.addEventListener('pointerleave', () => {
  if (hoverSlot === -1) return;
  hoverSlot = -1;
  canvas.style.cursor = 'default';
  closeNote();
});

// 판면 아무 데나 누르면 바로 타이핑할 수 있게
canvas.addEventListener('click', () => {
  inputEl.focus();
});

/* ── 관리자 삭제 ────────────────────────────────────────────────────
   Ctrl + Alt + Shift 를 누른 채 칸을 우클릭하면 확인창이 뜬다.
   지운 칸의 번호는 순서 맨 뒤로 밀려, 판이 다 차기 전에는 다시 쓰이지
   않는다. 지운 기록은 격리 목록에 남아 되살릴 수 있다. */
let pending: Entry | null = null;

// 전시용 화면이라 오른쪽 클릭 메뉴는 늘 막는다
window.addEventListener('contextmenu', (ev) => ev.preventDefault());

canvas.addEventListener('contextmenu', (ev) => {
  if (!ev.ctrlKey || !ev.altKey || !ev.shiftKey) return;

  const slot = slotAt(ev);
  const entry = slot >= 0 ? bySlot.get(slot) : undefined;
  if (!entry) return;

  pending = entry;
  confirmBody.textContent = entry.body;
  confirmEl.hidden = false;
  confirmOk.focus();
});

function closeConfirm(): void {
  pending = null;
  confirmEl.hidden = true;
  inputEl.focus();
}

confirmOk.addEventListener('click', () => {
  if (pending) store.remove(pending.id);
  closeNote();
  closeConfirm();
});

confirmCancel.addEventListener('click', closeConfirm);

/* ── 입력 ───────────────────────────────────────────────────────── */
whoEl.maxLength = LIMITS.nameMax;

formEl.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!inputEl.value.trim()) return;
  if (bySlot.size >= paper.capacity) return;

  if (store.add(inputEl.value, whoEl.value)) {
    // 이름까지 비운다. 전시장에서는 다음 차례가 다른 사람이라
    // 이름이 남아 있으면 앞사람 이름으로 글이 올라간다.
    inputEl.value = '';
    whoEl.value = '';
  }
  closeNote();
  inputEl.focus();
});

inputEl.focus();

/* ── 전체 로그 내려받기 ──────────────────────────────────────────────
   Ctrl + Alt + Shift + O. 전시 마지막 날 기록을 통째로 뽑는다. */
let exporting = false;

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (!confirmEl.hidden) closeConfirm();
    else closeNote();
    return;
  }

  // ev.key 는 수식키가 겹치면 레이아웃에 따라 엉뚱한 값이 온다.
  // 물리 키 위치인 ev.code 로 본다.
  if (ev.code !== 'KeyO' || !ev.ctrlKey || !ev.altKey || !ev.shiftKey) return;
  ev.preventDefault();

  if (exporting) return;
  exporting = true;

  void exportLog(entries, banner)
    .catch(() => banner('내려받기에 실패했습니다'))
    .finally(() => {
      exporting = false;
      window.setTimeout(() => banner(''), 6000);
    });
});

/* ── 알림 줄 ────────────────────────────────────────────────────────
   운영자에게만 보이면 되는 짧은 안내. 평소에는 DOM 에 없다. */
let bannerEl: HTMLElement | null = null;

function banner(msg: string): void {
  if (!msg) {
    bannerEl?.remove();
    bannerEl = null;
    return;
  }
  if (!bannerEl) {
    bannerEl = document.createElement('p');
    bannerEl.className = 'banner';
    document.body.appendChild(bannerEl);
  }
  bannerEl.textContent = msg;
}

/* ── 배경 텍스처 ────────────────────────────────────────────────────
   음소거 자동재생은 대부분 그냥 되지만, 브라우저 정책이나 절전 상태에서
   막히는 경우가 있다. 실패해도 조용히 넘어가고 첫 조작 때 다시 시도한다.
   못 틀어도 흰 바탕이라 화면은 멀쩡하다. */
const bg = document.getElementById('bg') as HTMLVideoElement | null;
if (bg) {
  const kick = () => {
    void bg.play().catch(() => undefined);
  };
  kick();
  document.addEventListener('pointerdown', kick, { once: true });
  document.addEventListener('keydown', kick, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick();
  });
}

/* 콘솔에서 백업을 꺼낼 수 있게 (운영용) */
Object.assign(window as unknown as Record<string, unknown>, { store, paper });
