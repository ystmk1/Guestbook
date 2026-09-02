/* =====================================================================
   기록 사진 — 타원 궤도

   사진들이 눕힌 타원을 따라 한 방향으로 천천히 돈다. 앞으로 나온 것은
   크고 진하게, 뒤로 물러난 것은 작고 옅게 그려 깊이를 만든다.

   커서를 올리면 그 사진이 궤도에서 빠져나와 가운데로 오면서 크게 열리고,
   나머지는 물러난다. 도는 것도 같이 멈춘다 — 움직이는 걸 들여다보게
   하면 안 되니까.

   전환은 CSS transition 이 아니라 프레임마다 값을 당겨서 만든다.
   궤도 때문에 어차피 매 프레임 transform 을 새로 쓰는데, 거기에
   transition 을 얹으면 둘이 서로를 덮어써서 끊긴다.
   ===================================================================== */

/** 한 바퀴 도는 데 걸리는 시간 (초) */
const PERIOD = 54;

/** 타원의 반지름 — 컨테이너 크기에 대한 비율 */
const RX = 0.24;
const RY = 0.29;

/*  궤도를 도는 동안은 넷 다 같은 크기다.
    크기로 깊이를 주면 사진마다 커졌다 작아졌다 해서 산만하다.
    앞뒤는 겹치는 순서로만 구분하고, 크기는 커서를 올렸을 때만 바뀐다. */
const ORBIT = 1;

/** 커서를 올렸을 때 배율 */
const OPEN = 2.55;

/** 값이 목표로 당겨지는 정도 — 1에 가까울수록 빠르다 */
const EASE = 0.12;

interface Shot {
  el: HTMLImageElement;
  /** 궤도 위 제 위치 (라디안) */
  phase: number;
  /** 열린 정도 0~1 */
  open: number;
  /** 마지막으로 써넣은 쌓임 순서 — 바뀔 때만 손댄다 */
  z: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function startOrbit(host: HTMLElement): void {
  const imgs = Array.from(host.querySelectorAll('img'));
  if (!imgs.length) return;

  const shots: Shot[] = imgs.map((el, i) => ({
    el,
    phase: (i / imgs.length) * Math.PI * 2,
    open: 0,
    z: -1,
  }));

  let angle = 0;
  /** 도는 속도 (0~1). 커서를 올리면 0으로 잦아든다 */
  let spin = 1;
  let hovered: Shot | null = null;

  /*  pointerenter / pointerleave 를 쓰지 않는다.
      사진이 열리면서 커서 밑에서 비켜나면 leave 가 떠 닫히고, 닫히면서
      다시 커서 밑으로 돌아와 enter 가 떠 열린다 — 깜빡임이 된다.

      대신 커서 자리로 직접 고른다. 이미 열린 사진이 아직 커서를 품고
      있으면 그대로 둔다. 그게 곧 걸쇠 역할을 한다. */
  const inside = (el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  window.addEventListener(
    'pointermove',
    (ev) => {
      if (hovered && inside(hovered.el, ev.clientX, ev.clientY)) return;

      let found: Shot | null = null;
      let bestZ = -1;
      for (const s of shots) {
        if (!inside(s.el, ev.clientX, ev.clientY)) continue;
        const z = Number(s.el.style.zIndex) || 0;
        if (z > bestZ) {
          bestZ = z;
          found = s;
        }
      }
      hovered = found;
    },
    { passive: true },
  );

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /*  30fps 로 묶는다. 54초에 한 바퀴 도는 느린 움직임이라 60fps 가
      필요 없고, 저사양 화면에서 그만큼 덜 먹는다. */
  const FRAME_MS = 1000 / 30;
  let last = performance.now();
  let lastPaint = 0;

  function frame(now: number): void {
    requestAnimationFrame(frame);
    if (now - lastPaint < FRAME_MS) return;
    lastPaint = now;

    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    // 커서를 올리면 회전이 잦아든다
    spin = lerp(spin, hovered ? 0 : 1, 0.08);
    if (!reduced) angle += dt * ((Math.PI * 2) / PERIOD) * spin;

    const rx = w * RX;
    const ry = h * RY;

    /*  열린 사진이 화면 밖으로 잘리지 않게 목표 자리를 잡아둔다.
        이 무대는 왼쪽 끝에 붙어 있어서, 가운데에 그대로 키우면 왼쪽이
        잘린다. 화면 좌표로 재서 안으로 밀어 넣는다.

        무대의 화면 크기 ÷ 레이아웃 크기 = 바깥에서 걸린 배율.
        (왼쪽 열 전체가 scale 로 조절되고 있다) */
    let openX = 0;
    let openY = 0;

    if (hovered) {
      const rect = host.getBoundingClientRect();
      const k = rect.width / w || 1;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const ow = hovered.el.offsetWidth * OPEN * k;
      const oh = hovered.el.offsetHeight * OPEN * k;
      const m = 24;

      const fitX = ow < window.innerWidth - m * 2;
      const fitY = oh < window.innerHeight - m * 2;

      const wantX = fitX
        ? Math.min(Math.max(cx, m + ow / 2), window.innerWidth - m - ow / 2)
        : window.innerWidth / 2;
      const wantY = fitY
        ? Math.min(Math.max(cy, m + oh / 2), window.innerHeight - m - oh / 2)
        : window.innerHeight / 2;

      openX = (wantX - cx) / k;
      openY = (wantY - cy) / k;
    }

    // 가장 많이 열린 정도. 나머지가 물러나는 양을 여기에 맞춰야
    // 뚝 끊기지 않고 같이 잦아든다.
    let focus = 0;
    for (const s of shots) focus = Math.max(focus, s.open);

    for (const s of shots) {
      s.open = lerp(s.open, s === hovered ? 1 : 0, EASE);

      const a = angle + s.phase;

      // 아래쪽(sin > 0)을 앞으로 친다 — 겹치는 순서를 정하는 데만 쓴다
      const depth = (Math.sin(a) + 1) / 2;

      const orbitX = Math.cos(a) * rx;
      const orbitY = Math.sin(a) * ry;

      // 열릴수록 가운데로 오면서 커진다
      const t = s.open;
      const x = lerp(orbitX, openX, t);
      const y = lerp(orbitY, openY, t);
      const scale = lerp(ORBIT, OPEN, t);

      // 하나가 열리면 나머지는 물러난다. 그때 말고는 넷 다 똑같이 보인다.
      const alpha = lerp(1 - focus * 0.72, 1, t);

      s.el.style.transform =
        `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ` +
        `scale(${scale.toFixed(3)})`;
      s.el.style.opacity = alpha.toFixed(3);

      // transform·opacity 와 달리 zIndex 는 쌓임 순서를 다시 계산하게
      // 만든다. 실제로 바뀔 때만 써넣는다.
      const z = Math.round(depth * 100) + Math.round(t * 500);
      if (z !== s.z) {
        s.z = z;
        s.el.style.zIndex = String(z);
      }
    }
  }

  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') last = performance.now();
  });
}
