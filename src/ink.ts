/* =====================================================================
   잉크 블롭

   텍스트 박스의 사각 윤곽을 따라 점을 고르게 뿌리고, 각 점을 바깥
   법선 방향으로 밀어 유기적인 덩어리를 만든다. 밀어내는 양은 그 박스의
   패딩보다 작게 잡는다 — 그래서 아무리 울렁여도 글자를 덮지 않는다.
   패딩이 곧 잉크가 번질 수 있는 여백이다.

   변위는 둘레 위치 s(0~1)의 정수 배음 합이라 한 바퀴가 정확히 닫힌다.
   이음매가 보이지 않고, 노이즈 라이브러리도 필요 없다.
   ===================================================================== */

interface Pt {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** 둥근 사각형 둘레를 등간격으로 샘플링해 위치 + 바깥 법선을 낸다 */
function outline(w: number, h: number, r: number, n: number): Pt[] {
  r = Math.min(r, w / 2, h / 2);
  const sx = w - 2 * r;
  const sy = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const total = 2 * sx + 2 * sy + 4 * arc;

  const pts: Pt[] = [];

  for (let i = 0; i < n; i++) {
    let d = (i / n) * total;

    // 위 → 오른쪽 → 아래 → 왼쪽 순서로 둘레를 걷는다
    if (d < sx) {
      pts.push({ x: r + d, y: 0, nx: 0, ny: -1 });
      continue;
    }
    d -= sx;

    if (d < arc) {
      const a = -Math.PI / 2 + d / r;
      pts.push({ x: w - r + Math.cos(a) * r, y: r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
      continue;
    }
    d -= arc;

    if (d < sy) {
      pts.push({ x: w, y: r + d, nx: 1, ny: 0 });
      continue;
    }
    d -= sy;

    if (d < arc) {
      const a = d / r;
      pts.push({ x: w - r + Math.cos(a) * r, y: h - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
      continue;
    }
    d -= arc;

    if (d < sx) {
      pts.push({ x: w - r - d, y: h, nx: 0, ny: 1 });
      continue;
    }
    d -= sx;

    if (d < arc) {
      const a = Math.PI / 2 + d / r;
      pts.push({ x: r + Math.cos(a) * r, y: h - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
      continue;
    }
    d -= arc;

    if (d < sy) {
      pts.push({ x: 0, y: h - r - d, nx: -1, ny: 0 });
      continue;
    }
    d -= sy;

    const a = Math.PI + d / r;
    pts.push({ x: r + Math.cos(a) * r, y: r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
  }

  return pts;
}

/** 배음 — [주파수(정수), 진폭, 속도, 위상] */
const HARMONICS: [number, number, number, number][] = [
  [2, 0.52, 0.19, 0.0],
  [3, 0.30, -0.14, 1.7],
  [5, 0.17, 0.23, 3.1],
  [7, 0.10, -0.29, 0.6],
  [11, 0.055, 0.34, 4.4],
  [17, 0.028, -0.41, 2.2],
];

function displace(s: number, t: number, phase: number): number {
  const th = s * Math.PI * 2;
  let v = 0;
  for (const [k, a, sp, ph] of HARMONICS) {
    v += a * Math.sin(k * th + t * sp + ph + phase);
  }
  return v;
}

/** 열린 곡선이 아니라 닫힌 고리를 Catmull-Rom 으로 매끄럽게 잇는다 */
function ribbon(ctx: CanvasRenderingContext2D, p: { x: number; y: number }[]): void {
  const n = p.length;
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n];
    const p1 = p[i];
    const p2 = p[(i + 1) % n];
    const p3 = p[(i + 2) % n];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  ctx.closePath();
}

/** 본체 옆에 튄 잉크 방울 — [x비율, y비율, 반지름비율, 위상] */
const SPATTER: [number, number, number, number][] = [
  [0.085, -0.02, 0.052, 1.1],
  [0.30, -0.055, 0.030, 2.7],
  [0.63, -0.035, 0.041, 0.4],
  [0.90, -0.015, 0.026, 3.9],
  [0.20, 1.045, 0.034, 5.2],
  [0.52, 1.06, 0.045, 1.8],
  [0.81, 1.035, 0.028, 4.6],
  [-0.012, 0.42, 0.030, 2.1],
  [1.012, 0.62, 0.036, 0.9],
];

export interface Ink {
  destroy(): void;
}

export function createInk(canvas: HTMLCanvasElement, target: HTMLElement): Ink {
  const ctx = canvas.getContext('2d', { alpha: true })!;

  let w = 0;
  let h = 0;
  let pad = 28;
  let dpr = 1;
  let raf = 0;

  const N = 168;
  let base: Pt[] = [];
  const warped: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) warped.push({ x: 0, y: 0 });

  function measure(): void {
    const rect = canvas.getBoundingClientRect();
    const nw = Math.round(rect.width);
    const nh = Math.round(rect.height);
    const cs = getComputedStyle(target);
    const np = parseFloat(cs.paddingLeft) || 28;

    if (nw === w && nh === h && np === pad) return;
    w = nw;
    h = nh;
    pad = np;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 잉크가 밀려나갈 여유를 남기고 안쪽에서 시작한다
    const inset = pad * 0.42;
    base = outline(
      Math.max(1, w - inset * 2),
      Math.max(1, h - inset * 2),
      Math.min(w, h) * 0.16,
      N,
    );
    for (const p of base) {
      p.x += inset;
      p.y += inset;
    }
  }

  const ro = new ResizeObserver(measure);
  ro.observe(canvas);
  ro.observe(target);
  measure();

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!w || !h) return;

    const t = reduced ? 0 : now / 1000;

    // 변위 최대치는 패딩보다 작게 — 글자를 침범하지 않는 상한
    const amp = pad * 0.34;

    for (let i = 0; i < N; i++) {
      const b = base[i];
      const d = displace(i / N, t, 0) * amp;
      warped[i].x = b.x + b.nx * d;
      warped[i].y = b.y + b.ny * d;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#15110d';

    ctx.beginPath();
    ribbon(ctx, warped);
    ctx.fill();

    // 튄 방울
    const unit = Math.min(w, h);
    for (const [fx, fy, fr, ph] of SPATTER) {
      const cx = fx * w;
      const cy = fy * h;
      const r0 = fr * unit;
      ctx.beginPath();
      for (let i = 0; i <= 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const rr = r0 * (1 + displace(i / 22, t * 1.6, ph) * 0.19);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
