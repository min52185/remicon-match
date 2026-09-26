import { MIN } from './rules';

/** 09:24 */
export const clock = (at: number | undefined | null) =>
  at == null
    ? '--:--'
    : new Date(at).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

/** 9월 23일 09:24 */
export const dateClock = (at: number) =>
  new Date(at).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** 42분 / 1시간 12분 */
export function duration(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}시간 ${rest}분` : `${h}시간`;
}

/** 남은 시간 — 지났으면 "지남" */
export function remaining(at: number, now: number) {
  const m = Math.round((at - now) / MIN);
  return m < 0 ? `${duration(-m)} 지남` : duration(m);
}

/**
 * 타설 기한까지 남은 시간.
 *
 * "지금으로부터 남은 시간"만 쓰면 도착 예상이 이미 기한을 넘긴 차도
 * "1시간 남음"으로 보인다 — 배지는 빨간데 글자는 안심시키는 꼴이 된다.
 * 그래서 도착 예상과 지금 중 늦은 쪽을 기준으로 잰다.
 */
export function limitRemaining(limitAt: number, etaAt: number, now: number) {
  const over = Math.round((Math.max(now, etaAt) - limitAt) / MIN);
  return over > 0 ? `${duration(over)} 초과 예상` : `${remaining(limitAt, now)} 남음`;
}

/** +7분 늦음 / -3분 빠름 / 예상대로 */
export function delayText(delayMinutes: number) {
  if (delayMinutes > 0) return `${delayMinutes}분 늦음`;
  if (delayMinutes < 0) return `${-delayMinutes}분 빠름`;
  return '예상대로';
}

export const m3 = (v: number) => `${Math.round(v * 10) / 10}m³`;
export const km = (v: number) => `${Math.round(v * 10) / 10}km`;

/** datetime-local 입력값 ↔ epoch */
export const toLocalInput = (at: number) => {
  const d = new Date(at - d0(at));
  return d.toISOString().slice(0, 16);
};
const d0 = (at: number) => new Date(at).getTimezoneOffset() * MIN;
export const fromLocalInput = (v: string) => new Date(v).getTime();

/**
 * 오류를 화면에 보여 줄 한 줄로.
 * Supabase RLS 거절은 영문 코드만 와서 원인을 짐작하기 어렵다 — 뜻을 덧붙인다.
 */
export function failure(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const code = (e as { code?: string } | null)?.code;

  if (code === '42501' || /row-level security/i.test(msg)) {
    return `${fallback} 권한이 없습니다 — 이 계정의 역할·소속으로는 할 수 없는 작업입니다.`;
  }
  // 열이 없다 — 마이그레이션을 안 돌렸을 때 나온다. 원인을 짐작하게 두지 않는다.
  if (code === '42703' || /column .* does not exist/i.test(msg)) {
    return `${fallback} DB 에 없는 항목입니다 — Supabase SQL Editor 에서 supabase/migrations 의 SQL 을 순서대로 실행했는지 확인하세요.`;
  }
  if (code === '23505') return `${fallback} 같은 번호가 이미 있습니다. 다시 시도해 주세요.`;
  if (code === '23503') return `${fallback} 연결된 자료를 찾지 못했습니다.`;
  if (/failed to fetch|networkerror/i.test(msg)) {
    return `${fallback} 인터넷 연결을 확인해 주세요.`;
  }
  return msg ? `${fallback} (${msg})` : fallback;
}
