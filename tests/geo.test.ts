/**
 * 경로 위의 한 점 — 네비게이션 화면이 기대는 계산.
 *
 * 기사 화면은 "지나온 길 / 남은 길 / 남은 거리 / 바라보는 방향"을 이 함수들로 낸다.
 * 여기가 틀리면 차는 가는데 화면은 안 가거나, 화살표가 반대를 가리킨다.
 */

import { describe, expect, it } from 'vitest';
import { alongPath, headingAt, remainingKm, splitPath } from '../lib/geo';

/** 북쪽으로 똑바로 올라가는 길 (경도 고정) */
const NORTH: [number, number][] = [
  [37.0, 127.0],
  [37.1, 127.0],
  [37.2, 127.0],
];

/** 동쪽으로 똑바로 가는 길 (위도 고정) */
const EAST: [number, number][] = [
  [37.0, 127.0],
  [37.0, 127.1],
];

describe('splitPath — 지나온 길과 남은 길', () => {
  it('자른 지점이 양쪽에 모두 들어가 선이 끊기지 않는다', () => {
    const { done, rest } = splitPath(NORTH, 0.5);
    expect(done[done.length - 1]).toEqual(rest[0]);
  });

  it('반쯤 왔으면 자른 지점이 길 가운데다', () => {
    const { done } = splitPath(NORTH, 0.5);
    const cut = done[done.length - 1];
    expect(cut[0]).toBeCloseTo(37.1, 5);
    expect(cut[1]).toBeCloseTo(127.0, 5);
  });

  it('출발 전이면 남은 길이 경로 전체이고 지나온 길은 점 하나다', () => {
    const { done, rest } = splitPath(NORTH, 0);
    expect(done).toHaveLength(1);
    expect(rest).toEqual(NORTH);
  });

  it('도착했으면 지나온 길이 경로 전체이고 남은 길은 점 하나다', () => {
    const { done, rest } = splitPath(NORTH, 1);
    expect(done).toEqual(NORTH);
    expect(rest).toHaveLength(1);
    expect(rest[0]).toEqual(NORTH[NORTH.length - 1]);
  });

  it('점이 하나뿐인 경로에서도 터지지 않는다', () => {
    const one: [number, number][] = [[37, 127]];
    expect(splitPath(one, 0.5)).toEqual({ done: one, rest: one });
    expect(splitPath([], 0.5)).toEqual({ done: [], rest: [] });
  });

  it('자른 지점은 alongPath 가 말하는 지점과 같다', () => {
    // 두 함수가 어긋나면 마커는 여기, 선은 저기에 그려진다
    for (const f of [0.1, 0.33, 0.7, 0.95]) {
      const at = alongPath(NORTH, f);
      const { done } = splitPath(NORTH, f);
      const cut = done[done.length - 1];
      expect(cut[0]).toBeCloseTo(at.lat, 10);
      expect(cut[1]).toBeCloseTo(at.lng, 10);
    }
  });
});

describe('headingAt — 바라보는 방향', () => {
  it('북쪽으로 가면 0도', () => {
    expect(headingAt(NORTH, 0.5)).toBeCloseTo(0, 5);
  });

  it('동쪽으로 가면 90도', () => {
    expect(headingAt(EAST, 0.5)).toBeCloseTo(90, 1);
  });

  it('남서쪽으로 가면 180~270도 사이다', () => {
    const sw: [number, number][] = [
      [37.2, 127.2],
      [37.0, 127.0],
    ];
    const deg = headingAt(sw, 0.5);
    expect(deg).toBeGreaterThan(180);
    expect(deg).toBeLessThan(270);
  });

  it('언제나 0 이상 360 미만이다 — CSS rotate 에 그대로 넣는다', () => {
    for (const path of [NORTH, EAST]) {
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const deg = headingAt(path, f);
        expect(deg).toBeGreaterThanOrEqual(0);
        expect(deg).toBeLessThan(360);
      }
    }
  });

  it('길이 없으면 0 — 화살표가 엉뚱한 데를 가리키느니 위를 본다', () => {
    expect(headingAt([], 0.5)).toBe(0);
    expect(headingAt([[37, 127]], 0.5)).toBe(0);
  });
});

describe('remainingKm — 남은 거리', () => {
  it('출발 전에는 경로 전체 길이다', () => {
    // 위도 0.2도 ≈ 22.2km
    expect(remainingKm(NORTH, 0)).toBeGreaterThan(21);
    expect(remainingKm(NORTH, 0)).toBeLessThan(23);
  });

  it('반쯤 왔으면 절반이 남는다', () => {
    const whole = remainingKm(NORTH, 0);
    const half = remainingKm(NORTH, 0.5);
    expect(half).toBeCloseTo(whole / 2, 0);
  });

  it('도착하면 0 이다', () => {
    expect(remainingKm(NORTH, 1)).toBe(0);
  });

  it('갈수록 줄어들기만 한다 — 남은 거리가 늘면 기사가 화면을 믿지 않는다', () => {
    let prev = Infinity;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const left = remainingKm(NORTH, Math.min(f, 1));
      expect(left).toBeLessThanOrEqual(prev + 1e-9);
      prev = left;
    }
  });
});
