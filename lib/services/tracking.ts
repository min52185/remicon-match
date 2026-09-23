/**
 * 차량 위치 추적.
 *
 * 두 가지 모드가 있고 화면 코드는 구분하지 않는다.
 *  · 실제 GPS  — 기사 휴대폰이 truck_locations 에 올린 마지막 좌표를 쓴다 (app/driver)
 *  · 가짜 차량 — 기사 폰 없이 시연할 때. 경로 위를 교통 흐름 곡선대로 움직인다.
 *
 * 가짜 차량은 "계획대로 일정하게" 움직이지 않는다. 그러면 지연 예측을 보여 줄 수 없다.
 * 차마다 결정적 난수로 속도 곡선을 만들어, 어떤 차는 늦고 어떤 차는 일찍 오게 한다.
 */

import { alongPath, clamp, hash01 } from '../geo';
import { MIN } from '../rules';
import type { Delivery, TruckLocation } from '../types';

export interface Position {
  lat: number;
  lng: number;
  /** 경로 진행률 0~1 */
  progress: number;
  /** 지금 다시 계산한 도착 예상 */
  etaAt: number;
  at: number;
  source: 'gps' | 'sim';
  /** 최근 속도 km/h (있을 때) */
  speedKmh?: number;
}

/**
 * [가정] 교통 흐름 목업.
 *   상대 속도 r(τ) = 1 + bias + a1·sin(…) + a2·sin(…) − (정체 구간이면 drop)
 *   bias ±15%  전체적으로 계획보다 빠름/느림
 *   a1·a2      흐름의 출렁임
 *   정체       60% 확률로 운반 중간쯤 2~6분 동안 속도가 45%p 떨어진다
 *   최저 0.12배라 아주 멈추지는 않는다.
 */
interface Profile {
  bias: number;
  a1: number;
  p1: number;
  f1: number;
  a2: number;
  p2: number;
  f2: number;
  jam: { at: number; len: number; drop: number } | null;
}

function profile(seed: string, travelMin: number): Profile {
  const h = (k: string) => hash01(`${seed}#${k}`);
  return {
    bias: (h('b') - 0.5) * 0.3,
    a1: 0.1 + h('a') * 0.1,
    p1: 6 + h('p') * 8,
    f1: h('f') * 2 * Math.PI,
    a2: 0.08,
    p2: 2.5 + h('q') * 2,
    f2: h('g') * 2 * Math.PI,
    jam: h('j') < 0.6 ? { at: travelMin * (0.25 + h('k') * 0.3), len: 2 + h('l') * 4, drop: 0.45 } : null,
  };
}

/** F(τ) = ∫r — "계획 기준으로 몇 분어치 진행했는가" */
function progressMin(pf: Profile, tau: number) {
  const w1 = (2 * Math.PI) / pf.p1;
  const w2 = (2 * Math.PI) / pf.p2;
  let f =
    (1 + pf.bias) * tau +
    (pf.a1 / w1) * (Math.cos(pf.f1) - Math.cos(w1 * tau + pf.f1)) +
    (pf.a2 / w2) * (Math.cos(pf.f2) - Math.cos(w2 * tau + pf.f2));
  if (pf.jam) f -= pf.jam.drop * clamp(tau - pf.jam.at, 0, pf.jam.len);
  return f;
}

/** 속도 곡선대로 달렸을 때 계획 T분어치를 다 가는 데 실제로 걸리는 분 */
function actualMinutes(pf: Profile, T: number) {
  let lo = 0;
  let hi = T * 4 + 10;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (progressMin(pf, mid) < T) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** 출하 시점에 "실제" 도착 시각을 정한다 (가짜 차량 전용) */
export function simulatedArrivalAt(seed: string, departAt: number, travelMinutes: number) {
  return departAt + Math.round(actualMinutes(profile(seed, travelMinutes), travelMinutes) * MIN);
}

/** 가짜 차량의 지금 위치와 다시 계산한 ETA */
export function simulatedPosition(d: Delivery, now: number): Position {
  const T = d.travelMinutes;
  const pf = profile(d.simSeed ?? d.id, T);
  const arriveAt = d.arriveAt ?? simulatedArrivalAt(d.simSeed ?? d.id, d.departAt, T);

  let progress: number;
  let etaAt: number;

  if (now <= d.departAt) {
    progress = 0;
    etaAt = d.etaInitialAt;
  } else if (now >= arriveAt) {
    progress = 1;
    etaAt = arriveAt;
  } else {
    const tau = (now - d.departAt) / MIN;
    const done = progressMin(pf, tau);
    // 최근 4분 평균 속도로 남은 시간을 추정한다 (지시서 7장 1단계와 같은 생각)
    const w = Math.min(tau, 4);
    const rate = w > 0.2 ? (done - progressMin(pf, tau - w)) / w : 1 + pf.bias;
    progress = clamp(done / T, 0, 1);
    etaAt = Math.max(now, now + ((T - done) / Math.max(rate, 0.3)) * MIN);
  }

  const at = alongPath(d.path, progress);
  return { lat: at.lat, lng: at.lng, progress, etaAt, at: now, source: 'sim' };
}

/**
 * 실제 GPS 기록에서 위치와 ETA를 낸다.
 * 남은 경로 비율을 최근 속도로 나누어 ETA를 다시 계산한다.
 * TODO(지시서 7장 3단계): 실제 도착 − API 예상의 오차가 쌓이면 학습 보정을 여기에 끼운다.
 */
export function positionFromGps(
  d: Delivery,
  locations: TruckLocation[],
  now: number,
): Position | null {
  const mine = locations.filter((l) => l.deliveryId === d.id).sort((a, b) => a.recordedAt - b.recordedAt);
  const last = mine[mine.length - 1];
  if (!last) return null;

  const progress = nearestProgress(d.path, last.lat, last.lng);
  const elapsedMin = (last.recordedAt - d.departAt) / MIN;
  // 실제로 진행한 비율 ÷ 계획대로라면 진행했을 비율 = 상대 속도
  const plannedProgress = clamp(elapsedMin / Math.max(d.travelMinutes, 0.1), 0, 1);
  const rate = plannedProgress > 0.05 ? clamp(progress / plannedProgress, 0.3, 3) : 1;
  const remainMin = ((1 - progress) * d.travelMinutes) / rate;

  return {
    lat: last.lat,
    lng: last.lng,
    progress,
    etaAt: Math.max(now, last.recordedAt + remainMin * MIN),
    at: last.recordedAt,
    source: 'gps',
    speedKmh: last.speedKmh,
  };
}

/** 좌표가 경로의 어디쯤인지 (0~1) — 가장 가까운 꼭짓점 기준 */
function nearestProgress(path: [number, number][], lat: number, lng: number) {
  if (path.length < 2) return 0;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - lat, (path[i][1] - lng) * 0.8);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI / (path.length - 1);
}

/** 화면이 쓰는 단일 진입점 — GPS 기록이 있으면 그것을, 없으면 가짜 차량을 쓴다 */
export function getPosition(d: Delivery, locations: TruckLocation[], now: number): Position {
  return positionFromGps(d, locations, now) ?? simulatedPosition(d, now);
}
