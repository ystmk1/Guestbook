import { TUNING } from '../config';
import type { FrameState } from '../scene/world';

/* =====================================================================
   3D 위에 얹히는 텍스트 층.

   캔버스에 글자를 직접 그리지 않고 DOM 으로 올린다. 한글 렌더링 품질이
   비교가 안 되고, 폰트 웨이트·자간·줄바꿈을 CSS 로 그대로 쓸 수 있다.
   대신 화면에 동시에 뜨는 개수를 적게 유지한다 (기본 14개).
   ===================================================================== */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function stamp(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

interface LabelEl {
  root: HTMLDivElement;
  time: HTMLSpanElement;
  body: HTMLSpanElement;
  key: string;
}

export interface Overlay {
  update(s: FrameState): void;
  dispose(): void;
}

export function createOverlay(host: HTMLElement): Overlay {
  // ── 주변 라벨 풀 ─────────────────────────────────────────────────
  const pool: LabelEl[] = [];
  for (let i = 0; i < TUNING.ambientLabels; i++) {
    const root = document.createElement('div');
    root.className = 'lbl';
    root.style.opacity = '0';

    const time = document.createElement('span');
    time.className = 'lbl-time';

    const body = document.createElement('span');
    body.className = 'lbl-body';

    root.append(time, body);
    host.appendChild(root);
    pool.push({ root, time, body, key: '' });
  }

  // ── 포커스 카드 ──────────────────────────────────────────────────
  const card = document.createElement('div');
  card.id = 'focus-card';
  card.innerHTML =
    '<p class="fc-body"></p>' +
    '<div class="fc-foot"><span class="fc-nick"></span><span class="fc-time"></span></div>';
  host.appendChild(card);

  const cardBody = card.querySelector<HTMLParagraphElement>('.fc-body')!;
  const cardNick = card.querySelector<HTMLSpanElement>('.fc-nick')!;
  const cardTime = card.querySelector<HTMLSpanElement>('.fc-time')!;
  let cardKey = '';

  // ── 날아가는 문장 ────────────────────────────────────────────────
  const flight = document.createElement('div');
  flight.id = 'flight';
  flight.style.cssText =
    'position:absolute;top:0;left:0;opacity:0;white-space:nowrap;' +
    'font-weight:200;letter-spacing:-.02em;color:#c0524c;will-change:transform,opacity';
  host.appendChild(flight);

  return {
    update(s: FrameState) {
      // ── 주변 라벨 ───────────────────────────────────────────────
      for (let i = 0; i < pool.length; i++) {
        const el = pool[i];
        const a = s.ambient[i];

        if (!a) {
          if (el.root.style.opacity !== '0') el.root.style.opacity = '0';
          continue;
        }

        const key = a.entry.id;
        if (el.key !== key) {
          el.key = key;
          el.time.textContent = stamp(a.entry.createdAt);
          // 라벨은 한 줄만 — 여러 줄 글은 첫 줄만 보여주고 나머지는 호버로
          const first = a.entry.body.split('\n')[0];
          const more = a.entry.body.includes('\n');
          el.body.textContent = more ? `${first} …` : first;
          el.root.dataset.side = a.side;
        }

        const dx = a.side === 'right' ? 13 : -13;
        el.root.style.transform =
          `translate(${(a.x + dx).toFixed(1)}px, ${(a.y - 9).toFixed(1)}px)` +
          (a.side === 'left' ? ' translateX(-100%)' : '');
        el.root.style.opacity = Math.min(1, (a.front - 0.52) / 0.16).toFixed(2);
      }

      // ── 포커스 카드 ─────────────────────────────────────────────
      if (s.focus) {
        const { entry, x, y, t } = s.focus;

        if (cardKey !== entry.id) {
          cardKey = entry.id;
          cardBody.textContent = entry.body;
          cardNick.textContent = entry.nickname ?? '';
          cardTime.textContent = stamp(entry.createdAt);
        }

        // 노드 바로 아래에 붙되 화면 밖으로 나가지 않게 잡아둔다
        const w = card.offsetWidth || 460;
        const h = card.offsetHeight || 160;
        const vw = host.clientWidth;
        const vh = host.clientHeight;

        let cx = x - w / 2;
        let cy = y + 58;
        cx = Math.max(20, Math.min(vw - w - 20, cx));
        // 아래쪽 입력창 영역을 침범하면 노드 위로 올린다
        if (cy + h > vh - 210) cy = y - h - 44;
        cy = Math.max(20, cy);

        card.style.transform =
          `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) scale(${(0.94 + t * 0.06).toFixed(3)})`;
        card.style.opacity = t.toFixed(3);
        card.dataset.pinned = s.focus.pinned ? '1' : '0';
      } else if (card.style.opacity !== '0') {
        card.style.opacity = '0';
        cardKey = '';
      }

      // ── 날아가는 문장 ───────────────────────────────────────────
      if (s.flight) {
        const { text, x, y, t } = s.flight;
        if (flight.textContent !== text) flight.textContent = text;
        const fs = 28 - 16 * t;
        flight.style.fontSize = `${fs.toFixed(1)}px`;
        flight.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -170%)`;
        flight.style.opacity = (1 - t * 0.75).toFixed(2);
      } else if (flight.style.opacity !== '0') {
        flight.style.opacity = '0';
      }
    },

    dispose() {
      for (const el of pool) el.root.remove();
      card.remove();
      flight.remove();
    },
  };
}
