import * as THREE from 'three';
import { PALETTE, TUNING, type Entry } from '../config';
import { buildStructure } from './structure';
import { buildPointCloud } from './pointcloud';

/* =====================================================================
   씬 · 상호작용

   읽기 설계의 핵심:
     노드에 커서를 올리면 (1) 전체 회전이 0.42초에 걸쳐 멈추고
     (2) 카메라가 그 노드를 향해 조준하며 확대되어 화면 중앙에 세운다.
     커서를 떼면 되돌아가고 회전이 다시 붙는다. 클릭하면 그 상태로 고정.

   카메라는 위치를 옮기지 않고 조준 + zoom 으로만 확대한다.
   구조물 안으로 날아 들어가 화면이 엉키는 일이 없고, 되돌아올 때
   원래 구도가 정확히 복원된다.
   ===================================================================== */

const LINE_VERT = /* glsl */ `
  attribute float aKind;   // 0 = 링 본체, 0.35~1 = 가지 굵기 단계
  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = clamp((-mv.z - 16.0) / 12.0, 0.0, 1.0);
    float base = aKind < 0.01 ? 0.40 : 0.58;
    vAlpha = base * (0.28 + 0.72 * (1.0 - d));
    gl_Position = projectionMatrix * mv;
  }
`;

const LINE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uDim;
  varying float vAlpha;

  void main() {
    gl_FragColor = vec4(uColor, vAlpha * uDim);
  }
`;

const TIP_VERT = /* glsl */ `
  attribute float aActive;  // 방명록이 맺혀 있으면 1
  attribute float aAge;     // 0 = 방금, 1 = 오래됨
  attribute float aFocus;   // 지금 보고 있는 노드면 1

  uniform float uPixelRatio;
  uniform float uDim;
  uniform vec3 uFresh;
  uniform vec3 uAged;
  uniform vec3 uHot;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = clamp((-mv.z - 16.0) / 12.0, 0.0, 1.0);
    float front = 1.0 - d;

    vColor = mix(mix(uFresh, uAged, aAge), uHot, aFocus);
    vAlpha = aActive * (0.34 + 0.66 * front) * mix(uDim, 1.0, aFocus);

    gl_Position = projectionMatrix * mv;
    gl_PointSize = (3.4 + aFocus * 5.2) * uPixelRatio * (24.0 / -mv.z);
  }
