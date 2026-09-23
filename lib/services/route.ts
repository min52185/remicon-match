/**
 * 이동시간·추천 경로.
 *
 * 화면은 이 함수만 부른다. 내부는 서버(app/api/route)를 거쳐 카카오모빌리티를 호출하고,
 * 키가 없거나 호출이 실패하면 직선거리 근사로 떨어진다. 반환 형태는 어느 쪽이든 같다.
 *
 * TODO(지시서 5단계): 미래 운행 정보 길찾기(future-directions)로 "그 시각에 출발하면 몇 분"을
 *   받아 오면 AI 배분의 이동시간이 훨씬 정확해진다. departAt 을 그대로 넘기면 된다.
 */

import { approximatePath, haversineKm, round1 } from '../geo';
import { TRUCK_FACTOR } from '../rules';
import type { LatLng } from '../types';

export interface RouteResult {
  minutes: number;
  distanceKm: number;
  path: [number, number][];
  /** 'kakao' | 'approx' — 화면에 출처를 표시해 가정치를 숨기지 않는다 */
  source: 'kakao' | 'approx';
  /** 막히는 구간 설명 — 예: "영동고속 정체" */
  delayReason?: string;
}

/** [가정] 직선거리 → 도로거리 보정 */
const ROAD_FACTOR = 1.35;
/** [가정] 믹서트럭 평균 주행속도 (시내·국도 혼합) */
const TRUCK_KMH = 35;
/** [가정] 공장 출구·현장 진입에 드는 고정 시간 */
const FIXED_MIN = 3;

/** [가정] 시간대별 속도 배율 — 출퇴근 혼잡 0.75, 심야 1.2 */
function trafficFactor(hour: number) {
  if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 19)) return 0.75;
  if (hour >= 22 || hour < 6) return 1.2;
  return 1;
}

/** 키가 없을 때 쓰는 근사 — 실제 도로를 모르므로 직선거리에 보정계수를 곱한다 */
export function approximateRoute(from: LatLng, to: LatLng, departAt: number): RouteResult {
  const roadKm = haversineKm(from, to) * ROAD_FACTOR;
  const kmh = TRUCK_KMH * trafficFactor(new Date(departAt).getHours());
  return {
    minutes: Math.round((roadKm / kmh) * 60 + FIXED_MIN),
    distanceKm: round1(roadKm),
    path: approximatePath(from, to),
    source: 'approx',
  };
}

const cache = new Map<string, { at: number; value: RouteResult }>();
/** 같은 구간은 1분 캐시 — 카카오 무료 제공량을 아낀다 */
const CACHE_MS = 60_000;

export async function getRoute(
  from: LatLng,
  to: LatLng,
  departAt: number = Date.now(),
): Promise<RouteResult> {
  const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: RouteResult;
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, departAt }),
    });
    if (!res.ok) throw new Error(String(res.status));
    value = (await res.json()) as RouteResult;
  } catch {
    value = approximateRoute(from, to, departAt);
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

/** 여러 공장 → 한 현장. AI 배분에서 후보 공장의 이동시간을 한 번에 구한다. */
export async function getRoutesToSite(
  origins: (LatLng & { id: string })[],
  destination: LatLng,
  departAt: number = Date.now(),
): Promise<Map<string, RouteResult>> {
  const entries = await Promise.all(
    origins.map(async (o) => [o.id, await getRoute(o, destination, departAt)] as const),
  );
  return new Map(entries);
}

/** 승용차 기준 분 → 믹서트럭 보정 */
export const toTruckMinutes = (carMinutes: number) => Math.round(carMinutes * TRUCK_FACTOR);
