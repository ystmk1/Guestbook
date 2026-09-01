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

const PAPER = '#ffffff';
const RULE = 'rgba(24, 24, 24, 0.052)';
const RULE_BOLD = 'rgba(24, 24, 24, 0.085)';
const CELL_BG = 'rgba(24, 24, 24, 0.030)';
const CELL_EDGE = 'rgba(24, 24, 24, 0.055)';
const CELL_NUM = 'rgba(24, 24, 24, 0.30)';

/** 채워진 칸 — 여기가 "색깔이 생기는" 지점이다 */
const FILL = '#171717';
const FILL_NUM = 'rgba(255, 255, 255, 0.82)';
const HOVER = '#c8452f';

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
 * 반환 순서가 곧 채워지는 순서 — 위에서 아래로, 각 줄은 왼쪽부터.
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

    // 한 줄 안에서는 왼쪽부터 채운다
    row.sort((a, b) => a.x - b.x);
    for (const c of row) {
      const key = c.y * cols + c.x;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }

  return out;
}

export interface Paper {
  cell: number;
  cells: Cell[];
  capacity: number;
  /** 화면 좌표 → cells 인덱스 (없으면 -1) */
  hit(px: number, py: number): number;
  /** 채워진 개수 · 호버 · 방금 찬 칸의 진행도로 다시 그린다 */
  draw(filled: number, hover: number, growT: number): void;
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

    b.fillStyle = PAPER;
    b.fillRect(0, 0, W, H);

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
    b.font = fs + 'px "Architects Daughter", "Pretendard Variable", cursive';
    b.textAlign = 'center';
    b.textBaseline = 'middle';

    for (const q of cells) {
      const x = q.x * cell;
      const y = q.y * cell;

      b.fillStyle = CELL_BG;
      b.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      b.strokeStyle = CELL_EDGE;
      b.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);

      // 손으로 적은 것처럼 — 칸마다 결정론적으로 조금씩 흔들어 놓는다
      const jx = (hash(q.x, q.y, 5) - 0.5) * cell * 0.16;
      const jy = (hash(q.x, q.y, 9) - 0.5) * cell * 0.14;
      const rot = (hash(q.x, q.y, 13) - 0.5) * 0.17;

      b.save();
      b.translate(x + cell / 2 + jx, y + cell / 2 + jy);
      b.rotate(rot);
      b.fillStyle = CELL_NUM;
      b.fillText(String(q.d), 0, 0);
      b.restore();
    }

    base = c;
  }

  /* ── 합성 ─────────────────────────────────────────────────────── */
  function draw(filled: number, hover: number, growT: number): void {
    if (!base) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const fs = Math.max(8, cell * 0.42);
    ctx.font = fs + 'px "Architects Daughter", "Pretendard Variable", cursive';
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

      ctx.globalAlpha = a;
      ctx.fillStyle = FILL;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

      const jx = (hash(q.x, q.y, 5) - 0.5) * cell * 0.16;
      const jy = (hash(q.x, q.y, 9) - 0.5) * cell * 0.14;
      const rot = (hash(q.x, q.y, 13) - 0.5) * 0.17;

      ctx.save();
      ctx.translate(x + cell / 2 + jx, y + cell / 2 + jy);
      ctx.rotate(rot);
      ctx.fillStyle = FILL_NUM;
      ctx.fillText(String(q.d), 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (hover >= 0 && hover < n) {
      const q = cells[hover];
      ctx.strokeStyle = HOVER;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(q.x * cell + 0.8, q.y * cell + 0.8, cell - 1.6, cell - 1.6);
    }
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