`;

const TIP_FRAG = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // 사각 포인트 — 원본의 픽셀 자국 느낌을 유지
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

export interface WorldCallbacks {
  /** 포커스가 바뀔 때 (entry, 화면좌표, 고정여부) */
  onFocus(entry: Entry | null, screen: { x: number; y: number } | null, pinned: boolean): void;
}

/** 매 프레임 오버레이(DOM 텍스트 층)에 넘겨주는 상태 */
export interface FrameState {
  /** 조용히 떠 있는 주변 라벨들 */
  ambient: AmbientLabel[];
  /** 지금 읽고 있는 것 */
  focus: {
    entry: Entry;
    x: number;
    y: number;
    /** 확대 진행도 0~1 */
    t: number;
    pinned: boolean;
  } | null;
  /** 방금 쓴 문장이 자기 자리로 날아가는 중 */
  flight: { text: string; x: number; y: number; t: number } | null;
}

export interface World {
  setEntries(entries: Entry[]): void;
  /** 방금 쓴 글이 자기 자리로 날아가는 연출 */
  flyIn(entry: Entry, from: { x: number; y: number }): void;
  focused(): Entry | null;
  unpin(): void;
  /** 주변 라벨에 쓸 후보 — 화면 앞쪽에 있고 서로 안 겹치는 것들 */
  ambient(): AmbientLabel[];
  /** 매 프레임 오버레이 갱신용 */
  onFrame(fn: (s: FrameState) => void): void;
  tipCount(): number;
  dispose(): void;
}

export interface AmbientLabel {
  entry: Entry;
  x: number;
  y: number;
  /** 0~1, 앞쪽일수록 1 */
  front: number;
  side: 'left' | 'right';
}

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

export function createWorld(
  canvas: HTMLCanvasElement,
  cb: WorldCallbacks,
): World {
  // ── 렌더러 ────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(PALETTE.paper, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 200);
  camera.position.set(0, 0, TUNING.cameraDistance);

  const root = new THREE.Group();
  root.rotation.order = 'ZXY';
  scene.add(root);

  // ── 구조 ─────────────────────────────────────────────────────────
  const structure = buildStructure();
  const tipCount = structure.tips.length;

  const lineUniforms = {
    uColor: { value: new THREE.Color(PALETTE.line) },
    uDim: { value: 1 },
  };
  const lines = new THREE.LineSegments(
    structure.lines,
    new THREE.ShaderMaterial({
      uniforms: lineUniforms,
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  lines.frustumCulled = false;
  root.add(lines);

  // ── 중앙 포인트클라우드 ───────────────────────────────────────────
  const cloud = buildPointCloud();
  root.add(cloud.points);

  // ── 가지 끝 노드 ──────────────────────────────────────────────────
  const tipPos = new Float32Array(tipCount * 3);
  structure.tips.forEach((t, i) => {
    tipPos[i * 3] = t.x;
    tipPos[i * 3 + 1] = t.y;
    tipPos[i * 3 + 2] = t.z;
  });

  const aActive = new Float32Array(tipCount);
  const aAge = new Float32Array(tipCount);
  const aFocus = new Float32Array(tipCount);

  const tipGeo = new THREE.BufferGeometry();
  tipGeo.setAttribute('position', new THREE.BufferAttribute(tipPos, 3));
  tipGeo.setAttribute('aActive', new THREE.BufferAttribute(aActive, 1));
  tipGeo.setAttribute('aAge', new THREE.BufferAttribute(aAge, 1));
  tipGeo.setAttribute('aFocus', new THREE.BufferAttribute(aFocus, 1));

  const tipUniforms = {
    uPixelRatio: { value: 1 },
    uDim: { value: 1 },
    uFresh: { value: new THREE.Color(PALETTE.moss) },
    uAged: { value: new THREE.Color(0xa69b86) },
    uHot: { value: new THREE.Color(PALETTE.coral) },
  };

  const tipPoints = new THREE.Points(
    tipGeo,
    new THREE.ShaderMaterial({
      uniforms: tipUniforms,
      vertexShader: TIP_VERT,
      fragmentShader: TIP_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  tipPoints.frustumCulled = false;
  tipPoints.renderOrder = 2;
  root.add(tipPoints);

  // ── 상태 ─────────────────────────────────────────────────────────
  let entries: Entry[] = [];
  /** tip 인덱스 → entry (없으면 null) */
  let slots: (Entry | null)[] = new Array(tipCount).fill(null);

  let spin = 0;
  let spinRate = TUNING.spin;
  let tilt = 0.455;
  let roll = 0;

  let hoverIndex = -1;
  let pinnedIndex = -1;
  /** 지금 보고 있는 tip (호버 또는 고정) */
  let activeIndex = -1;
  /** 포커스 진행도 0~1 */
  let focusT = 0;

  const pointer = { x: -9999, y: -9999, inside: false };
  const worldPos: THREE.Vector3[] = structure.tips.map(() => new THREE.Vector3());
  const screenPos = new Float32Array(tipCount * 2);
  const frontness = new Float32Array(tipCount);

  const aimCurrent = new THREE.Vector3(0, 0, 0);
  const aimTarget = new THREE.Vector3(0, 0, 0);
  const tmp = new THREE.Vector3();
  const viewProj = new THREE.Matrix4();

  let size = { w: 1, h: 1 };
  let lastFocusReported: Entry | null = null;
  let lastPinnedReported = false;

  // 날아가는 문장
  let flight: { entry: Entry; from: { x: number; y: number }; t: number } | null = null;

  // ── 크기 ─────────────────────────────────────────────────────────
  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w === size.w && h === size.h) return;
    size = { w, h };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 세로로 긴 화면에서도 구조가 잘리지 않게 시야각을 살짝 넓힌다
    camera.fov = w / h < 1.35 ? 26 : 20;
    camera.updateProjectionMatrix();
    tipUniforms.uPixelRatio.value = dpr;
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // ── 배정 ─────────────────────────────────────────────────────────
  // entry 의 전체 배열 내 위치로 tip 을 정한다. 목록 끝에만 추가되므로
  // 이미 자리 잡은 글은 새 글이 들어와도 움직이지 않는다.
  function assign(): void {
    slots = new Array(tipCount).fill(null);
    for (let i = 0; i < entries.length; i++) {
      slots[i % tipCount] = entries[i];
    }

    const now = Date.now();
    for (let i = 0; i < tipCount; i++) {
      const e = slots[i];
      aActive[i] = e ? 1 : 0;
      // 6일에 걸쳐 이끼색 → 마른 색
      aAge[i] = e ? Math.max(0, Math.min(1, (now - e.createdAt) / (6 * 864e5))) : 0;
    }
    tipGeo.attributes.aActive.needsUpdate = true;
    tipGeo.attributes.aAge.needsUpdate = true;
  }

  function tipIndexOf(entry: Entry): number {
    const i = entries.indexOf(entry);
    return i < 0 ? -1 : i % tipCount;
  }

  // ── 포인터 ───────────────────────────────────────────────────────
  function onPointerMove(ev: PointerEvent): void {
    const r = canvas.getBoundingClientRect();
    pointer.x = ev.clientX - r.left;
    pointer.y = ev.clientY - r.top;
    pointer.inside = true;
  }

  function onPointerLeave(): void {
    pointer.inside = false;
    pointer.x = -9999;
    pointer.y = -9999;
  }

  function onClick(): void {
    if (hoverIndex >= 0) {
      pinnedIndex = pinnedIndex === hoverIndex ? -1 : hoverIndex;
    } else {
      pinnedIndex = -1;
    }
  }

  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
  canvas.addEventListener('click', onClick);

  // ── 히트 테스트 ──────────────────────────────────────────────────
  // 레이캐스터 대신 화면 좌표 최근접 탐색. 노드가 작아도 관람객이
  // 쉽게 집을 수 있도록 넉넉한 반경을 준다.
  function pick(): number {
    if (!pointer.inside) return -1;

    let best = -1;
    let bestScore = Infinity;
    const r2 = TUNING.hitRadius * TUNING.hitRadius;

    for (let i = 0; i < tipCount; i++) {
      if (!slots[i]) continue;
      const sx = screenPos[i * 2];
      const sy = screenPos[i * 2 + 1];
      if (sx < -100) continue;

      const dx = sx - pointer.x;
      const dy = sy - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;

      // 거리가 비슷하면 앞쪽에 있는 노드를 우선한다
      const score = d2 * (1.6 - frontness[i]);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  // ── 주변 라벨 후보 ───────────────────────────────────────────────
  const ambientCache: AmbientLabel[] = [];
  const EMPTY_AMBIENT: AmbientLabel[] = [];
  const frameListeners: ((s: FrameState) => void)[] = [];
  let ambientAt = 0;

  function recomputeAmbient(): void {
    ambientCache.length = 0;
    if (focusT > 0.15) return;

    const cands: { i: number; front: number }[] = [];
    for (let i = 0; i < tipCount; i++) {
      if (!slots[i]) continue;
      const sx = screenPos[i * 2];
      const sy = screenPos[i * 2 + 1];
      if (sx < 60 || sx > size.w - 60) continue;
      if (sy < 70 || sy > size.h - 300) continue;
      if (frontness[i] < 0.52) continue;
      cands.push({ i, front: frontness[i] });
    }

    cands.sort((a, b) => b.front - a.front);

    const placed: { x: number; y: number }[] = [];
    for (const c of cands) {
      if (ambientCache.length >= TUNING.ambientLabels) break;
      const sx = screenPos[c.i * 2];
      const sy = screenPos[c.i * 2 + 1];
      // 서로 겹치지 않게
      if (placed.some((p) => Math.abs(p.y - sy) < 22 && Math.abs(p.x - sx) < 300)) continue;
      placed.push({ x: sx, y: sy });

      const entry = slots[c.i]!;
      let side: 'left' | 'right' = sx >= size.w / 2 ? 'right' : 'left';
      if (side === 'right' && sx > size.w - 300) side = 'left';
      if (side === 'left' && sx < 300) side = 'right';

      ambientCache.push({ entry, x: sx, y: sy, front: c.front, side });
    }
  }

  // ── 루프 ─────────────────────────────────────────────────────────
  let raf = 0;
  let last = performance.now();
  let elapsed = 0;

  function loop(now: number): void {
    raf = requestAnimationFrame(loop);

    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;

    // 포커스 대상 결정 — 고정이 우선
    const wanted = pinnedIndex >= 0 ? pinnedIndex : hoverIndex;
    if (wanted !== activeIndex) {
      if (activeIndex >= 0) aFocus[activeIndex] = 0;
      activeIndex = wanted;
      if (activeIndex >= 0) aFocus[activeIndex] = 1;
      tipGeo.attributes.aFocus.needsUpdate = true;
    }

    // 회전: 포커스 중이면 멈추고, 풀리면 천천히 되살아난다
    const targetRate = activeIndex >= 0 ? 0 : TUNING.spin;
    const rateTime = activeIndex >= 0 ? TUNING.spinStopTime : TUNING.spinResumeTime;
    spinRate += (targetRate - spinRate) * Math.min(1, dt / rateTime);

    spin += dt * spinRate;
    tilt = 0.455 + Math.sin(elapsed / 17) * 0.085;
    roll = Math.sin(elapsed / 23) * 0.055;
    root.rotation.set(tilt, spin, roll);
    root.updateMatrixWorld(true);

    // 포커스 진행도
    const focusTarget = activeIndex >= 0 ? 1 : 0;
    const focusSpeed = focusTarget > focusT ? TUNING.focusIn : TUNING.focusOut;
    focusT += (focusTarget - focusT) * Math.min(1, dt * focusSpeed);
    if (focusT < 0.001) focusT = 0;

    // 카메라: 위치는 고정, 조준점과 zoom 만 움직인다
    if (activeIndex >= 0) {
      aimTarget.copy(structure.tips[activeIndex]).applyMatrix4(root.matrixWorld);
    } else {
      aimTarget.set(0, 0, 0);
    }
    aimCurrent.lerp(aimTarget, Math.min(1, dt * focusSpeed));

    const e = EASE_OUT(focusT);
    camera.zoom = 1 + e * 1.35;
    camera.updateProjectionMatrix();
    camera.lookAt(aimCurrent);
    camera.updateMatrixWorld(true);

    // 포커스 중에는 나머지를 물러나게 한다
    const dim = 1 - 0.6 * e;
    lineUniforms.uDim.value = dim;
    tipUniforms.uDim.value = dim;

    cloud.update(elapsed);

    // 화면 좌표 갱신 (행렬은 재사용 — 매 프레임 새로 만들지 않는다)
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (let i = 0; i < tipCount; i++) {
      if (!slots[i]) {
        screenPos[i * 2] = -9999;
        continue;
      }
      const wp = worldPos[i];
      wp.copy(structure.tips[i]).applyMatrix4(root.matrixWorld);

      tmp.copy(wp).applyMatrix4(camera.matrixWorldInverse);
      // 뷰 공간 z: -16 ~ -28 정도가 구조의 앞뒤 폭
      frontness[i] = Math.max(0, Math.min(1, 1 - (-tmp.z - 16) / 12));

      tmp.copy(wp).applyMatrix4(viewProj);
      if (tmp.z > 1) {
        screenPos[i * 2] = -9999;
        continue;
      }
      screenPos[i * 2] = (tmp.x * 0.5 + 0.5) * size.w;
      screenPos[i * 2 + 1] = (-tmp.y * 0.5 + 0.5) * size.h;
    }

    // 히트 테스트 (고정 중이 아닐 때만 대상 교체)
    const hit = pick();
    if (hit !== hoverIndex) hoverIndex = hit;

    // 주변 라벨 후보는 4Hz 로만 다시 고른다 (매 프레임 고르면 깜빡인다)
    if (now - ambientAt > 250) {
      ambientAt = now;
      recomputeAmbient();
    }

    // 포커스 콜백
    const focusEntry = activeIndex >= 0 ? slots[activeIndex] : null;
    const isPinned = pinnedIndex >= 0;
    if (focusEntry !== lastFocusReported || isPinned !== lastPinnedReported) {
      lastFocusReported = focusEntry;
      lastPinnedReported = isPinned;
      cb.onFocus(
        focusEntry,
        focusEntry && activeIndex >= 0
          ? { x: screenPos[activeIndex * 2], y: screenPos[activeIndex * 2 + 1] }
          : null,
        isPinned,
      );
    }

    // 날아가는 문장 — 입력창에서 자기 자리까지
    let flightState: FrameState['flight'] = null;
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / 1.7);
      const idx = tipIndexOf(flight.entry);
      if (idx >= 0 && screenPos[idx * 2] > -100) {
        const k = EASE_OUT(flight.t);
        flightState = {
          text: flight.entry.body,
          x: flight.from.x + (screenPos[idx * 2] - flight.from.x) * k,
          y: flight.from.y + (screenPos[idx * 2 + 1] - flight.from.y) * k,
          t: flight.t,
        };
      }
      if (flight.t >= 1) flight = null;
    }

    // 오버레이에 이번 프레임 상태를 넘긴다
    if (frameListeners.length) {
      const fs: FrameState = {
        ambient: focusT > 0.15 ? EMPTY_AMBIENT : ambientCache,
        focus:
          focusEntry && activeIndex >= 0
            ? {
                entry: focusEntry,
                x: screenPos[activeIndex * 2],
                y: screenPos[activeIndex * 2 + 1],
                t: e,
                pinned: isPinned,
              }
            : null,
        flight: flightState,
      };
      for (const fn of frameListeners) fn(fs);
    }

    renderer.render(scene, camera);
  }

  raf = requestAnimationFrame(loop);

  // ── 외부 API ─────────────────────────────────────────────────────
  return {
    setEntries(next: Entry[]) {
      entries = next;
      assign();
      // 고정해둔 글이 사라졌으면 (숨김 처리 등) 포커스를 푼다
      if (pinnedIndex >= 0 && !slots[pinnedIndex]) pinnedIndex = -1;
    },

    flyIn(entry: Entry, from: { x: number; y: number }) {
      const idx = tipIndexOf(entry);
      if (idx < 0) return;
      flight = { entry, from, t: 0 };
    },

    focused() {
      return activeIndex >= 0 ? slots[activeIndex] : null;
    },

    unpin() {
      pinnedIndex = -1;
    },

    ambient() {
      return ambientCache;
    },

    onFrame(fn) {
      frameListeners.push(fn);
    },

    tipCount() {
      return tipCount;
    },

    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      cloud.dispose();
      structure.lines.dispose();
      tipGeo.dispose();
      renderer.dispose();
    },
  };
}
