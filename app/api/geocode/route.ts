/**
 * 카카오 로컬 검색 프록시 — 주소·장소 이름으로 좌표를 찾는다.
 *
 * 현장·공장을 등록할 때 쓴다. 위도·경도를 사람에게 물어볼 수는 없으니
 * "경기 용인시 기흥구 서천동" 이나 "○○아파트 신축현장" 으로 찾게 한다.
 *
 * REST 키는 서버에서만 쓴다 (CLAUDE.md: REST 키는 app/api 안에서만).
 * 키가 없으면 빈 목록과 이유를 돌려준다 — 화면은 "지도에서 직접 찍기" 로 넘어간다.
 *
 * 카카오 로컬은 두 가지를 따로 찾는다.
 *   주소 검색   정확한 지번·도로명 주소
 *   키워드 검색 상호·건물 이름 ("판교 테크노밸리")
 * 현장 이름으로 찾는 경우가 많아 둘 다 부르고 주소 결과를 앞에 둔다.
 */

import { NextResponse } from 'next/server';

const ADDRESS = 'https://dapi.kakao.com/v2/local/search/address.json';
const KEYWORD = 'https://dapi.kakao.com/v2/local/search/keyword.json';

/** 한 번에 돌려줄 최대 개수 — 목록이 길면 고르기 어렵다 */
const LIMIT = 8;

export interface GeocodeHit {
  /** 화면에 굵게 보여 줄 이름 */
  title: string;
  /** 그 아래 작게 — 도로명 또는 지번 주소 */
  address: string;
  lat: number;
  lng: number;
  source: 'address' | 'keyword';
}

export interface GeocodeResponse {
  hits: GeocodeHit[];
  /** 키가 없거나 호출이 실패한 이유 — 화면에 그대로 띄운다 */
  note?: string;
}

interface KakaoAddressDoc {
  address_name?: string;
  x?: string;
  y?: string;
  road_address?: { address_name?: string; building_name?: string } | null;
  address?: { address_name?: string } | null;
}

interface KakaoKeywordDoc {
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
}

const num = (v: string | undefined) => (v == null ? NaN : Number(v));

async function call(url: string, key: string, query: string) {
  const res = await fetch(`${url}?query=${encodeURIComponent(query)}&size=${LIMIT}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    // 주소는 잘 바뀌지 않는다 — 같은 검색을 반복해도 카카오를 다시 부르지 않게
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`카카오 로컬 ${res.status}`);
  return res.json() as Promise<{ documents?: unknown[] }>;
}

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams.get('q')?.trim() ?? '';

  if (query.length < 2) {
    return NextResponse.json<GeocodeResponse>({ hits: [], note: '두 글자 이상 입력하세요.' });
  }

  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    return NextResponse.json<GeocodeResponse>({
      hits: [],
      note: '카카오 REST 키가 없어 주소를 찾을 수 없습니다. 지도에서 직접 찍어 주세요.',
    });
  }

  try {
    // 하나가 실패해도 다른 쪽 결과는 쓴다
    const [addrRes, kwRes] = await Promise.allSettled([
      call(ADDRESS, key, query),
      call(KEYWORD, key, query),
    ]);

    const hits: GeocodeHit[] = [];

    if (addrRes.status === 'fulfilled') {
      for (const raw of (addrRes.value.documents ?? []) as KakaoAddressDoc[]) {
        const lat = num(raw.y);
        const lng = num(raw.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const road = raw.road_address?.address_name;
        hits.push({
          title: raw.road_address?.building_name || road || raw.address_name || query,
          address: raw.address?.address_name || raw.address_name || road || '',
          lat,
          lng,
          source: 'address',
        });
      }
    }

    if (kwRes.status === 'fulfilled') {
      for (const raw of (kwRes.value.documents ?? []) as KakaoKeywordDoc[]) {
        const lat = num(raw.y);
        const lng = num(raw.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        hits.push({
          title: raw.place_name || query,
          address: raw.road_address_name || raw.address_name || '',
          lat,
          lng,
          source: 'keyword',
        });
      }
    }

    if (hits.length === 0) {
      const why =
        addrRes.status === 'rejected' && kwRes.status === 'rejected'
          ? '주소 검색에 실패했습니다. 지도에서 직접 찍어 주세요.'
          : '찾는 곳이 없습니다. 더 짧게 적거나 지도에서 직접 찍어 주세요.';
      return NextResponse.json<GeocodeResponse>({ hits: [], note: why });
    }

    // 좌표가 같은 곳이 주소·키워드 양쪽에서 나온다 — 앞의 것만 남긴다
    const seen = new Set<string>();
    const unique = hits.filter((h) => {
      const k = `${h.lat.toFixed(5)},${h.lng.toFixed(5)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return NextResponse.json<GeocodeResponse>({ hits: unique.slice(0, LIMIT) });
  } catch (e) {
    return NextResponse.json<GeocodeResponse>({
      hits: [],
      note: `주소를 찾지 못했습니다 (${e instanceof Error ? e.message : '알 수 없는 오류'}). 지도에서 직접 찍어 주세요.`,
    });
  }
}
