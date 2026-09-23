/**
 * 카카오모빌리티 길찾기 프록시.
 *
 * REST 키는 브라우저에 노출되면 안 되므로 반드시 서버에서만 부른다 (지시서 3장 키 관리 규칙).
 * 키가 없거나 호출이 실패하면 직선거리 근사로 떨어진다 — 화면은 source 로 어느 쪽인지 안다.
 *
 * 출발 시각이 충분히 미래면 '미래 운행 정보 길찾기'를 쓴다. AI 배분이 "타설 시각에
 * 출발하면 몇 분 걸리는지"를 물어야 하기 때문이다 (지시서 6장 계산 순서 2).
 */

import { NextResponse } from 'next/server';
import { approximateRoute, type RouteResult } from '@/lib/services/route';
import { TRUCK_FACTOR } from '@/lib/rules';
import type { LatLng } from '@/lib/types';

const DIRECTIONS = 'https://apis-navi.kakaomobility.com/v1/directions';
const FUTURE_DIRECTIONS = 'https://apis-navi.kakaomobility.com/v1/future/directions';

/** 미래 운행 정보를 쓸 기준 — 출발이 이 분 이후면 미래 API */
const FUTURE_THRESHOLD_MIN = 20;

/** 카카오 traffic_state 코드 */
const TRAFFIC_LABEL: Record<number, string> = {
  1: '정체',
  2: '지체',
  3: '서행',
  4: '원활',
  6: '교통사고',
};

interface KakaoRoad {
  name?: string;
  distance?: number;
  duration?: number;
  traffic_state?: number;
  vertexes?: number[];
}

interface KakaoSection {
  roads?: KakaoRoad[];
}

interface KakaoRoute {
  result_code?: number;
  result_msg?: string;
  summary?: { distance?: number; duration?: number };
  sections?: KakaoSection[];
}

export async function POST(req: Request) {
  let body: { from?: LatLng; to?: LatLng; departAt?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { from, to } = body;
  const departAt = body.departAt ?? Date.now();

  if (!isLatLng(from) || !isLatLng(to)) {
    return NextResponse.json({ error: 'from·to 좌표가 필요합니다' }, { status: 400 });
  }

  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    // 키를 아직 안 넣은 단계에서도 앱 전체가 돌아가야 한다
    return NextResponse.json(approximateRoute(from, to, departAt));
  }

  try {
    const result = await callKakao(key, from, to, departAt);
    return NextResponse.json(result);
  } catch (err) {
    console.warn('[api/route] 카카오 길찾기 실패 — 근사로 대체합니다.', err);
    return NextResponse.json(approximateRoute(from, to, departAt));
  }
}

async function callKakao(
  key: string,
  from: LatLng,
  to: LatLng,
  departAt: number,
): Promise<RouteResult> {
  const minutesAhead = (departAt - Date.now()) / 60_000;
  const useFuture = minutesAhead >= FUTURE_THRESHOLD_MIN;

  const params = new URLSearchParams({
    origin: `${from.lng},${from.lat}`,
    destination: `${to.lng},${to.lat}`,
    priority: 'RECOMMEND',
    car_type: '7', // 대형화물차 — 믹서트럭에 가장 가깝다
    road_details: 'true',
  });
  if (useFuture) params.set('departure_time', kakaoTime(departAt));

  const url = `${useFuture ? FUTURE_DIRECTIONS : DIRECTIONS}?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
    // 길찾기 결과는 교통 상황에 따라 바뀌므로 캐시하지 않는다
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`카카오 응답 ${res.status}`);

  const json = (await res.json()) as { routes?: KakaoRoute[] };
  const route = json.routes?.[0];
  if (!route || (route.result_code != null && route.result_code !== 0)) {
    throw new Error(route?.result_msg ?? '경로 없음');
  }

  const carSeconds = route.summary?.duration ?? 0;
  const distanceM = route.summary?.distance ?? 0;
  if (!carSeconds) throw new Error('소요시간 없음');

  const roads = (route.sections ?? []).flatMap((s) => s.roads ?? []);

  return {
    // 승용차 기준 → 믹서트럭 보정 [가정]
    minutes: Math.round((carSeconds / 60) * TRUCK_FACTOR),
    distanceKm: Math.round((distanceM / 1000) * 10) / 10,
    path: pathOf(roads),
    source: 'kakao',
    delayReason: worstTraffic(roads),
  };
}

/** vertexes 는 [lng, lat, lng, lat, ...] 로 평평하게 온다 */
function pathOf(roads: KakaoRoad[]): [number, number][] {
  const path: [number, number][] = [];
  for (const road of roads) {
    const v = road.vertexes ?? [];
    for (let i = 0; i + 1 < v.length; i += 2) path.push([v[i + 1], v[i]]);
  }
  return path;
}

/**
 * 2단계 — 어디서 막히는지. 정체·지체 구간 중 가장 긴 도로를 지연 원인으로 표시한다.
 * 예: "영동고속도로 정체"
 */
function worstTraffic(roads: KakaoRoad[]): string | undefined {
  const jammed = roads
    .filter((r) => r.traffic_state === 1 || r.traffic_state === 2 || r.traffic_state === 6)
    .sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0));
  const worst = jammed[0];
  if (!worst?.name) return undefined;
  return `${worst.name} ${TRAFFIC_LABEL[worst.traffic_state!] ?? '지연'}`;
}

/** 카카오 departure_time 형식: YYYYMMDDHHMM (로컬 시각) */
function kakaoTime(at: number) {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function isLatLng(v: unknown): v is LatLng {
  const p = v as LatLng | undefined;
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}
