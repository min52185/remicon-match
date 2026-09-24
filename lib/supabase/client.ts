'use client';

/**
 * Supabase 브라우저 클라이언트.
 *
 * 키가 없으면 `isSupabaseConfigured` 가 false 가 되고, 앱은 지금까지처럼
 * 브라우저 저장소로 동작한다. 키를 넣는 순간 공유 모드로 바뀐다.
 * 그래서 조원이 키 없이 코드를 받아도 앱이 그냥 돈다.
 *
 * 여기서 쓰는 것은 anon 키다. 이 키는 브라우저에 노출되는 것이 정상이고,
 * 실제 보호는 DB 의 RLS 정책이 한다 (supabase/migrations/0001_init.sql).
 * service_role 키는 절대 이 파일에 넣지 않는다 — RLS 를 통째로 무시하는 키다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = !!(url && anonKey);

let cached: SupabaseClient | null = null;

/** 설정돼 있으면 클라이언트를, 아니면 null 을 돌려준다 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  cached ??= createClient(url!, anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      // 기사 위치가 10~15초마다 올라온다. 초당 제한을 넉넉히 둔다.
      params: { eventsPerSecond: 20 },
    },
  });
  return cached;
}

/** 반드시 있어야 하는 자리에서 쓴다 */
export function requireSupabase(): SupabaseClient {
  const c = getSupabase();
  if (!c) {
    throw new Error(
      'Supabase 가 설정되지 않았습니다. .env.local 의 NEXT_PUBLIC_SUPABASE_URL 과 NEXT_PUBLIC_SUPABASE_ANON_KEY 를 확인하세요.',
    );
  }
  return c;
}
