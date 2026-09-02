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

/*  채워진 칸 — 여기가 "색깔이 생기는" 지점이다.
 *
 *  회색을 고정해두면 흰 바탕에 묻혀 잘 안 보인다. 그래서 스펙트럼
 *  양 끝(#696969 ↔ #C9C9C9)을 천천히 오간다.
 *
 *  칸마다 위상을 다르게 준다. 전부 같은 위상이면 판 전체가 한꺼번에
 *  맥동해서 전시장에서 거슬린다. 흩어놓으면 느린 일렁임이 되어
 *  시선만 붙잡는다.
 *
 *  숫자는 색을 뒤집지 않고 먹색으로 고정하되 진하기만 따라간다.
 *  흰색 ↔ 먹색으로 뒤집으면 그 중간에서 바탕과 같은 회색이 되어
 *  글자가 한 번씩 사라진다.
 */
const TONE_MIN = 0x69;
const TONE_MAX = 0xc9;

/** 한 번 숨쉬는 데 걸리는 시간 (초) */
const BREATH = 6.5;

/*  매 프레임 칸마다 색 문자열을 만들면 쓰레기가 쌓인다.
    64단계로 미리 만들어두고 골라 쓴다. */
const STEPS = 64;
const TONE_BG: string[] = [];
const TONE_FG: string[] = [];
for (let i = 0; i < STEPS; i++) {
  const k = i / (STEPS - 1);
  const g = Math.round(TONE_MIN + (TONE_MAX - TONE_MIN) * k);
  TONE_BG.push(`rgb(${g},${g},${g})`);
  // 바탕이 밝아질수록 숫자를 진하게
  TONE_FG.push(`rgba(20,20,20,${(0.5 + 0.4 * k).toFixed(3)})`);
}

const TWO_PI_OVER_BREATH = (Math.PI * 2) / BREATH;

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
  /** 한 칸의 크기 (CSS 픽셀) */
  cellSize: number;
  /** 글이 앉을 수 있는 전체 자리 수 — 격자 전체다 */
  capacity: number;
  /** 그중 밑그림이 깔린 자리 수 */
  patterned: number;
  /** 화면 좌표 → 자리 번호 (없으면 -1) */
  hit(px: number, py: number): number;
  /**
   * 채워진 자리를 그린다.
   * labels 는 자리 번호 → 그 칸에 적을 글자(방명록 순번).
   * growSlot 은 방금 채워져 스며드는 중인 자리.
   */
  draw(
    labels: ReadonlyMap<number, string>,
    growSlot: number,
    growT: number,
    time: number,
  ): void;
  resize(w: number, h: number): void;
  /** 자리의 화면 사각형 (CSS 픽셀) */
  rectOf(i: number): { x: number; y: number; w: number; h: number };
}

