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

/** [가정] 서울 월평균기온 평년값 근사(℃)와 일교차의 절반. 오후 3시가 최고. */
const MONTHLY_MEAN = [-2.0, 0.6, 5.8, 12.4, 17.8, 22.2, 25.0, 25.7, 21.3, 14.6, 7.0, 0.2];
const DAILY_AMPLITUDE = 4.5;

export function approximateTemperature(at: LatLng, when: number): Temperature {
  const d = new Date(when);
  const h = d.getHours() + d.getMinutes() / 60;
  const local = (hash01(`${at.lat.toFixed(2)},${at.lng.toFixed(2)}`) - 0.5) * 1.0;
  const tempC = round1(
    MONTHLY_MEAN[d.getMonth()] + DAILY_AMPLITUDE * Math.cos(((h - 15) / 24) * 2 * Math.PI) + local,
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
