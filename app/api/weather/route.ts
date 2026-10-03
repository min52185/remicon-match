/**
 * 기상청 단기예보 프록시 — 외기온도로 90분/120분 제한을 고른다.
 *
 * 인증키는 서버에서만 쓴다. 키가 없거나 예보 범위(약 3일)를 넘으면 평년값 근사로 떨어진다.
 * 공공데이터포털 "기상청_단기예보 조회서비스" getVilageFcst, 항목 TMP(1시간 기온).
 */

import { NextResponse } from 'next/server';
import {
  approximateTemperature,
  kstEpoch,
  kstParts,
  kstYmd,
  latestBase,
  type Temperature,
} from '@/lib/services/weather';

const ENDPOINT =
  'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const at = Number(url.searchParams.get('at')) || Date.now();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat·lng 가 필요합니다' }, { status: 400 });
  }

  const key = process.env.KMA_SERVICE_KEY;
  if (!key) return NextResponse.json(approximateTemperature({ lat, lng }, at));

  try {
    const temp = await fetchKma(key, lat, lng, at);
    return NextResponse.json(temp);
  } catch (err) {
    console.warn('[api/weather] 기상청 조회 실패 — 평년값 근사로 대체합니다.', err);
    return NextResponse.json(approximateTemperature({ lat, lng }, at));
  }
}

interface KmaItem {
  category: string;
  fcstDate: string;
  fcstTime: string;
  fcstValue: string;
}

async function fetchKma(key: string, lat: number, lng: number, at: number): Promise<Temperature> {
  const { nx, ny } = toGrid(lat, lng);
  const { baseDate, baseTime } = latestBase(Date.now());

  const params = new URLSearchParams({
    serviceKey: key,
    numOfRows: '1000',
    pageNo: '1',
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  });

  const res = await fetch(`${ENDPOINT}?${params}`, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`기상청 응답 ${res.status}`);

  const json = (await res.json()) as {
    response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: KmaItem[] } } };
  };

  const code = json.response?.header?.resultCode;
  if (code && code !== '00') throw new Error(json.response?.header?.resultMsg ?? `resultCode ${code}`);

  const items = (json.response?.body?.items?.item ?? []).filter((i) => i.category === 'TMP');
  if (items.length === 0) throw new Error('TMP 항목 없음');

  // 타설 시각에 가장 가까운 예보를 고른다. 기상청이 한국시각으로 말하므로
  // 찾는 날짜·시각도 한국시각이라야 한다 (서버가 UTC 여도).
  const wanted = kstYmd(at);
  const wantedHour = `${p2(kstParts(at).hour)}00`;

  const exact = items.find((i) => i.fcstDate === wanted && i.fcstTime === wantedHour);
  const chosen = exact ?? nearest(items, at);
  if (!chosen) throw new Error('해당 시각 예보 없음');

  const tempC = Number(chosen.fcstValue);
  if (!Number.isFinite(tempC)) throw new Error('기온 값 파싱 실패');

  return { tempC, at, source: 'kma' };
}

function nearest(items: KmaItem[], at: number) {
  let best: KmaItem | undefined;
  let bestDiff = Infinity;
  for (const i of items) {
    const t = parseFcst(i);
    const diff = Math.abs(t - at);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

/** 예보 한 줄의 시각(한국시각)을 epoch 으로 */
const parseFcst = (i: KmaItem) => kstEpoch(i.fcstDate, Number(i.fcstTime.slice(0, 2)));

const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * 위경도 → 기상청 격자(nx, ny). 람베르트 정각원추도법.
 * 기상청이 공개한 변환식(dfs_xy_conv)을 그대로 옮긴 것이다.
 */
function toGrid(lat: number, lng: number) {
  const RE = 6371.00877; // 지구 반경(km)
  const GRID = 5.0; // 격자 간격(km)
  const SLAT1 = 30.0; // 표준 위도 1
  const SLAT2 = 60.0; // 표준 위도 2
  const OLON = 126.0; // 기준점 경도
  const OLAT = 38.0; // 기준점 위도
  const XO = 43; // 기준점 X좌표
  const YO = 136; // 기준점 Y좌표

  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn =
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}
