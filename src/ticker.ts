/* =====================================================================
   안내 전광판

   같은 문구를 화면 폭보다 넓어질 때까지 이어 붙여 한 벌을 만들고,
   그 한 벌을 두 번 늘어놓은 뒤 정확히 절반(=한 벌 폭)만큼 밀어낸다.
   끝과 처음이 맞물려서 이음매가 보이지 않는다.

   속도는 한 벌의 폭에 맞춰 정한다. 시간을 고정해두면 화면이 넓을수록
   빨라져서, 전시장 화면과 다른 화면에서 다르게 보인다.

   전시장 노트북의 브라우저가 낡았을 수 있다. 그래서 구형에서 깨지기
   쉬운 것들을 피하고, 그래도 안 움직이면 직접 굴리는 길을 둔다.
   ===================================================================== */

/** 초당 몇 픽셀로 흐를지 — 천천히 */
const SPEED = 34;

export function startTicker(host: HTMLElement, text: string): void {
  /* 직접 굴리고 있을 때의 취소표. 다시 짤 때 두 벌이 겹쳐 돌지 않게 한다. */
  let raf = 0;

  /*  CSS 애니메이션이 실제로 걸렸는지 확인하고, 아니면 직접 굴린다.
      낡은 브라우저·벤더 접두사·운영체제의 '동작 줄이기' 어느 쪽으로
      막히든 전광판은 흘러야 한다 — 작동법을 알리는 띠라서 그렇다. */
  const ensureMoving = (width: number) => {
    const cs = getComputedStyle(host);
    const name = cs.animationName;
    const dur = parseFloat(cs.animationDuration || '0');
    if (name && name !== 'none' && dur > 0) return;

    host.style.animation = 'none';
    let t0 = 0;
    const step = (t: number) => {
      if (!t0) t0 = t;
      const x = (((t - t0) / 1000) * SPEED) % width;
      host.style.transform = `translateX(${-x}px)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  const build = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }

    // replaceChildren 은 2020년 이후 브라우저에만 있다. 없으면 여기서
    // 예외가 나 전광판이 통째로 비어버리므로 쓰지 않는다.
    while (host.firstChild) host.removeChild(host.firstChild);

    // 한 벌을 만든다. 화면 폭을 넘길 때까지 문구를 늘린다.
    const set = document.createElement('div');
    set.className = 'ticker-set';
    host.appendChild(set);

    const need = window.innerWidth;
    let guard = 0;
    do {
      const span = document.createElement('span');
      span.textContent = text;
      set.appendChild(span);
      guard++;
    } while (set.offsetWidth < need && guard < 60);

    const width = set.offsetWidth;

    // 두 벌째는 그대로 복제한다
    host.appendChild(set.cloneNode(true));

    /*  폭을 직접 박는다. max-content 를 못 알아듣는 브라우저에서는 띠가
        화면 폭으로 잘려서, 절반을 미는 계산이 어긋난다. */
    host.style.width = `${width * 2}px`;

    /*  길이는 사용자 정의 속성이 아니라 값으로 직접 넣는다. 단축 속성
        (animation: … var(--x) …) 안의 var 는 구형 브라우저에서 선언을
        통째로 무효로 만들어, 글자는 보이는데 가만히 서 있게 된다. */
    host.style.animationDuration = `${(width / SPEED).toFixed(1)}s`;

    ensureMoving(width);
  };

  build();

  // 창 크기가 바뀌면 한 벌의 폭이 모자랄 수 있어 다시 짠다
  let pending = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(pending);
    pending = window.setTimeout(build, 200);
  });
}
