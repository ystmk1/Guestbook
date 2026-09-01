/* =====================================================================
   모눈 위의 거리장(distance field)

   세로로 흐르는 척추(0)에서 좌우로 멀어질수록 숫자가 커진다.
   멀수록 셀이 성기게 남아, 가까운 곳은 덩어리로 먼 곳은 흩날리는
   손그림 등고선처럼 보인다.

   방명록 한 줄 = 셀 하나. 위에서부터 한 칸씩 차오른다.
   ===================================================================== */

export interface Cell {
  x: number;
  y: number;
  /** 척추로부터의 가로 거리 = 칸에 적히는 숫자 */
  d: number;
}

/* ── 결정론적 값 노이즈 ───────────────────────────────────────────── */

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1013904223);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const e = hash(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
}

/* ── 팔레트 ──────────────────────────────────────────────────────── */

const RULE = 'rgba(24, 24, 24, 0.052)';
const RULE_BOLD = 'rgba(24, 24, 24, 0.085)';
const CELL_BG = 'rgba(24, 24, 24, 0.030)';
const CELL_EDGE = 'rgba(24, 24, 24, 0.055)';
const CELL_NUM = 'rgba(24, 24, 24, 0.30)';

/**
 * 채워진 칸 — 여기가 "색깔이 생기는" 지점이다.
 * 한 가지 먹색으로 통일하면 판이 딱딱해져서, 회색 스펙트럼에서
 * 칸마다 하나씩 고른다. 시드가 고정이라 다시 그려도 색이 안 바뀐다.
 *
 * 숫자 색은 바탕 밝기를 따라 간다. 밝은 회색 위에 흰 숫자를 얹으면
 * 안 보이므로 B0/C9 에서는 먹색으로 뒤집는다.
 */
const FILL_TONES: { bg: string; fg: string }[] = [
  { bg: '#696969', fg: 'rgba(255, 255, 255, 0.88)' },
  { bg: '#8f8f8f', fg: 'rgba(255, 255, 255, 0.90)' },
  { bg: '#b0b0b0', fg: 'rgba(24, 24, 24, 0.60)' },
  { bg: '#c9c9c9', fg: 'rgba(24, 24, 24, 0.56)' },
];

/** 목표 한 칸 크기 (px) */
const CELL_TARGET = 24;

/* ── 형태 ────────────────────────────────────────────────────────── */

/** 세로로 흐르는 척추의 열 위치 */
function spineAt(y: number, cols: number, rows: number): number {
  const t = y / Math.max(1, rows - 1);
  const wander = (noise2(0, y * 0.09, 71) - 0.5) * cols * 0.055;
  return cols * 0.7 + wander + Math.sin(t * 2.1) * cols * 0.012;
}

/**
 * 척추에서 뻗어나갈 수 있는 최대 거리.
 * 위는 넓게 퍼지고 아래로 갈수록 줄기만 남는다 — 레퍼런스의 인상.
 * 왼쪽이 오른쪽보다 훨씬 멀리 간다.
 */
function reach(y: number, rows: number, side: number): number {
  const t = y / Math.max(1, rows - 1);

  // 위쪽 절반은 계속 넓게 유지하다가 아래로 가며 줄기만 남긴다.
  // pow(1-t) 로 하면 맨 위에서만 넓고 바로 좁아져 레퍼런스와 달라진다.
  const k = Math.max(0, Math.min(1, (t - 0.42) / 0.58));
  const up = 1 - k * k * (3 - 2 * k);

  const wobble = 0.72 + 0.52 * noise2(side * 7, y * 0.13, 23);
  return (side < 0 ? 3 + 62 * up : 3 + 24 * up) * wobble;
}

/**
 * 거리 d 인 칸이 살아남을 확률.
 * 부드러운 노이즈를 문턱과 비교하는 방식은 멀어질수록 값 자체가
 * 안 나와서 먼 영역이 통째로 비어버린다. 확률로 뽑아야 레퍼런스처럼
 * "성기지만 끝까지 이어지는" 흩뿌림이 나온다.
 */
function survival(d: number): number {
  return Math.exp(-d / 18);
}

