import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HAS_SUPABASE, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

export interface EntryRow {
  id: string;
  body: string;
  nickname: string | null;
  created_at: string;
  hidden: boolean;
}

let client: SupabaseClient | null = null;

/** Supabase 미설정이면 null — 앱은 로컬 모드로 계속 동작한다. */
export function getSupabase(): SupabaseClient | null {
  if (!HAS_SUPABASE) return null;
  if (client) return client;

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // 전시장 공용 기기 — 세션을 남기지 않는다
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 4 },
    },
  });
  return client;
}
