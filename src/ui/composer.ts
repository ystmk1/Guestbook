import { LIMITS } from '../config';
import type { SubmitResult } from '../lib/store';

/* =====================================================================
   입력부.

   원본은 화면 하단의 밑줄 하나였다. 그건 "한 줄만 받는다"는 뜻이라
   좋았지만, 여러 줄과 닉네임이 붙으면 어디에 뭘 쓰는지 알기 어렵다.
   그래서 밑줄의 가벼움은 남기고 종이 카드 한 장으로 묶었다.
     · 큰 본문 밑줄 = 원본 그대로, 여전히 여기가 주인공
     · 닉네임은 작게 왼쪽 아래에 — 안 써도 되는 것처럼 보이게
     · Enter 전송 / Shift+Enter 줄바꿈 (최대 3줄)
   ===================================================================== */

export interface ComposerCallbacks {
  submit(body: string, nickname: string | null): Promise<SubmitResult>;
  /** 전송 성공 직후 — 날아가는 연출의 출발점을 넘긴다 */
  sent(from: { x: number; y: number }): void;
}

export interface Composer {
  focus(): void;
  dispose(): void;
}

const MESSAGES: Record<string, { text: string; tone: string }> = {
  ok: { text: '남겨졌습니다', tone: 'ok' },
  throttled: { text: '방금 남기셨어요 · 잠시 뒤에 다시', tone: 'warn' },
  offline: { text: '연결이 불안정합니다 · 잠시 뒤 자동으로 다시 보냅니다', tone: 'warn' },
  invalid: { text: '내용을 확인해 주세요', tone: 'warn' },
};

export function createComposer(cb: ComposerCallbacks): Composer {
  const root = document.getElementById('composer') as HTMLElement;
  const body = document.getElementById('cmp-body') as HTMLTextAreaElement;
  const nick = document.getElementById('cmp-nick') as HTMLInputElement;
  const count = document.getElementById('cmp-count') as HTMLElement;
  const send = document.getElementById('cmp-send') as HTMLButtonElement;
  const toast = document.getElementById('cmp-toast') as HTMLElement;

  let sending = false;
  let toastTimer: number | undefined;

  function say(kind: keyof typeof MESSAGES | null): void {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    if (!kind) {
      toast.dataset.show = '0';
      return;
    }
    const m = MESSAGES[kind];
    toast.textContent = m.text;
    toast.dataset.tone = m.tone;
    toast.dataset.show = '1';
    toastTimer = window.setTimeout(() => {
      toast.dataset.show = '0';
    }, 3600);
  }

  /** 3줄을 넘기지 않도록 잘라내고 높이를 내용에 맞춘다 */
  function normalize(): void {
    const lines = body.value.split('\n');
    if (lines.length > LIMITS.maxLines) {
      body.value = lines.slice(0, LIMITS.maxLines).join('\n');
    }
    body.style.height = 'auto';
    body.style.height = `${Math.min(body.scrollHeight, 140)}px`;
  }

  function refresh(): void {
    const len = [...body.value.trim()].length;
    count.textContent = `${len} / ${LIMITS.bodyMax}`;
    count.dataset.near = len > LIMITS.bodyMax - 20 ? '1' : '0';
    send.disabled = sending || len === 0;
    root.dataset.state = sending
      ? 'sending'
      : document.activeElement === body || document.activeElement === nick
        ? 'active'
        : 'idle';
  }

  async function submit(): Promise<void> {
    if (sending) return;
    const text = body.value.trim();
    if (!text) return;

    // 날아가는 연출의 출발점 — 입력창 상단 가운데
    const r = body.getBoundingClientRect();
    const from = { x: r.left + r.width / 2, y: r.top + 18 };

    sending = true;
    refresh();
    say(null);

    const result = await cb.submit(text, nick.value.trim() || null);

    sending = false;

    if (result.ok) {
      body.value = '';
      normalize();
      say('ok');
      cb.sent(from);
    } else {
      say(result.reason);
      // 오프라인은 어차피 큐에 들어갔으니 입력창은 비워준다
      if (result.reason === 'offline') {
        body.value = '';
        normalize();
        cb.sent(from);
      }
    }

    refresh();
    body.focus();
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter') return;
    if (ev.isComposing) return; // 한글 조합 중 Enter 는 확정용이다
    if (ev.shiftKey) {
      if (body.value.split('\n').length >= LIMITS.maxLines) ev.preventDefault();
      return;
    }
    ev.preventDefault();
    void submit();
  }

  const onInput = () => {
    normalize();
    refresh();
  };
  const onFocusChange = () => refresh();

  body.addEventListener('keydown', onKeyDown);
  body.addEventListener('input', onInput);
  body.addEventListener('focus', onFocusChange);
  body.addEventListener('blur', onFocusChange);
  nick.addEventListener('focus', onFocusChange);
  nick.addEventListener('blur', onFocusChange);
  send.addEventListener('click', () => void submit());

  normalize();
  refresh();

  return {
    focus() {
      body.focus();
    },
    dispose() {
      body.removeEventListener('keydown', onKeyDown);
      body.removeEventListener('input', onInput);
    },
  };
}