/** a~b 구간에서 부드럽게 0 → 1 */
function step(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * 격자 위에 실제로 남을 칸들을 만든다.
 * 캔버스와 무관한 순수 함수라 따로 검증할 수 있다.
 * 반환 순서가 곧 채워지는 순서 — 화면 전체에 흩어지도록 섞어서 낸다.
 */
export function buildCells(cols: number, rows: number): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<number>();

  for (let y = 0; y < rows; y++) {
    const s = spineAt(y, cols, rows);
    const row: Cell[] = [];

    for (const side of [-1, 1]) {
      const max = reach(y, rows, side);

      for (let d = side < 0 ? 1 : 0; d <= max; d++) {
        const x = Math.round(s + side * d);
        if (x < 0 || x >= cols) continue;

        // region — 큰 구조. 낮은 곳은 통째로 비워 가지 사이의 여백을 만든다
        // mid    — 가로로 늘인 결. 남은 곳을 줄무늬로 뭉친다
        // runR   — 가로 4칸이 같은 값을 공유한다. 낱알이 아니라
        //          레퍼런스처럼 2~6칸짜리 토막으로 남게 하는 장치다
        // cellR  — 그 토막 안에 다시 구멍을 낸다
        const region = step(0.34, 0.62, noise2(x * 0.05, y * 0.1, 47));
        const mid = noise2(x * 0.1, y * 0.4, 11);
        const runR = hash(Math.floor(x / 4), y, 3);
        const cellR = hash(x, y, 61);

        if (runR > survival(d) * region * (0.4 + 1.4 * mid)) continue;
        if (cellR > 0.86) continue;
        row.push({ x, y, d });
      }
    }

    row.sort((a, b) => a.x - b.x);
    for (const c of row) {
      const key = c.y * cols + c.x;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }

  // 채워지는 순서를 흩어놓는다.
  // 읽는 순서대로 채우면 위에서부터 줄이 차오르는 그림이 되는데,
  // 화면 전체에 무작위로 번지는 편이 낫다. 시드가 고정이라 같은 화면
  // 크기면 몇 번을 새로 고쳐도 n번째 글은 늘 같은 칸에 앉는다.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(hash(i, 0, 907) * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }

  return out;
}

export interface Paper {
  cell: number;
  cells: Cell[];
  capacity: number;
  /** 화면 좌표 → cells 인덱스 (없으면 -1) */
  hit(px: number, py: number): number;
  /** 채워진 개수와 방금 찬 칸의 진행도로 다시 그린다 */
  draw(filled: number, growT: number): void;
  resize(w: number, h: number): void;
  /** 셀의 화면 사각형 */
  rectOf(i: number): { x: number; y: number; w: number; h: number };
}

export function createPaper(canvas: HTMLCanvasElement): Paper {
  const ctx = canvas.getContext('2d')!;

  let cols = 0;
  let rows = 0;
  let cell = CELL_TARGET;
  let W = 0;
  let H = 0;
  let dpr = 1;

  let cells: Cell[] = [];
  let lookup = new Map<number, number>();
  let base: HTMLCanvasElement | null = null;

  /* ── 생성 ─────────────────────────────────────────────────────── */
  function build(): void {
    cells = buildCells(cols, rows);
    lookup = new Map();
    for (let i = 0; i < cells.length; i++) {
      lookup.set(cells[i].y * cols + cells[i].x, i);
    }
  }

  /* ── 정적 레이어 ───────────────────────────────────────────────
     모눈과 안 채워진 칸은 변하지 않는다. 한 번만 그려두고 매번
     통째로 복사한다 — 셀이 수천 개여도 다시 그릴 일이 없다. */
  function paintBase(): void {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    const b = c.getContext('2d')!;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 배경을 칠하지 않는다. 캔버스는 투명하게 두고 뒤에 깔린 영상이
    // 그대로 비쳐 보이게 한다. 종이색은 body 가 낸다.

    // 모눈 — 5칸마다 조금 진하게
    b.lineWidth = 1;
    for (let i = 0; i <= cols; i++) {
      const x = Math.round(i * cell) + 0.5;
      b.strokeStyle = i % 5 === 0 ? RULE_BOLD : RULE;
      b.beginPath();
      b.moveTo(x, 0);
      b.lineTo(x, H);
      b.stroke();
    }
    for (let j = 0; j <= rows; j++) {
      const y = Math.round(j * cell) + 0.5;
      b.strokeStyle = j % 5 === 0 ? RULE_BOLD : RULE;
      b.beginPath();
      b.moveTo(0, y);
      b.lineTo(W, y);
      b.stroke();
    }

    const fs = Math.max(8, cell * 0.42);
    b.font = fs + 'px "SM3SJGothic", "Malgun Gothic", sans-serif';
    b.textAlign = 'center';
    b.textBaseline = 'middle';

    for (const q of cells) {
      const x = q.x * cell;
      const y = q.y * cell;

      b.fillStyle = CELL_BG;
      b.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      b.strokeStyle = CELL_EDGE;
      b.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);

      b.fillStyle = CELL_NUM;
      b.fillText(String(q.d), x + cell / 2, y + cell / 2);
    }

    base = c;
  }

  /* ── 합성 ─────────────────────────────────────────────────────── */
  function draw(filled: number, growT: number): void {
    if (!base) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const fs = Math.max(8, cell * 0.42);
    ctx.font = fs + 'px "SM3SJGothic", "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const n = Math.min(filled, cells.length);
    for (let i = 0; i < n; i++) {
      const q = cells[i];
      const x = q.x * cell;
      const y = q.y * cell;

      // 마지막 칸은 스며들 듯 나타난다
      const a = i === n - 1 ? growT : 1;
      if (a <= 0) continue;

      const tone = FILL_TONES[hash(q.x, q.y, 401) * FILL_TONES.length | 0];

      ctx.globalAlpha = a;
      ctx.fillStyle = tone.bg;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

      ctx.fillStyle = tone.fg;
      ctx.fillText(String(q.d), x + cell / 2, y + cell / 2);
    }
    ctx.globalAlpha = 1;
  }

  /* ── 크기 ─────────────────────────────────────────────────────── */
  function resize(w: number, h: number): void {
    W = w;
    H = h;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    // 화면을 딱 나누어 떨어지는 칸 크기를 고른다 (모눈이 끝에서 잘리지 않게)
    cols = Math.max(8, Math.round(w / CELL_TARGET));
    cell = w / cols;
    rows = Math.ceil(h / cell);

    // 백버퍼 크기만 바꾼다. style 로 px 를 박아버리면 CSS 크기가 고정되어
    // 창을 줄여도 ResizeObserver 가 다시 울리지 않는다.
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));

    build();
    paintBase();
  }

  return {
    get cell() {
      return cell;
    },
    get cells() {
      return cells;
    },
    get capacity() {
      return cells.length;
    },
    hit(px, py) {
      const x = Math.floor(px / cell);
      const y = Math.floor(py / cell);
      const i = lookup.get(y * cols + x);
      return i === undefined ? -1 : i;
    },
    rectOf(i) {
      const q = cells[i];
      return { x: q.x * cell, y: q.y * cell, w: cell, h: cell };
    },
    draw,
    resize,
  };
}
