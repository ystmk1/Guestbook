import * as THREE from 'three';
import { makeGaussian, mulberry32 } from './rng';
import { PALETTE } from '../config';

/**
 * 중앙 오브젝트 — 수조 3D 스캔의 절차적 목업.
 * 원본의 캔버스 fillRect 방식을 GPU Points + 셰이더로 옮기고,
 * 스캐너가 훑고 지나가는 듯한 세로 스캔라인을 얹었다.
 *
 * 나중에 실제 스캔(.ply)으로 바꾸려면 이 모듈이 반환하는 Points 를
 * PLYLoader 결과로 교체하면 된다 — 나머지 씬은 손댈 필요 없음.
 */

const SCALE = 0.01;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScanY;

  varying float vAlpha;
  varying float vScan;

  void main() {
    vec3 p = position;

    // 아주 느린 부유 — 스캔 데이터가 미세하게 떨리는 느낌
    p.x += sin(uTime * 0.28 + aSeed * 6.283) * 0.004;
    p.y += cos(uTime * 0.23 + aSeed * 4.712) * 0.003;
    p.z += sin(uTime * 0.31 + aSeed * 2.094) * 0.004;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float viewDepth = clamp((-mv.z - 17.0) / 9.0, 0.0, 1.0);

    // 가까울수록 진하게 (원본의 0.16 + 0.5 * (1 - depth) 를 계승)
    vAlpha = (0.18 + 0.52 * (1.0 - viewDepth)) * aSize;

    // 위아래로 훑고 지나가는 스캔 밴드
    vScan = smoothstep(0.09, 0.0, abs(p.y - uScanY));

    gl_Position = projectionMatrix * mv;
    gl_PointSize = (aSize * 2.2 + vScan * 1.6) * uPixelRatio * (24.0 / -mv.z);
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;

  uniform vec3 uColor;
  uniform vec3 uScanColor;

  varying float vAlpha;
  varying float vScan;

  void main() {
    // 사각 포인트 — 원본 fillRect 의 픽셀 느낌을 유지
    vec3 c = mix(uColor, uScanColor, vScan * 0.75);
    gl_FragColor = vec4(c, clamp(vAlpha + vScan * 0.35, 0.0, 1.0));
  }
`;

export interface PointCloud {
  points: THREE.Points;
  update(t: number): void;
  dispose(): void;
}

export function buildPointCloud(seed = 20250901): PointCloud {
  const rand = mulberry32(seed);
  const gauss = makeGaussian(rand);

  const pos: number[] = [];
  const size: number[] = [];

  const push = (x: number, y: number, z: number, s: number) => {
    pos.push(x * SCALE, y * SCALE, z * SCALE);
    size.push(s);
  };

  const h = 96;
  const rb = 70; // 밑동 반지름
  const rt = 53; // 윗면 반지름

  // 옆면 — 세로 결
  for (let i = 0; i < 2600; i++) {
    const t = Math.pow(rand(), 0.85);
    const a = rand() * Math.PI * 2;
    const flute = 1 + Math.sin(a * 7.2) * 0.055 + Math.sin(a * 3.1) * 0.035;
    const rr = (rb + (rt - rb) * t) * flute + gauss() * 2.2;
    push(Math.cos(a) * rr, h * 0.5 - h * t + gauss() * 1.6, Math.sin(a) * rr, 0.45 + rand() * 0.45);
  }

  // 윗면 나이테
  for (let ring = 0; ring < 15; ring++) {
    const rr0 = rt * (0.1 + (ring / 15) * 0.92);
    const n = Math.round(52 + rr0 * 3.0);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const rr = rr0 + gauss() * 1.1;
      if (rr > rt) continue;
      push(Math.cos(a) * rr, -h * 0.5 + gauss() * 0.8, Math.sin(a) * rr, 0.55 + rand() * 0.4);
    }
  }

  // 윗면 테두리 강조
  for (let i = 0; i < 640; i++) {
    const a = rand() * Math.PI * 2;
    const rr = rt + gauss() * 1.4;
    push(Math.cos(a) * rr, -h * 0.5 + gauss() * 1.2, Math.sin(a) * rr, 0.85 + rand() * 0.3);
  }

  // 밑동 잔해
  for (let i = 0; i < 480; i++) {
    const a = rand() * Math.PI * 2;
    const rr = rb + rand() * 38;
    push(Math.cos(a) * rr, h * 0.5 + gauss() * 3.5, Math.sin(a) * rr, 0.28 + rand() * 0.28);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));

  const seeds = new Float32Array(size.length);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    uScanY: { value: 0 },
    uColor: { value: new THREE.Color(PALETTE.cloud) },
    uScanColor: { value: new THREE.Color(PALETTE.moss) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 1;

  const yTop = (-h * 0.5) * SCALE;
  const yBot = (h * 0.5 + 12) * SCALE;

  return {
    points,
    update(t: number) {
      uniforms.uTime.value = t;
      // 9초 주기로 위에서 아래로 훑는다
      const k = (t % 9) / 9;
      uniforms.uScanY.value = yTop + (yBot - yTop) * k;
      uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
