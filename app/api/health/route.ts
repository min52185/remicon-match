/**
 * 설정 점검 — 서버 키가 들어와 있는지만 알려 준다.
 *
 * ⚠ 키 값 자체는 절대로 내보내지 않는다. 있는지 없는지(boolean)와 길이만 돌려준다.
 *   길이를 주는 이유: 복사할 때 따옴표나 공백이 섞여 들어간 경우를 잡기 위해서다.
 */

import { NextResponse } from 'next/server';

const check = (v: string | undefined) => ({
  set: !!v && v.trim().length > 0,
  length: v?.trim().length ?? 0,
  /** 따옴표·공백이 섞여 들어간 흔한 실수 */
  suspicious: !!v && (v !== v.trim() || /^["']|["']$/.test(v)),
});

export async function GET() {
  return NextResponse.json({
    kakaoRest: check(process.env.KAKAO_REST_API_KEY),
    kma: check(process.env.KMA_SERVICE_KEY),
    supabaseUrl: check(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnon: check(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseService: check(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
