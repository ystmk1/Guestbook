/** 방명록 한 줄 */
export interface Entry {
  id: string;
  body: string;
  /** 안 쓰면 null */
  name: string | null;
  createdAt: number;
}

export const LIMITS = {
  /* 본문에는 길이 제한을 두지 않는다. 이름만 판면에 들어갈 만큼 제한한다. */
  nameMax: 12,
} as const;

/** 보관 상한 — localStorage 가 원본이므로 넉넉히 잡는다 */
export const STORE_LIMIT = 5000;

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/**
 * 환경변수를 넣으면 서버 모드, 없으면 이 브라우저의 localStorage 에 저장한다.
 * 지금은 로컬 모드.
 */
export const HAS_SUPABASE = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
