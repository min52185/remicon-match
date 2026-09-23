/**
 * AI 배분 — 지시서 6장.
 *
 * 계산 자체는 lib/ai/allocate.ts 의 순수 함수라 브라우저에서도 돌지만, 서버에 두는 이유가 있다.
 *  · 이동시간을 카카오 '미래 운행 정보'로 받아야 하는데 REST 키는 서버에서만 쓸 수 있다
 *  · 나중에 학습 보정 계수를 DB에서 읽어 와 적용할 자리가 필요하다
 *
 * 요청에 travelMinutes 가 이미 들어 있으면 그대로 쓰고, 없으면 여기서 길찾기를 부른다.
 */

import { NextResponse } from 'next/server';
import { allocate, simulateNaive, type AllocationInput, type AllocationPlantInput } from '@/lib/ai/allocate';
import { approximateRoute } from '@/lib/services/route';
import type { LatLng } from '@/lib/types';

interface RequestPlant extends Omit<AllocationPlantInput, 'travelMinutes'> {
  travelMinutes?: number;
  lat?: number;
  lng?: number;
}

interface RequestBody extends Omit<AllocationInput, 'plants'> {
  plants: RequestPlant[];
  site?: LatLng;
  /** 단순 방식과 비교한 결과도 같이 받을지 */
  compare?: boolean;
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  if (!Array.isArray(body.plants) || body.plants.length === 0) {
    return NextResponse.json({ error: '공장 목록이 필요합니다' }, { status: 400 });
  }
  if (!(body.totalVolumeM3 > 0) || !(body.pumpRate > 0)) {
    return NextResponse.json({ error: '총 물량과 펌프 속도가 필요합니다' }, { status: 400 });
  }

  // 이동시간이 없는 공장은 여기서 채운다 (지시서 6장 계산 순서 2)
  const plants: AllocationPlantInput[] = await Promise.all(
    body.plants.map(async (p) => {
      if (Number.isFinite(p.travelMinutes)) {
        return { ...p, travelMinutes: p.travelMinutes! } as AllocationPlantInput;
      }
      const from = { lat: p.lat ?? 0, lng: p.lng ?? 0 };
      const minutes = await travelMinutes(from, body.site, body.pourStartAt);
      return { id: p.id, name: p.name, availableTrucks: p.availableTrucks, hourlyRate: p.hourlyRate, travelMinutes: minutes };
    }),
  );

  const input: AllocationInput = {
    totalVolumeM3: body.totalVolumeM3,
    pumpRate: body.pumpRate,
    pourStartAt: body.pourStartAt,
    tempC: body.tempC,
    truckCapacityM3: body.truckCapacityM3,
    settings: body.settings,
    plants,
  };

  const result = allocate(input);
  const naive = body.compare === false ? undefined : simulateNaive(input);

  return NextResponse.json({ result, naive });
}

async function travelMinutes(from: LatLng, site: LatLng | undefined, departAt: number) {
  if (!site) return Infinity;
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return approximateRoute(from, site, departAt).minutes;

  try {
    // 같은 오리진의 프록시를 재사용하지 않고 직접 부른다 (서버 내부 fetch 왕복을 줄인다)
    const { origin } = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000');
    const res = await fetch(`${origin}/api/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: site, departAt }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(String(res.status));
    const r = (await res.json()) as { minutes: number };
    return r.minutes;
  } catch {
    return approximateRoute(from, site, departAt).minutes;
  }
}