export function createPaper(canvas: HTMLCanvasElement): Paper {
  const ctx = canvas.getContext('2d')!;

  let cols = 0;
  let rows = 0;
  let dpr = 1;

  /*  칸 경계를 디바이스 픽셀 정수로 미리 잡아둔다.
      폭 ÷ 열수는 대개 소수라, 그대로 그리면 칸마다 경계가 반 픽셀에
      걸려 한 칸씩 밀린 것처럼 보이고 사이에 실틈이 생긴다.
      경계를 정수로 반올림해두면 칸이 서로 정확히 맞물려 빈틈이 없다. */
  let bx = new Int32Array(0);
  let by = new Int32Array(0);

  /*  cells 앞쪽은 밑그림이 깔린 자리, 뒤쪽은 빈 격자 자리다.
      앞쪽을 다 쓰면 뒤쪽으로 이어진다 — 빈 격자에는 밑그림이 없어서
      글이 올라오는 순간에만 칸이 나타난다. */
  let cells: Cell[] = [];
  let patterned = 0;
  let lookup = new Map<number, number>();
  let base: HTMLCanvasElement | null = null;

  /*  증분 그리기 기록.
      매 프레임 화면 전체를 다시 까는 건 낭비다 — 4K·DPR2 면 프레임마다
      830만 픽셀을 옮긴다. 색 단계가 바뀐 칸만 밑그림에서 도로 떠다
      붙이고 다시 그린다. 칸 경계가 정수라 떠올 때 옆 칸을 건드리지 않는다. */
  const stepOf = new Map<number, number>();
  let lastLabels: ReadonlyMap<number, string> | null = null;
  let needsFull = true;

  /*  긴 순번도 칸에 들어가게 글자 크기를 줄여 맞춘다.
      같은 글자는 다시 재지 않는다. */
  const fitted = new Map<string, number>();

  const FONT = 'px "SM3SJGothic", "Malgun Gothic", sans-serif';

  function setFont(g: CanvasRenderingContext2D, size: number): void {
    g.font = size.toFixed(2) + FONT;
  }

  /** text 가 maxW 안에 들어가는 글자 크기 */
  function fitSize(
    g: CanvasRenderingContext2D,
    text: string,
    maxW: number,
    want: number,
  ): number {
    const key = text + '|' + want.toFixed(1) + '|' + maxW.toFixed(1);
    const seen = fitted.get(key);
    if (seen !== undefined) return seen;

    setFont(g, want);
    const w = g.measureText(text).width;
    const size = w > maxW ? Math.max(6, (want * maxW) / w) : want;
    fitted.set(key, size);
    return size;
  }

  /* ── 생성 ─────────────────────────────────────────────────────── */
  function build(): void {
    const pattern = buildCells(cols, rows);

    // 밑그림이 없는 나머지 격자 자리. 앞쪽이 다 차면 여기로 이어진다.
    const taken = new Set<number>();
    for (const c of pattern) taken.add(c.y * cols + c.x);

    const rest: Cell[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!taken.has(y * cols + x)) rest.push({ x, y, d: -1 });
      }
    }

    // 뒤쪽도 흩어놓는다. 안 그러면 왼쪽 위부터 줄줄이 차오른다.
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(hash(i, 7, 613) * (i + 1));
      const t = rest[i];
      rest[i] = rest[j];
      rest[j] = t;
    }

    cells = pattern.concat(rest);
    patterned = pattern.length;

    lookup = new Map();
    for (let i = 0; i < cells.length; i++) {
      lookup.set(cells[i].y * cols + cells[i].x, i);
    }
  }

  /* ── 밑그림 ────────────────────────────────────────────────────
     모눈과 안 채워진 칸은 변하지 않는다. 한 번만 그려두고 필요한
     조각만 떠다 쓴다. 전부 디바이스 픽셀 기준으로 그린다. */
  function paintBase(): void {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const b = c.getContext('2d')!;

    const W = c.width;
    const H = c.height;
    const line = Math.max(1, Math.round(dpr));

    // 배경은 칠하지 않는다. 뒤에 깔린 영상이 그대로 비쳐야 한다.

    // 모눈 — 5칸마다 조금 진하게. 획도 정수 픽셀이라 흐려지지 않는다.
    for (let i = 0; i <= cols; i++) {
      b.fillStyle = i % 5 === 0 ? RULE_BOLD : RULE;
      b.fillRect(Math.min(bx[i], W - line), 0, line, H);
    }
    for (let j = 0; j <= rows; j++) {
      b.fillStyle = j % 5 === 0 ? RULE_BOLD : RULE;
      b.fillRect(0, Math.min(by[j], H - line), W, line);
    }

    b.textAlign = 'center';
    b.textBaseline = 'middle';

    const cellDev = cols ? W / cols : 1;
    const want = Math.max(7, cellDev * 0.42);

    // 밑그림이 있는 자리에만 칸을 깔고 '-' 를 적는다
    for (let i = 0; i < patterned; i++) {
      const q = cells[i];
      const x0 = bx[q.x];
      const y0 = by[q.y];
      const w = bx[q.x + 1] - x0;
      const h = by[q.y + 1] - y0;

      b.fillStyle = CELL_BG;
      b.fillRect(x0, y0, w, h);

      // 테두리는 칸 안쪽에 그린다 — 밖으로 나가면 옆 칸을 침범한다
      b.fillStyle = CELL_EDGE;
      b.fillRect(x0, y0, w, line);
      b.fillRect(x0, y0 + h - line, w, line);
      b.fillRect(x0, y0, line, h);
      b.fillRect(x0 + w - line, y0, line, h);

      b.fillStyle = CELL_NUM;
      setFont(b, want);
      b.fillText('-', x0 + w / 2, y0 + h / 2);
    }

    base = c;
    needsFull = true;
  }

  /* ── 합성 ─────────────────────────────────────────────────────── */
  function draw(
    labels: ReadonlyMap<number, string>,
    growSlot: number,
    growT: number,
    time: number,
  ): void {
    if (!base) return;

    // 채워진 자리가 바뀌었거나 판을 새로 깔았으면 통째로 다시 그린다
    const full = needsFull || labels !== lastLabels;

    if (full) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      stepOf.clear();
      lastLabels = labels;
      needsFull = false;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cellDev = cols ? canvas.width / cols : 1;
    const want = Math.max(7, cellDev * 0.42);

    for (const [i, text] of labels) {
      const q = cells[i];
      if (!q) continue;

      // 칸마다 다른 위상으로 회색 스펙트럼을 오간다
      const phase = hash(q.x, q.y, 401) * Math.PI * 2;
      const k = 0.5 + 0.5 * Math.sin(time * TWO_PI_OVER_BREATH + phase);
      const step = (k * (STEPS - 1)) | 0;

      // 스며드는 중인 칸은 투명도가 매 프레임 달라지니 계속 다시 그린다
      const growing = i === growSlot && growT < 1;
      if (!full && !growing && stepOf.get(i) === step) continue;

      const x0 = bx[q.x];
      const y0 = by[q.y];
      const w = bx[q.x + 1] - x0;
      const h = by[q.y + 1] - y0;

      // 밑그림에서 이 칸만 도로 떠다 붙인다. 경계가 정수라 딱 맞는다.
      if (!full) ctx.drawImage(base, x0, y0, w, h, x0, y0, w, h);

      const a = i === growSlot ? growT : 1;
      if (a > 0) {
        ctx.globalAlpha = a;
        ctx.fillStyle = TONE_BG[step];
        ctx.fillRect(x0, y0, w, h);

        ctx.fillStyle = TONE_FG[step];
        // 칸 너비의 86% 안에 들어가게 — 세 자리, 네 자리도 넘치지 않는다
        setFont(ctx, fitSize(ctx, text, w * 0.86, want));
        ctx.fillText(text, x0 + w / 2, y0 + h / 2);
        ctx.globalAlpha = 1;
      }

      // 자라는 중에는 -1 로 남겨 다음 프레임에도 반드시 다시 그리게 한다
      stepOf.set(i, growing ? -1 : step);
    }
  }

  /* ── 크기 ─────────────────────────────────────────────────────── */
  function resize(w: number, h: number): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    const wDev = Math.max(1, Math.round(w * dpr));
    const hDev = Math.max(1, Math.round(h * dpr));

    // 백버퍼 크기만 바꾼다. style 로 px 를 박아버리면 CSS 크기가 고정되어
    // 창을 줄여도 ResizeObserver 가 다시 울리지 않는다.
    canvas.width = wDev;
    canvas.height = hDev;

    cols = Math.max(8, Math.round(w / CELL_TARGET));

    // 칸은 정사각형으로 두고, 세로는 화면을 덮을 만큼 줄을 늘린다
    const cellDev = wDev / cols;
    rows = Math.max(1, Math.ceil(hDev / cellDev));

    bx = new Int32Array(cols + 1);
    for (let i = 0; i <= cols; i++) bx[i] = Math.round(i * cellDev);
    by = new Int32Array(rows + 1);
    for (let j = 0; j <= rows; j++) by[j] = Math.round(j * cellDev);

    fitted.clear();
    build();
    paintBase();
  }

  return {
    get cellSize() {
      return cols ? canvas.width / cols / dpr : CELL_TARGET;
    },
    get capacity() {
      return cells.length;
    },
    get patterned() {
      return patterned;
    },
    hit(px, py) {
      if (!cols) return -1;
      const cellDev = canvas.width / cols;
      const x = Math.floor((px * dpr) / cellDev);
      const y = Math.floor((py * dpr) / cellDev);
      if (x < 0 || x >= cols || y < 0 || y >= rows) return -1;
      const i = lookup.get(y * cols + x);
      return i === undefined ? -1 : i;
    },
    rectOf(i) {
      const q = cells[i];
      if (!q) return { x: 0, y: 0, w: 0, h: 0 };
      return {
        x: bx[q.x] / dpr,
        y: by[q.y] / dpr,
        w: (bx[q.x + 1] - bx[q.x]) / dpr,
        h: (by[q.y + 1] - by[q.y]) / dpr,
      };
    },
    draw,
    resize,
  };
}
