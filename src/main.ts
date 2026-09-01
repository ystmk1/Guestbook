import './style.css';

import { LIMITS, type Entry } from './config';
import { Store } from './store';
import { createPaper } from './grid';

/* =====================================================================
   Sympoiesis · Guestbook

   방명록 한 줄이 모눈 한 칸을 위에서부터 차례로 채운다.
   채워진 칸을 누르면 그 줄이 나온다.
   ===================================================================== */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('paper');
const noteEl = $<HTMLElement>('note');
const noteN = $<HTMLElement>('note-n');
const noteT = $<HTMLElement>('note-t');
const noteD = $<HTMLElement>('note-d');
const formEl = $<HTMLFormElement>('compose');
const inputEl = $<HTMLInputElement>('entry');

const paper = createPaper(canvas);
const store = new Store();

let entries: Entry[] = [];
let hover = -1;
let selected = -1;

/** 방금 찬 칸이 스며드는 진행도 */
let growT = 1;
let growRaf = 0;

function paint(): void {
  paper.draw(entries.length, hover, growT);
}

/* ── 크기 ───────────────────────────────────────────────────────── */
function fit(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  paper.resize(w, h);
  closeNote();
  paint();
}

new ResizeObserver(fit).observe(canvas);
fit();

/* ── 기록 ───────────────────────────────────────────────────────── */
store.subscribe((next) => {
  const grew = next.length > entries.length;
  entries = next;

  if (!grew) {
    paint();
    return;
  }

  // 마지막 칸을 500ms 에 걸쳐 스며들게 한다
  cancelAnimationFrame(growRaf);
  const t0 = performance.now();
  growT = 0;
  const step = (now: number) => {
    growT = Math.min(1, (now - t0) / 500);
    paint();
    if (growT < 1) growRaf = requestAnimationFrame(step);
  };
  growRaf = requestAnimationFrame(step);
});

/* ── 쪽지 ───────────────────────────────────────────────────────── */
function openNote(i: number): void {
  const entry = entries[i];
  if (!entry) return;

  selected = i;
  noteN.textContent = String(i + 1).padStart(3, '0');
  noteT.textContent = entry.body;

  const d = new Date(entry.createdAt);
  const p = (v: number) => String(v).padStart(2, '0');
  noteD.textContent =
    d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) +
    '  ' + p(d.getHours()) + ':' + p(d.getMinutes());

  noteEl.hidden = false;

  // 칸 옆에 붙이되 화면 밖으로 나가지 않게 잡아둔다
  const r = paper.rectOf(i);
  const top = canvas.getBoundingClientRect().top;
  const w = noteEl.offsetWidth;
  const h = noteEl.offsetHeight;

  let x = r.x + r.w + 10;
  let y = top + r.y - 6;
  if (x + w > window.innerWidth - 12) x = r.x - w - 10;
  if (x < 12) x = 12;
  if (y + h > window.innerHeight - 12) y = window.innerHeight - h - 12;
  if (y < 12) y = 12;

  noteEl.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
}

function closeNote(): void {
  selected = -1;
  noteEl.hidden = true;
}

/* ── 포인터 ─────────────────────────────────────────────────────── */
canvas.addEventListener('pointermove', (ev) => {
  const r = canvas.getBoundingClientRect();
  const i = paper.hit(ev.clientX - r.left, ev.clientY - r.top);
  // 아직 안 채워진 칸은 집히지 않는다
  const next = i >= 0 && i < entries.length ? i : -1;
  if (next === hover) return;
  hover = next;
  canvas.style.cursor = next >= 0 ? 'pointer' : 'default';
  paint();
});

canvas.addEventListener('pointerleave', () => {
  if (hover === -1) return;
  hover = -1;
  canvas.style.cursor = 'default';
  paint();
});

canvas.addEventListener('click', (ev) => {
  const r = canvas.getBoundingClientRect();
  const i = paper.hit(ev.clientX - r.left, ev.clientY - r.top);
  if (i >= 0 && i < entries.length) {
    if (i === selected) closeNote();
    else openNote(i);
  } else {
    closeNote();
    inputEl.focus();
  }
});

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeNote();
});

/* ── 입력 ───────────────────────────────────────────────────────── */
inputEl.maxLength = LIMITS.bodyMax;

formEl.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!inputEl.value.trim()) return;
  if (entries.length >= paper.capacity) return;

  if (store.add(inputEl.value)) inputEl.value = '';
  closeNote();
  inputEl.focus();
});

inputEl.focus();

/* 콘솔에서 백업을 꺼낼 수 있게 (운영용) */
Object.assign(window as unknown as Record<string, unknown>, { store, paper });
