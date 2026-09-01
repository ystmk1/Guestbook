import { DEMO_MODE, DEMO_SEED, HAS_SUPABASE, TUNING, type Entry } from '../config';
import { getSupabase, type EntryRow } from './supabase';
import { screen } from './filter';

/* =====================================================================
   방명록 저장소

   두 가지 모드로 돈다. 앱 코드는 어느 쪽인지 신경 쓰지 않는다.

   [로컬 모드]  환경변수 없음 — 이 브라우저의 localStorage 가 원본이다.
                노트북 한 대로 운영할 때. 인터넷이 아예 없어도 된다.
                ※ 브라우저 데이터를 지우면 기록도 같이 사라진다 →
                  주기적으로 백업 파일을 내려받을 것 (Ctrl+Shift+S).

   [서버 모드]  VITE_SUPABASE_* 를 넣으면 자동 전환.
                실시간 수신 + 오프라인 큐 + 관리자 숨김이 붙는다.
   ===================================================================== */

const CACHE_KEY = 'sympoiesis.entries.v1';
const BACKUP_KEY = 'sympoiesis.entries.backup.v1';
const OUTBOX_KEY = 'sympoiesis.outbox.v1';
const CLIENT_KEY = 'sympoiesis.client.v1';
const QUARANTINE_KEY = 'sympoiesis.quarantine.v1';

export type StoreStatus = 'connecting' | 'live' | 'offline' | 'local';

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: 'throttled' | 'invalid' | 'offline' };

interface OutboxItem {
  localId: string;
  body: string;
  nickname: string | null;
  createdAt: number;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 시크릿 모드 등 — 저장 못 해도 앱은 계속 돈다 */
  }
}

