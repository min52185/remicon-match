/**
 * 외기온도 — 90분/120분 제한을 자동으로 고르기 위해 쓴다.
 *
 * 서버(app/api/weather)가 기상청 단기예보를 호출하고, 키가 없으면 평년값 근사로 떨어진다.
 * 현장이 직접 입력한 값이 있으면 그 값이 항상 우선이다 (책임기술자 판단).
 */

import { hash01, round1 } from '../geo';
import type { LatLng } from '../types';

export interface Temperature {
  tempC: number;
  at: number;
  source: 'kma' | 'approx' | 'manual';
}

/* ==========================================================================
 * 한국시각(KST)
 *
 * 기상청 API 는 발표시각도 예보시각도 전부 한국시각으로 말한다. 그런데
 * getHours() 같은 것은 서버가 선 시간대를 따른다 — 내 컴퓨터에서는 KST 라
 * 맞아떨어지지만 Vercel 은 UTC 라 9시간 어긋난 예보를 가져왔다. 오후 21℃ 자리에
 * 새벽 11℃ 가 들어오는 식이다. 여름이면 25℃ 경계를 넘나들어 제한시간이
 * 90분/120분으로 뒤바뀐다.
 *
 * 그래서 시각 계산은 전부 아래 함수로만 한다. 한국은 서머타임이 없어서
 * 고정 +9시간으로 충분하다.
 * ======================================================================== */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const p2 = (n: number) => String(n).padStart(2, '0');

/** epoch → 한국시각의 연·월·일·시·분 */
export function kstParts(at: number) {
  const d = new Date(at + KST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** epoch → 'YYYYMMDD' (한국시각) */
export function kstYmd(at: number) {
  const p = kstParts(at);
  return `${p.year}${p2(p.month)}${p2(p.day)}`;
}

/** epoch → 'HHMM' (한국시각) */
export function kstHhmm(at: number) {
  const p = kstParts(at);
  return `${p2(p.hour)}${p2(p.minute)}`;
}

/** 한국시각 벽시계('YYYYMMDD', 시) → epoch */
export function kstEpoch(ymd: string, hour: number) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return Date.UTC(y, m - 1, d, hour) - KST_OFFSET_MS;
}

/** 단기예보 발표 시각 — 하루 8회 (한국시각) */
export const BASE_TIMES = ['2300', '2000', '1700', '1400', '1100', '0800', '0500', '0200'];

/** [가정] 발표 후 값이 올라오기까지 두는 여유 */
const BASE_LAG_MIN = 45;

/** 지금 쓸 수 있는 가장 최근 발표분. 02시 이전이면 어제 23시 발표분을 쓴다. */
export function latestBase(now: number): { baseDate: string; baseTime: string } {
  const t = now - BASE_LAG_MIN * 60_000;
  const hhmm = kstHhmm(t);
  const found = BASE_TIMES.find((x) => x <= hhmm);
  if (found) return { baseDate: kstYmd(t), baseTime: found };
  return { baseDate: kstYmd(t - 24 * 3600_000), baseTime: '2300' };
}

/** [가정] 서울 월평균기온 평년값 근사(℃)와 일교차의 절반. 오후 3시가 최고. */
const MONTHLY_MEAN = [-2.0, 0.6, 5.8, 12.4, 17.8, 22.2, 25.0, 25.7, 21.3, 14.6, 7.0, 0.2];
const DAILY_AMPLITUDE = 4.5;

export function approximateTemperature(at: LatLng, when: number): Temperature {
  // 평년값이 한국 기준이므로 시각도 한국시각이라야 한다.
  // 서버에서 부를 때(UTC)와 브라우저에서 부를 때(KST) 값이 달라지면 안 된다.
  const k = kstParts(when);
  const h = k.hour + k.minute / 60;
  const local = (hash01(`${at.lat.toFixed(2)},${at.lng.toFixed(2)}`) - 0.5) * 1.0;
  const tempC = round1(
    MONTHLY_MEAN[k.month - 1] + DAILY_AMPLITUDE * Math.cos(((h - 15) / 24) * 2 * Math.PI) + local,
  );
  return { tempC, at: when, source: 'approx' };
}

export async function getTemperature(at: LatLng, when: number = Date.now()): Promise<Temperature> {
  try {
    const params = new URLSearchParams({
      lat: String(at.lat),
      lng: String(at.lng),
      at: String(when),
    });
    const res = await fetch(`/api/weather?${params}`);
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Temperature;
  } catch {
    return approximateTemperature(at, when);
  }
}
