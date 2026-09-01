import { HAS_SUPABASE, LOCAL_ADMIN_PIN, type Entry } from '../config';
import type { GuestbookStore } from '../lib/store';

/* =====================================================================
   전시 운영용 단축키. 관람객에게는 아무 흔적도 보이지 않는다.

     Ctrl + Shift + H   지금 보고 있는(고정한) 기록 숨기기
     Ctrl + Shift + S   전체 기록 백업 내려받기 (JSON + CSV)
     Ctrl + Shift + O   백업 파일에서 복원

   로컬 모드에서는 localStorage 가 유일한 원본이다.
   하루 한 번 Ctrl+Shift+S 로 파일을 받아두면 브라우저 사고에도 안전하다.
   ===================================================================== */

export interface AdminCallbacks {
  /** 지금 고정해서 보고 있는 기록 (없으면 null) */
  target(): Entry | null;
  /** 숨김 처리 후 포커스를 풀기 위해 */
  afterHide(): void;
  toast(text: string, tone?: 'ok' | 'warn'): void;
}

export interface Admin {
  dispose(): void;
}

function download(name: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function createAdmin(store: GuestbookStore, cb: AdminCallbacks): Admin {
  const panel = document.getElementById('admin') as HTMLElement;
  const bodyEl = document.getElementById('admin-target') as HTMLElement;
  const pinEl = document.getElementById('admin-pin') as HTMLInputElement;
  const okEl = document.getElementById('admin-ok') as HTMLButtonElement;
  const cancelEl = document.getElementById('admin-cancel') as HTMLButtonElement;
  const msgEl = document.getElementById('admin-msg') as HTMLElement;

  let pending: Entry | null = null;

  function close(): void {
    panel.hidden = true;
    pinEl.value = '';
    msgEl.textContent = '';
    pending = null;
  }

  function open(entry: Entry): void {
    pending = entry;
    bodyEl.textContent = entry.body;
    msgEl.textContent = '';
    pinEl.value = '';
    panel.hidden = false;
    pinEl.focus();
  }

  async function confirm(): Promise<void> {
    if (!pending) return;
    const pin = pinEl.value.trim();
    if (!pin) return;

    okEl.disabled = true;

    let ok: boolean;
    if (HAS_SUPABASE && !pending.id.startsWith('local:')) {
      // 서버가 PIN 을 검증한다
      ok = await store.hide(pending.id, pin);
    } else {
      ok = pin === LOCAL_ADMIN_PIN;
      if (ok) await store.hide(pending.id, pin);
    }

    okEl.disabled = false;

    if (!ok) {
      msgEl.textContent = 'PIN 이 맞지 않습니다';
      pinEl.value = '';
      pinEl.focus();
      return;
    }

    close();
    cb.afterHide();
    cb.toast('숨겼습니다', 'ok');
  }

  function exportAll(): void {
    const s = fileStamp();
    download(`sympoiesis-guestbook-${s}.json`, 'application/json', store.toJSON());
    // CSV 는 잠깐 뒤에 — 브라우저가 연속 다운로드를 막는 경우가 있다
    setTimeout(() => {
      download(`sympoiesis-guestbook-${s}.csv`, 'text/csv;charset=utf-8', store.toCSV());
    }, 400);
    cb.toast(`${store.entries.length}건 백업했습니다`, 'ok');
  }

  function importAll(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const added = store.importJSON(text);
      cb.toast(added ? `${added}건 복원했습니다` : '복원할 새 기록이 없습니다', added ? 'ok' : 'warn');
    };
    input.click();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && !panel.hidden) {
      ev.preventDefault();
      close();
      return;
    }

    if (!ev.ctrlKey || !ev.shiftKey) return;
    const k = ev.key.toLowerCase();

    if (k === 'h') {
      ev.preventDefault();
      const t = cb.target();
      if (!t) {
        cb.toast('숨길 기록을 먼저 클릭해서 고정하세요', 'warn');
        return;
      }
      open(t);
      return;
    }

    if (k === 's') {
      ev.preventDefault();
      exportAll();
      return;
    }

    if (k === 'o') {
      ev.preventDefault();
      importAll();
    }
  }

  const onOk = () => void confirm();
  const onPinKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void confirm();
    }
  };

  window.addEventListener('keydown', onKey);
  okEl.addEventListener('click', onOk);
  cancelEl.addEventListener('click', close);
  pinEl.addEventListener('keydown', onPinKey);

  return {
    dispose() {
      window.removeEventListener('keydown', onKey);
      okEl.removeEventListener('click', onOk);
      cancelEl.removeEventListener('click', close);
      pinEl.removeEventListener('keydown', onPinKey);
    },
  };
}
