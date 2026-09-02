/* =====================================================================
   브라우저 확대·축소 다루기

   확대는 CSS 픽셀 전체를 키운다. 그러면 제호와 입력줄까지 같이 커져
   판면이 이상해진다. 두 가지로 대응한다.

     1. 실수로 확대되는 경로를 막는다.
        전시장에서 확대가 되는 건 대개 트랙패드 핀치나 Ctrl+휠이다.
        이건 페이지에서 확실히 막을 수 있다.

     2. 그래도 확대되면(키보드 Ctrl +/-) 배율을 재서 CSS 에 넘긴다.
        제호와 입력줄은 그 값으로 나눠 크기를 되돌리고, 모눈은
        나누지 않아 그대로 커진다.

   키보드 확대 단축키는 브라우저가 페이지보다 먼저 가져가는 경우가 있어
   막는 것을 보장할 수 없다. 그래서 2번이 필요하다.
   ===================================================================== */

/** 확대 배율을 재서 --zoom 에 넣는다 */
export function trackZoom(): void {
  // 처음 열렸을 때를 100% 로 본다. 전시장 노트북은 한 화면에 고정이라
  // 이 가정이 깨질 일이 없다. (모니터를 옮기면 기준이 어긋난다)
  const base = window.devicePixelRatio || 1;
  const root = document.documentElement;

  const apply = () => {
    const now = window.devicePixelRatio || 1;
    const z = now / base;
    root.style.setProperty('--zoom', String(z > 0 ? z : 1));
  };

  // 확대 배율이 바뀌면 devicePixelRatio 가 바뀌고 resize 가 뜬다
  window.addEventListener('resize', apply);
  apply();
}

/** 실수로 확대되는 경로를 막는다 */
export function blockAccidentalZoom(): void {
  // Ctrl+휠 · 트랙패드 핀치
  window.addEventListener(
    'wheel',
    (ev) => {
      if (ev.ctrlKey) ev.preventDefault();
    },
    { passive: false },
  );

  // 사파리의 핀치 제스처
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    window.addEventListener(name, (ev) => ev.preventDefault(), { passive: false });
  }

  // 키보드 Ctrl +/-/0 — 브라우저가 먼저 가져가면 막히지 않지만
  // 막히는 브라우저도 있으므로 시도는 한다
  window.addEventListener(
    'keydown',
    (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      if (['+', '-', '=', '0'].includes(ev.key)) ev.preventDefault();
    },
    { passive: false },
  );
}
