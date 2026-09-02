/* =====================================================================
   안내 전광판

   같은 문구를 화면 폭보다 넓어질 때까지 이어 붙여 한 벌을 만들고,
   그 한 벌을 두 번 늘어놓은 뒤 정확히 절반(=한 벌 폭)만큼 밀어낸다.
   끝과 처음이 맞물려서 이음매가 보이지 않는다.

   속도는 한 벌의 폭에 맞춰 정한다. 시간을 고정해두면 화면이 넓을수록
   빨라져서, 전시장 화면과 다른 화면에서 다르게 보인다.
   ===================================================================== */

/** 초당 몇 픽셀로 흐를지 — 천천히 */
const SPEED = 34;

export function startTicker(host: HTMLElement, text: string): void {
  const build = () => {
    host.replaceChildren();

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

    // 폭에 비례한 시간 → 화면 크기와 무관하게 같은 속도로 흐른다
    host.style.setProperty('--ticker-dur', `${(width / SPEED).toFixed(1)}s`);
  };

  build();

  // 창 크기가 바뀌면 한 벌의 폭이 모자랄 수 있어 다시 짠다
  let pending = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(pending);
    pending = window.setTimeout(build, 200);
  });
}
