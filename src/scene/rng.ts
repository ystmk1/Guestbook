/**
 * 결정론적 난수 — 원본 아티팩트와 동일한 mulberry32(77002).
 * 시드가 같으면 어느 기기에서 열어도 가지 모양이 똑같이 나온다.
 * 전시 사진/영상과 실물 화면이 어긋나지 않게 하려면 시드를 바꾸지 말 것.
 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 표준정규분포 (Box–Muller) */
export function makeGaussian(rand: () => number): () => number {
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
