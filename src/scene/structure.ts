import * as THREE from 'three';
import { makeGaussian, mulberry32 } from './rng';

/**
 * 3중 링 + 프랙탈 가지.
 * 원본 아티팩트의 생성 규칙을 그대로 3D 좌표계로 옮긴 것.
 * 픽셀 단위였던 원본을 SCALE 로 나눠 월드 유닛으로 쓴다.
 */

const SCALE = 0.01;

interface RingSpec {
  r: number;
  y: number;
  seg: number;
  sprout: number;
  ph: number;
  depth: number;
  len: number;
}

const RINGS: RingSpec[] = [
  { r: 224, y: -36, seg: 160, sprout: 10, ph: 0.0, depth: 3, len: 42 },
  { r: 322, y: 2, seg: 180, sprout: 13, ph: 1.1, depth: 3, len: 46 },
  { r: 414, y: 42, seg: 200, sprout: 14, ph: 2.3, depth: 2, len: 48 },
];

export interface Structure {
  /** 링 + 가지 전체를 담은 LineSegments 지오메트리 */
  lines: THREE.BufferGeometry;
  /** 가지 끝 — 방명록 한 줄이 맺히는 자리 */
  tips: THREE.Vector3[];
  /** tips[i] 가 속한 링 번호 */
  tipRing: number[];
  /** 구조 전체의 바깥 반지름 (카메라 프레이밍용) */
  radius: number;
}

interface RawSeg {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** 9 = 링 본체, 0~3 = 가지 depth */
  kind: number;
}

export function buildStructure(seed = 77002): Structure {
  const rand = mulberry32(seed);
  const gauss = makeGaussian(rand);

  const segs: RawSeg[] = [];
  const tips: THREE.Vector3[] = [];
  const tipRing: number[] = [];

  const norm = (x: number, y: number, z: number) => {
    const m = Math.hypot(x, y, z) || 1;
    return new THREE.Vector3(x / m, y / m, z / m);
  };

  /** 재귀 성장 — depth 가 0 이 되면 그 끝이 tip 이 된다 */
  function grow(
    p0: THREE.Vector3,
    dir: THREE.Vector3,
    len: number,
    depth: number,
    ringIdx: number,
  ): void {
    const p1 = new THREE.Vector3(
      p0.x + dir.x * len,
      p0.y + dir.y * len,
      p0.z + dir.z * len,
    );
    segs.push({ a: p0, b: p1, kind: depth });

    if (depth <= 0) {
      tips.push(p1);
      tipRing.push(ringIdx);
      return;
    }

    const n = 2 + (rand() < 0.34 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const d2 = norm(
        dir.x + gauss() * 0.52,
        dir.y + gauss() * 0.36,
        dir.z + gauss() * 0.52,
      );
      grow(p1, d2, len * (0.58 + rand() * 0.13), depth - 1, ringIdx);
    }
  }

  RINGS.forEach((rg, ri) => {
    // 링 자체 — 완전한 원이 아니라 미세하게 흔들리는 폴리라인
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= rg.seg; i++) {
      const a = (i / rg.seg) * Math.PI * 2 + rg.ph;
      const wob = 1 + Math.sin(a * 3.1 + rg.ph) * 0.018 + Math.sin(a * 7.3) * 0.009;
      pts.push(
        new THREE.Vector3(
          Math.cos(a) * rg.r * wob,
          rg.y + Math.sin(a * 2.2 + rg.ph) * 9,
          Math.sin(a) * rg.r * wob,
        ),
      );
    }
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push({ a: pts[i], b: pts[i + 1], kind: 9 });
    }

    // 링 위에서 가지 발아
    for (let s = 0; s < rg.sprout; s++) {
      const idx = Math.floor(((s + 0.5 + (rand() - 0.5) * 0.5) / rg.sprout) * rg.seg);
      const p = pts[Math.max(0, Math.min(pts.length - 1, idx))];
      const out = norm(p.x, 0, p.z);
      const tan = norm(-out.z, 0, out.x);
      const sgn = rand() < 0.5 ? 1 : -1;
      const ow = rand() < 0.3 ? -0.42 : 0.46;
      const up = rand() < 0.5 ? 1 : -1;
      const dir = norm(
        tan.x * sgn * 0.85 + out.x * ow + gauss() * 0.22,
        up * (0.3 + rand() * 0.42),
        tan.z * sgn * 0.85 + out.z * ow + gauss() * 0.22,
      );
      grow(p, dir, rg.len, rg.depth, ri);
    }
  });

  // ── tip 순서 섞기 ────────────────────────────────────────────────
  // 시간순으로 채워지므로, 순서를 안 섞으면 최근 글이 한 링에만 몰린다.
  // 링별로 나눠 담고 라운드로빈으로 다시 뽑아 세 링에 고르게 퍼지게 한다.
  {
    const buckets: number[][] = [[], [], []];
    for (let i = 0; i < tips.length; i++) buckets[tipRing[i]].push(i);
    for (const b of buckets) {
      // Fisher–Yates (원본의 sort(()=>R()-0.5) 는 편향이 있어 제대로 섞는다)
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
    }
    const order: number[] = [];
    let k = 0;
    while (order.length < tips.length) {
      const b = buckets[k % 3];
      if (b.length) order.push(b.shift()!);
      k++;
    }
    const t2 = order.map((i) => tips[i]);
    const r2 = order.map((i) => tipRing[i]);
    tips.length = 0;
    tipRing.length = 0;
    tips.push(...t2);
    tipRing.push(...r2);
  }

  // ── LineSegments 지오메트리 ─────────────────────────────────────
  // 주의: grow() 에서 부모 세그먼트의 끝점과 자식 세그먼트의 시작점은
  // "같은 Vector3 객체"다. 반복문으로 multiplyScalar 하면 공유된 점이
  // 여러 번 스케일되어 구조가 원점으로 무너진다. 그래서 원본 벡터는
  // 건드리지 않고, 버퍼에 쓸 때만 SCALE 을 곱한다.
  const count = segs.length * 2;
  const position = new Float32Array(count * 3);
  const aKind = new Float32Array(count);

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const o = i * 6;
    position[o + 0] = s.a.x * SCALE;
    position[o + 1] = s.a.y * SCALE;
    position[o + 2] = s.a.z * SCALE;
    position[o + 3] = s.b.x * SCALE;
    position[o + 4] = s.b.y * SCALE;
    position[o + 5] = s.b.z * SCALE;
    // 링 본체는 0, 가지는 굵기 단계 (1 = 굵은 줄기 … 0.4 = 잔가지)
    const k = s.kind === 9 ? 0 : Math.max(0.35, s.kind / 3);
    aKind[i * 2] = k;
    aKind[i * 2 + 1] = k;
  }

  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.BufferAttribute(position, 3));
  lines.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));
  lines.computeBoundingSphere();

  // tip 도 원본을 건드리지 않고 스케일된 복사본으로 넘긴다
  const scaledTips = tips.map((t) => t.clone().multiplyScalar(SCALE));

  let radius = 0;
  for (const t of scaledTips) radius = Math.max(radius, t.length());

  return { lines, tips: scaledTips, tipRing, radius };
}
