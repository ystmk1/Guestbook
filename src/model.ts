import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/* =====================================================================
   중앙 오브젝트

   최소 구성만 쓴다 — 그림자 없음, 후처리 없음, 환경맵 없음.
   조명 3개와 메시 하나. 배경은 투명이라 종이색이 그대로 비친다.
   화면 밖이거나 탭이 가려지면 렌더를 멈춘다.
   ===================================================================== */

export interface ModelView {
  destroy(): void;
}

export function createModel(
  canvas: HTMLCanvasElement,
  url: string,
  onState: (s: string) => void,
): ModelView {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.05, 100);

  // 종이 위에 놓인 물체처럼 — 위에서 내려오는 주광 + 종이 반사광
  const key = new DirectionalLight(0xfff6e4, 2.15);
  key.position.set(2.4, 3.6, 2.8);
  scene.add(key);

  const fill = new DirectionalLight(0xd9d2c4, 0.75);
  fill.position.set(-3, 0.6, -1.8);
  scene.add(fill);

  scene.add(new HemisphereLight(0xffffff, 0xa2977f, 1.5));

  const holder = new Group();
  scene.add(holder);

  let size = { w: 0, h: 0 };
  let radius = 1;

  function resize(): void {
    const w = Math.round(canvas.clientWidth);
    const h = Math.round(canvas.clientHeight);
    if (!w || !h || (w === size.w && h === size.h)) return;
    size = { w, h };

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    // 세로로 눌린 판면에서도 물체가 잘리지 않게 거리를 잡는다
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = radius / Math.sin(Math.min(vFov, hFov) / 2);
    camera.position.set(0, 0, dist * 1.04);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // ── 로드 ─────────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  let loaded = false;

  loader.load(
    url,
    (gltf) => {
      const root = gltf.scene;

      // 원점 정렬 + 단위 크기로 정규화
      const box = new Box3().setFromObject(root);
      const center = box.getCenter(new Vector3());
      const span = box.getSize(new Vector3());
      const max = Math.max(span.x, span.y, span.z) || 1;

      root.position.sub(center);
      holder.scale.setScalar(1 / max);
      radius = 0.5 * Math.sqrt(3);

      root.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        const m = (o as Mesh).material as MeshStandardMaterial;
        if (m) {
          m.envMapIntensity = 0.7;
          // 종이 인쇄물 옆에 놓이는 물체 — 하이라이트를 눌러 톤을 맞춘다
          if (m.roughness !== undefined) m.roughness = Math.min(1, m.roughness * 1.1 + 0.06);
        }
      });

      holder.add(root);
      loaded = true;
      size = { w: 0, h: 0 };
      resize();
      onState('Loaded');
    },
    (e) => {
      if (e.lengthComputable && e.total) {
        onState(`${Math.round((e.loaded / e.total) * 100)}%`);
      }
    },
    () => onState('Unavailable'),
  );

  // ── 루프 ─────────────────────────────────────────────────────────
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let raf = 0;
  let visible = true;
  let onScreen = true;

  const io = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
  });
  io.observe(canvas);

  const onVis = () => {
    visible = document.visibilityState === 'visible';
  };
  document.addEventListener('visibilitychange', onVis);

  // 커서에 아주 약하게 반응 — 평면 위에 놓인 실물 같은 인상
  let px = 0;
  let py = 0;
  const onMove = (ev: PointerEvent) => {
    px = (ev.clientX / window.innerWidth - 0.5) * 2;
    py = (ev.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  let spin = 0;
  let last = performance.now();

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);

    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!visible || !onScreen || !loaded) return;

    resize();
    if (!reduced) spin += dt * 0.14;

    holder.rotation.y = spin + px * 0.12;
    holder.rotation.x = -py * 0.07;

    renderer.render(scene, camera);
  }

  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        }
      });
    },
  };
}