function clientId(): string {
  let id = '';
  try {
    id = localStorage.getItem(CLIENT_KEY) ?? '';
  } catch {
    /* ignore */
  }
  if (!id) {
    id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)) as string;
    try {
      localStorage.setItem(CLIENT_KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

function rowToEntry(r: EntryRow): Entry {
  return {
    id: r.id,
    body: r.body,
    nickname: r.nickname,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export class GuestbookStore {
  /** 오래된 것 → 최신 순. tip 배정 순서와 같다. */
  entries: Entry[] = [];
  status: StoreStatus = HAS_SUPABASE ? 'connecting' : 'local';

  private readonly cid = clientId();
  private listeners = new Set<(entries: Entry[], status: StoreStatus) => void>();
  private outbox: OutboxItem[] = readJSON<OutboxItem[]>(OUTBOX_KEY, []);
  /** 필터에 걸려 화면에서 뺀 글 — 지우지 않고 남겨두고 나중에 검토한다 */
  private quarantine: Entry[] = readJSON<Entry[]>(QUARANTINE_KEY, []);
  private lastLocalSubmit = 0;
  private resyncTimer: number | undefined;
  private flushTimer: number | undefined;

  subscribe(fn: (entries: Entry[], status: StoreStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.entries, this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.entries, this.status);
  }

  private setStatus(s: StoreStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit();
  }

  async start(): Promise<void> {
    // 1) 저장된 기록부터 즉시 화면에 올린다 (네트워크를 기다리지 않는다)
    let cached = readJSON<Entry[]>(CACHE_KEY, []);

    // 주 저장소가 비었는데 백업이 남아 있으면 되살린다
    if (!cached.length) {
      const backup = readJSON<Entry[]>(BACKUP_KEY, []);
      if (backup.length) {
        cached = backup;
        writeJSON(CACHE_KEY, backup);
      }
    }

    if (cached.length) {
      this.entries = cached.sort((a, b) => a.createdAt - b.createdAt);
      this.emit();
    }

    const sb = getSupabase();

    if (!sb) {
      // 로컬 모드 — localStorage 가 원본이다.
      // 예시 문장은 ?demo=1 로 열었을 때만 깐다. 전시 화면은 빈 상태로 시작.
      if (!this.entries.length && DEMO_MODE) {
        const now = Date.now();
        this.entries = DEMO_SEED.map((body, i) => ({
          id: `demo:${i}`,
          body,
          nickname: null,
          createdAt: now - (DEMO_SEED.length - i) * 3600e3 * 3.1,
        }));
        this.cache();
      }
      this.setStatus('local');
      this.emit();
      return;
    }

    await this.resync();

    // 2) 새 글 실시간 수신
    sb.channel('entries-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'entries' },
        (payload) => {
          const row = payload.new as EntryRow;
          if (row.hidden) return;
          this.mergeIn([rowToEntry(row)]);
        },
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') this.setStatus('live');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          this.setStatus('offline');
        }
      });

    // 3) 주기적 전체 재동기화
    //    관리자가 숨긴 글은 RLS 때문에 realtime 으로 전파되지 않으므로
    //    (숨겨진 행은 더 이상 select 정책을 통과하지 못한다)
    //    주기적으로 통째로 다시 읽어 화면에서 걷어낸다.
    this.resyncTimer = window.setInterval(() => {
      void this.resync();
    }, TUNING.resyncInterval);

    window.addEventListener('online', () => void this.flushOutbox());
    void this.flushOutbox();
  }

  /** 서버 목록을 통째로 다시 읽어 화면을 맞춘다 (숨김 처리 반영 포함) */
  async resync(): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;

    const { data, error } = await sb
      .from('entries')
      .select('id, body, nickname, created_at, hidden')
      .eq('hidden', false)
      .order('created_at', { ascending: false })
      .limit(TUNING.fetchLimit);

    if (error || !data) {
      this.setStatus('offline');
      return;
    }

    const fresh = (data as EntryRow[]).map(rowToEntry).reverse(); // 오래된 것 먼저

    // 아직 서버에 못 올린 글은 화면에서 지우지 않는다
    const pending = this.entries.filter((e) => e.pending);
    this.entries = [...fresh, ...pending].sort((a, b) => a.createdAt - b.createdAt);

    this.setStatus('live');
    this.cache();
    this.emit();
  }

  private mergeIn(incoming: Entry[]): void {
    const seen = new Set(this.entries.map((e) => e.id));
    let changed = false;

    for (const e of incoming) {
      if (seen.has(e.id)) continue;

      // 낙관적으로 먼저 띄워둔 로컬 글이 같은 내용으로 돌아온 경우 → 승격
      const localIdx = this.entries.findIndex(
        (x) =>
          x.pending &&
          x.body === e.body &&
          Math.abs(x.createdAt - e.createdAt) < 30_000,
      );
      if (localIdx >= 0) {
        this.entries[localIdx] = e;
      } else {
        this.entries.push(e);
      }
      seen.add(e.id);
      changed = true;
    }

    if (!changed) return;
    this.entries.sort((a, b) => a.createdAt - b.createdAt);
    if (this.entries.length > TUNING.storeLimit) {
      this.entries = this.entries.slice(-TUNING.storeLimit);
    }
    this.cache();
    this.emit();
  }

  private cache(): void {
    const rows = this.entries.slice(-TUNING.storeLimit);
    writeJSON(CACHE_KEY, rows);

    // 로컬 모드에서는 이 값이 유일한 원본이라 백업을 한 벌 더 남긴다.
    // 백업은 "줄어들지 않는다" — 버그나 오조작으로 목록이 비어도
    // 다음 실행 때 start() 가 백업에서 되살린다.
    const backup = readJSON<Entry[]>(BACKUP_KEY, []);
    if (rows.length >= backup.length) writeJSON(BACKUP_KEY, rows);
  }

  /** 새 글 등록. 화면에는 즉시 반영하고 서버 전송은 뒤에서 처리한다. */
  async submit(body: string, nickname: string | null): Promise<SubmitResult> {
    const text = body.trim();
    if (!text) return { ok: false, reason: 'invalid' };

    const localId = `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const entry: Entry = {
      id: localId,
      body: text,
      nickname: nickname?.trim() || null,
      createdAt: Date.now(),
      pending: true,
    };

    const sb = getSupabase();

    if (!sb) {
      // ── 로컬 모드 ──────────────────────────────────────────────
      // 서버 트리거가 없으므로 도배 차단도 여기서 한다.
      if (Date.now() - this.lastLocalSubmit < 10_000) {
        return { ok: false, reason: 'throttled' };
      }

      // 걸린 글은 화면에 올리지 않고 격리 보관하되,
      // 작성자에게는 성공처럼 보이게 한다 (반응을 주면 더 시도한다).
      const flag = screen(entry.body, entry.nickname);
      if (flag) {
        this.quarantine.push({ ...entry, pending: false });
        writeJSON(QUARANTINE_KEY, this.quarantine.slice(-500));
        this.lastLocalSubmit = Date.now();
        return { ok: true };
      }

      this.lastLocalSubmit = Date.now();
      entry.pending = false;
      this.entries.push(entry);
      this.cache();
      this.emit();
      return { ok: true };
    }

    // ── 서버 모드 ────────────────────────────────────────────────
    // 낙관적으로 먼저 화면에 올린다 (전송을 기다리지 않는다)
    this.entries.push(entry);
    this.cache();
    this.emit();

    const { data, error } = await sb
      .from('entries')
      .insert({ body: entry.body, nickname: entry.nickname, client_id: this.cid })
      .select('id, body, nickname, created_at, hidden')
      .single();

    if (error) {
      const msg = `${error.message} ${error.details ?? ''}`.toLowerCase();

      if (msg.includes('throttled')) {
        // 도배 차단 — 화면에서도 걷어낸다
        this.entries = this.entries.filter((e) => e.id !== localId);
        this.cache();
        this.emit();
        return { ok: false, reason: 'throttled' };
      }

      if (msg.includes('violates check constraint')) {
        this.entries = this.entries.filter((e) => e.id !== localId);
        this.cache();
        this.emit();
        return { ok: false, reason: 'invalid' };
      }

      // 네트워크 문제로 보고 outbox 에 넣어 재전송
      this.outbox.push({
        localId,
        body: entry.body,
        nickname: entry.nickname,
        createdAt: entry.createdAt,
      });
      writeJSON(OUTBOX_KEY, this.outbox);
      this.setStatus('offline');
      this.scheduleFlush();
      return { ok: false, reason: 'offline' };
    }

    // 성공 — 로컬 임시 행을 서버 행으로 교체
    if (data) {
      const row = data as EntryRow;
      const idx = this.entries.findIndex((e) => e.id === localId);
      if (idx >= 0) this.entries[idx] = rowToEntry(row);
      this.entries.sort((a, b) => a.createdAt - b.createdAt);
      this.cache();
      this.emit();
    }

    return { ok: true };
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushOutbox();
    }, 15_000);
  }

  /** 전송 실패분 재시도 */
  private async flushOutbox(): Promise<void> {
    const sb = getSupabase();
    if (!sb || !this.outbox.length) return;

    const queue = [...this.outbox];
    for (const item of queue) {
      const { error } = await sb
        .from('entries')
        .insert({ body: item.body, nickname: item.nickname, client_id: this.cid });

      // throttle 로 막힌 건 잠시 뒤 다시, 그 외 실패는 버리지 않고 남겨둔다
      if (error && !`${error.message}`.toLowerCase().includes('throttled')) {
        this.setStatus('offline');
        this.scheduleFlush();
        return;
      }
      if (error) {
        this.scheduleFlush();
        return;
      }
      this.outbox = this.outbox.filter((o) => o.localId !== item.localId);
      writeJSON(OUTBOX_KEY, this.outbox);
    }

    await this.resync();
  }

  /** 관리자 숨김 — PIN 은 서버에서 검증한다 */
  async hide(id: string, pin: string): Promise<boolean> {
    const sb = getSupabase();

    if (!sb || id.startsWith('local:') || id.startsWith('demo:')) {
      // 지우지 않고 격리로 옮긴다 — 오조작해도 되살릴 수 있어야 한다
      const victim = this.entries.find((e) => e.id === id);
      if (victim) {
        this.quarantine.push(victim);
        writeJSON(QUARANTINE_KEY, this.quarantine.slice(-500));
      }
      this.entries = this.entries.filter((e) => e.id !== id);
      this.cache();
      this.emit();
      return true;
    }

    const { error } = await sb.rpc('admin_hide_entry', { p_id: id, p_pin: pin });
    if (error) return false;

    this.entries = this.entries.filter((e) => e.id !== id);
    this.cache();
    this.emit();
    return true;
  }

  /* ── 백업 · 복원 ──────────────────────────────────────────────────
     로컬 모드에서 localStorage 는 브라우저 데이터를 지우면 통째로
     사라진다. 전시 기간에는 하루 한 번 Ctrl+Shift+S 로 파일을 받아둘 것.
     ------------------------------------------------------------------ */

  /** 백업 파일용 JSON */
  toJSON(): string {
    return JSON.stringify(
      {
        app: 'sympoiesis-guestbook',
        version: 1,
        exportedAt: new Date().toISOString(),
        count: this.entries.length,
        entries: this.entries.map((e) => ({
          id: e.id,
          body: e.body,
          nickname: e.nickname,
          createdAt: e.createdAt,
        })),
        // 필터·관리자 숨김으로 화면에서 뺀 글. 복원(Ctrl+Shift+O)할 때는
        // 다시 들어가지 않는다. 나중에 검토용으로만 남겨둔다.
        quarantined: this.quarantine.map((e) => ({
          body: e.body,
          nickname: e.nickname,
          createdAt: e.createdAt,
        })),
      },
      null,
      2,
    );
  }

  /** 엑셀에서 바로 열리는 CSV (UTF-8 BOM 포함) */
  toCSV(): string {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = [['작성시각', '닉네임', '내용'].map(esc).join(',')];
    for (const e of this.entries) {
      rows.push(
        [
          esc(new Date(e.createdAt).toLocaleString('ko-KR')),
          esc(e.nickname ?? ''),
          esc(e.body),
        ].join(','),
      );
    }
    return '﻿' + rows.join('\r\n');
  }

  /** 백업 파일에서 복원 — 기존 기록과 합치고, 중복은 건너뛴다 */
  importJSON(text: string): number {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 0;
    }

    const raw = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(raw)) return 0;

    const known = new Set(this.entries.map((e) => `${e.createdAt}|${e.body}`));
    let added = 0;

    for (const item of raw as Entry[]) {
      if (typeof item?.body !== 'string' || typeof item?.createdAt !== 'number') continue;
      const key = `${item.createdAt}|${item.body}`;
      if (known.has(key)) continue;
      known.add(key);
      this.entries.push({
        id: item.id ?? `local:${item.createdAt}`,
        body: item.body,
        nickname: item.nickname ?? null,
        createdAt: item.createdAt,
      });
      added++;
    }

    if (added) {
      this.entries.sort((a, b) => a.createdAt - b.createdAt);
      this.cache();
      this.emit();
    }
    return added;
  }

  dispose(): void {
    if (this.resyncTimer !== undefined) clearInterval(this.resyncTimer);
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer);
    getSupabase()?.removeAllChannels();
  }
}
