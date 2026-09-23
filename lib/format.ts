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
