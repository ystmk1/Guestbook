import './style.css';

import { LIMITS, type Entry } from './config';
import { Store } from './store';
import { createInk } from './ink';

/* =====================================================================
   SYMPOIESIS · Guestbook
   ===================================================================== */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const feedEl = $<HTMLOListElement>('feed');
const countEl = $<HTMLElement>('count');
const formEl = $<HTMLFormElement>('compose');
const inputEl = $<HTMLInputElement>('entry');
const bodyEl = $<HTMLElement>('body');
const inkEl = $<HTMLCanvasElement>('ink');
const glEl = $<HTMLCanvasElement>('gl');
const figEl = $<HTMLElement>('figstate');

/* ── 잉크 ───────────────────────────────────────────────────────── */
createInk(inkEl, bodyEl);

/* ── 오브젝트 ─────────────────────────────────────────────────────
   three.js 는 따로 떼어 나중에 불러온다. 판면과 잉크는 이걸 기다리지
   않고 즉시 그려진다 — 첫 화면이 3D 번들에 묶이지 않게. */
void import('./model').then(({ createModel }) => {
  createModel(glEl, '/model.glb', (s) => {
    figEl.textContent = s;
  });
});

/* ── 기록 ───────────────────────────────────────────────────────── */
const store = new Store();

/** 이미 그린 줄은 다시 그리지 않는다 — 누적만 한다 */
let drawn = 0;

function line(entry: Entry, index: number): HTMLLIElement {
  const li = document.createElement('li');

  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = String(index + 1).padStart(3, '0');

  const t = document.createElement('span');
  t.className = 't';
  t.textContent = entry.body;

  li.append(n, t);
  return li;
}

function render(entries: Entry[]): void {
  // 목록이 줄었으면(복원 등) 통째로 다시 그린다
  if (entries.length < drawn) {
    feedEl.replaceChildren();
    drawn = 0;
  }

  if (entries.length > drawn) {
    const frag = document.createDocumentFragment();
    for (let i = drawn; i < entries.length; i++) frag.appendChild(line(entries[i], i));
    feedEl.appendChild(frag);
    drawn = entries.length;
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  countEl.textContent = String(entries.length).padStart(3, '0');
}

store.subscribe(render);

/* ── 입력 ───────────────────────────────────────────────────────── */
inputEl.maxLength = LIMITS.bodyMax;

formEl.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = inputEl.value;
  if (!text.trim()) return;

  if (store.add(text)) {
    inputEl.value = '';
  }
  inputEl.focus();
});

inputEl.focus();

// 판면 아무 데나 눌러도 바로 타이핑할 수 있게
document.addEventListener('pointerdown', (ev) => {
  if ((ev.target as HTMLElement).closest('input, button')) return;
  if (window.getSelection()?.toString()) return;
  inputEl.focus();
});

/* 콘솔에서 백업을 꺼낼 수 있게 (운영용) */
Object.assign(window as unknown as Record<string, unknown>, { store });
