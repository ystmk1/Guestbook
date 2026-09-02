import { HAS_SUPABASE, STORE_LIMIT, type Entry } from './config';
import { screen } from './filter';

/* =====================================================================
   저장소

   로컬 모드: 이 브라우저의 localStorage 가 원본.
   서버 모드: VITE_SUPABASE_* 를 넣으면 자동 전환 (supabase/schema.sql).

   욕설·스팸에 걸린 줄은 지우지 않고 조용히 격리한다. 작성자에게는
   등록된 것처럼 보이고 화면에만 안 뜬다.
   ===================================================================== */

const KEY = 'sympoiesis.entries.v2';
const KEY_BACKUP = 'sympoiesis.entries.backup.v2';
const KEY_QUARANTINE = 'sympoiesis.quarantine.v2';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ((JSON.parse(raw) as T) ?? fallback) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 시크릿 모드 등 — 저장 못 해도 화면은 계속 돈다 */
  }
}

export class Store {
  /** 오래된 것 → 최신 순 */
  entries: Entry[] = [];

  private quarantine: Entry[] = read<Entry[]>(KEY_QUARANTINE, []);
  private listeners = new Set<(e: Entry[]) => void>();
  private lastAt = 0;

  constructor() {
    let rows = read<Entry[]>(KEY, []);
    // 주 저장소가 비었는데 백업이 남아 있으면 되살린다
    if (!rows.length) rows = read<Entry[]>(KEY_BACKUP, []);
    this.entries = rows.sort((a, b) => a.createdAt - b.createdAt);

    // 예전 형식에는 칸 번호가 없다. 없거나 겹치면 순서대로 채워 넣는다.
    const used = new Set<number>();
    let next = 0;
    for (const e of this.entries) {
      const ok = Number.isInteger(e.slot) && e.slot >= 0 && !used.has(e.slot);
      if (!ok) {
        while (used.has(next)) next++;
        e.slot = next;
      }
      used.add(e.slot);
    }
  }

  subscribe(fn: (e: Entry[]) => void): void {
    this.listeners.add(fn);
    fn(this.entries);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.entries);
  }

  private persist(): void {
    const rows = this.entries.slice(-STORE_LIMIT);
    write(KEY, rows);
    // 백업은 줄어들지 않는다 — 오조작으로 목록이 비어도 다음 실행 때 살아난다
    if (rows.length >= read<Entry[]>(KEY_BACKUP, []).length) write(KEY_BACKUP, rows);
  }

  /** 한 줄 추가. 실제로 화면에 올라갔으면 true. */
  add(body: string, name?: string | null): boolean {
    const text = body.trim().replace(/\s+/g, ' ');
    if (!text) return false;

    const who = (name ?? '').trim().replace(/\s+/g, ' ') || null;

    // 도배 차단
    if (Date.now() - this.lastAt < 1500) return false;
    this.lastAt = Date.now();

    const entry: Entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      body: text,
      name: who,
      createdAt: Date.now(),
      slot: this.nextSlot(),
    };

    if (screen(text, who)) {
      this.quarantine.push(entry);
      write(KEY_QUARANTINE, this.quarantine.slice(-500));
      return true; // 막혔다는 반응을 주지 않는다
    }

    this.entries.push(entry);
    if (this.entries.length > STORE_LIMIT) {
      this.entries = this.entries.slice(-STORE_LIMIT);
    }
    this.persist();
    this.emit();
    return true;
  }

  /**
   * 다음 글이 앉을 칸 번호 — 늘 쓰던 것보다 하나 뒤.
   * 지워서 빈 번호를 바로 다시 쓰지 않고 순서 맨 뒤로 미룬다.
   * (판이 다 차면 화면 쪽에서 빈 번호로 되돌려 쓴다)
   */
  private nextSlot(): number {
    let s = 0;
    for (const e of this.entries) s = Math.max(s, e.slot + 1);
    return s;
  }

  /**
   * 관리자 삭제. 목록에서 실제로 빼서 그 칸 번호가 다시 비게 한다.
   * 지운 것은 격리 목록에 남겨 되살릴 수 있게 한다.
   */
  remove(id: string): boolean {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return false;

    this.quarantine.push(this.entries[i]);
    write(KEY_QUARANTINE, this.quarantine.slice(-500));

    this.entries.splice(i, 1);
    this.persist();
    this.emit();
    return true;
  }

  /** 백업용 — 콘솔에서 store.toJSON() 으로 꺼낼 수 있다 */
  toJSON(): string {
    return JSON.stringify(
      { app: 'sympoiesis', exportedAt: new Date().toISOString(), entries: this.entries },
      null,
      2,
    );
  }

  get mode(): 'local' | 'server' {
    return HAS_SUPABASE ? 'server' : 'local';
  }
}
