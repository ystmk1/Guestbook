/* =====================================================================
   안내 화면

   아무도 없을 때 화면을 살짝 덮고 작동법을 띄운다.
   사람이 화면을 보는 낌새가 있으면 걷힌다.

   낌새를 잡는 두 가지를 같이 쓴다.

     입력    마우스·키보드·터치. 비용이 0 이고 늘 동작한다.
             다만 관람객이 노트북을 안 만지면 못 잡는다.

     웹캠    만지지 않아도 잡힌다. 64×48 로 줄여 앞 프레임과의 차이만
             본다 — 초당 1만 4천 번 남짓한 뺄셈이라 저사양에서도
             티가 안 난다. 영상은 어디로도 나가지 않고 저장하지도 않는다.
             권한을 못 받으면 조용히 입력 감지만 남는다.
   ===================================================================== */

/** 아무 낌새가 없으면 이만큼 뒤에 다시 덮는다 (밀리초) */
const IDLE = 20000;

/** 웹캠을 몇 밀리초마다 볼지 */
const LOOK = 220;

/*  움직임 판정.

    평균 차이로 보면 너무 쉽게 걸린다 — 어두운 방의 센서 노이즈가
    화면 전체를 조금씩 흔들어 평균을 금방 넘긴다. 그러면 안내문이
    계속 걷혀서 읽을 수가 없다.

    사람이 움직이면 '일부 영역이 크게' 바뀌고, 노이즈는 '전체가 조금씩'
    바뀐다. 그래서 크게 바뀐 화소가 몇 퍼센트인지로 본다. */

/** 한 화소가 이만큼 넘게 바뀌어야 바뀐 것으로 친다 (0~255) */
const PIXEL = 26;

/** 그런 화소가 화면의 이 비율을 넘어야 움직임으로 본다 */
const AREA = 0.045;

/** 그 상태가 이만큼 연달아 이어져야 사람으로 친다 */
const STREAK = 2;

/** 커서가 이만큼(px) 움직여야 조작으로 친다 — 손 떨림은 무시 */
const MOVE = 28;

const W = 64;
const H = 48;

export interface Attract {
  /** 지금 사람이 있는 것으로 치고 걷는다 */
  wake(): void;
}

export function startAttract(el: HTMLElement, useCamera = true): Attract {
  let away = false;
  let timer = 0;

  const show = () => {
    if (!away) return;
    away = false;
    el.classList.remove('away');
  };

  const hide = () => {
    if (!away) {
      away = true;
      el.classList.add('away');
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(show, IDLE);
  };

  /* ── 입력 ─────────────────────────────────────────────────────── */

  // 누르거나 치는 건 분명한 의사라 바로 걷는다
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, hide, { passive: true });
  }

  /*  커서는 조금 움직였다고 걷지 않는다. 책상 진동이나 손 떨림으로도
      pointermove 는 뜬다. 마지막으로 걷은 자리에서 일정 거리 이상
      벗어났을 때만 조작으로 친다. */
  let ax = -1;
  let ay = -1;

  window.addEventListener(
    'pointermove',
    (ev) => {
      if (ax < 0) {
        ax = ev.clientX;
        ay = ev.clientY;
        return;
      }
      const dx = ev.clientX - ax;
      const dy = ev.clientY - ay;
      if (dx * dx + dy * dy < MOVE * MOVE) return;

      ax = ev.clientX;
      ay = ev.clientY;
      hide();
    },
    { passive: true },
  );

  /* ── 웹캠 ─────────────────────────────────────────────────────── */
  // 낡은 브라우저나 안전하지 않은 접속(http)에서는 mediaDevices 가 아예 없다
  if (useCamera && navigator.mediaDevices) {
    void watchCamera(hide).catch(() => undefined);
  }

  return { wake: hide };
}

async function watchCamera(onMotion: () => void): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // 작게 받는다. 어차피 더 줄여서 볼 것이고, 큰 프레임은 디코딩만 비싸다.
    video: { width: { ideal: 160 }, height: { ideal: 120 }, frameRate: { ideal: 10 } },
    audio: false,
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  // 매 번 읽어갈 것이라고 미리 알려주면 브라우저가 그에 맞게 잡아둔다
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  /*  앞 프레임의 밝기만 들고 있는다.
      RGBA 를 통째로 복사하면 틱마다 12KB 씩 버리게 된다. 밝기 한 채널만
      쓰면 3KB 고, 버퍼를 다시 써서 아예 안 버린다. */
  const prev = new Uint8Array(W * H);
  let primed = false;
  let streak = 0;

  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;

    ctx.drawImage(video, 0, 0, W, H);
    const cur = ctx.getImageData(0, 0, W, H).data;

    let changed = 0;
    for (let p = 0, i = 0; p < prev.length; p++, i += 4) {
      // 빨강 한 채널로 충분하다. 셋 다 보면 세 배 든다.
      const v = cur[i];
      if (primed && Math.abs(v - prev[p]) > PIXEL) changed++;
      prev[p] = v;
    }

    // 첫 틱은 견줄 대상이 없다
    if (!primed) {
      primed = true;
      return;
    }

    // 한 번 튄 것으로는 안 걷는다. 연달아 이어져야 사람으로 친다.
    if (changed / prev.length > AREA) {
      streak++;
      if (streak >= STREAK) onMotion();
    } else {
      streak = 0;
    }
  }, LOOK);
}
