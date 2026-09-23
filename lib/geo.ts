import type { LatLng } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;

/** 두 지점 사이 직선거리 km */
export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 문자열 → 0~1 난수. 같은 입력이면 항상 같은 값 (시연 결과가 흔들리지 않게) */
export function hash01(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 경로를 누적 길이로 보고 비율 f (0~1) 지점의 좌표 */
export function alongPath(path: [number, number][], f: number): LatLng & { index: number } {
  if (path.length === 0) return { lat: 0, lng: 0, index: 0 };
  if (path.length === 1) return { lat: path[0][0], lng: path[0][1], index: 0 };

  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    // 위도 1도와 경도 1도의 실제 길이가 달라 경도에 0.8을 곱해 보정
    const len = Math.hypot(path[i][0] - path[i - 1][0], (path[i][1] - path[i - 1][1]) * 0.8);
    segs.push(len);
    total += len;
  }

  let target = clamp(f, 0, 1) * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? clamp(target / segs[i], 0, 1) : 1;
      const [a1, o1] = path[i];
      const [a2, o2] = path[i + 1];
      return { lat: a1 + (a2 - a1) * t, lng: o1 + (o2 - o1) * t, index: i };
    }
    target -= segs[i];
  }

  const last = path[path.length - 1];
  return { lat: last[0], lng: last[1], index: path.length - 2 };
}

/** 직선을 약간 휘게 만든 경로 — 실제 길찾기가 없을 때 지도 표시·위치 보간용 */
export function approximatePath(from: LatLng, to: LatLng): [number, number][] {
  const seed = hash01(`${from.lat},${from.lng}>${to.lat},${to.lng}`);
  const bend = (seed - 0.5) * 0.3;
  const wiggle = (hash01(String(seed)) - 0.5) * 0.12;
  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const off = Math.sin(Math.PI * t) * bend + Math.sin(2 * Math.PI * t) * wiggle;
    pts.push([from.lat + dLat * t + dLng * off * 0.8, from.lng + dLng * t - dLat * off * 1.2]);
  }
  return pts;
}

/** Google encoded polyline 해독 */
export function decodePolyline(str: string, factor = 1e5): [number, number][] {
  const pts: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let r = 0;
    let s = 0;
    let b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << s;
      s += 5;
    } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    pts.push([lat / factor, lng / factor]);
  }
  return pts;
}
