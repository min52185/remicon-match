/**
 * 긴급 매칭 — 지금 가장 빨리 올 수 있는 공장 하나.
 *
 * 도착 예상 = 지금 + 상차 준비시간 + 이동시간.
 * 가까운 공장이 늘 빠른 것이 아니다. 준비시간이 공장마다 다르기 때문이다.
 */

import { describe, expect, it } from 'vitest';
import { matchFastest, type MatchInput, type MatchRoute } from '../lib/ai/match';
import { MIN } from '../lib/rules';
import type { Plant, Spec } from '../lib/types';

/** 2026-09-29(화) 10:00 — 8·5제 한가운데 */
const NOW = new Date(2026, 8, 29, 10, 0, 0).getTime();

const SPEC: Spec = {
  type: '보통',
  aggMm: 25,
  strength: 24,
  slumpKind: 'slump',
  slumpMm: 150,
  cement: '보통 포틀랜드 시멘트 (1종)',
};

const plant = (p: Partial<Plant> & { id: string; prepMinutes: number }): Plant => ({
  name: `${p.id}공장`,
  address: '경기',
  phone: '031-000-0000',
  lat: 37.2,
  lng: 127.1,
  fleetSize: 10,
  availableTrucks: 5,
  availableVolume: 200,
  hourlyRate: 4,
  isOpen: true,
  cap: { maxStrength: { 보통: 35 }, aggs: [25], flow: false, cements: [SPEC.cement] },
  ...p,
});

const route = (minutes: number): MatchRoute => ({
  minutes,
  distanceKm: minutes / 2,
  source: 'kakao',
});

const run = (plants: Plant[], routes: Record<string, number>, over: Partial<MatchInput> = {}) =>
  matchFastest({
    now: NOW,
    plants,
    routes: new Map(Object.entries(routes).map(([k, v]) => [k, route(v)])),
    spec: SPEC,
    volumeM3: 6,
    tempC: 20,
    ...over,
  });

/* ========================================================================== */

describe('matchFastest — 준비시간까지 더해서 고른다', () => {
  it('가까운 공장이 늘 빠른 것은 아니다', () => {
    // A: 15분 거리인데 준비 20분 → 35분
    // B: 25분 거리인데 준비 5분  → 30분  ← 이쪽이 빠르다
    const r = run(
      [plant({ id: 'A', prepMinutes: 20 }), plant({ id: 'B', prepMinutes: 5 })],
      { A: 15, B: 25 },
    );
    expect(r.best?.plant.id).toBe('B');
    expect(r.best?.etaMinutes).toBe(30);
  });

  it('도착 예상 시각을 알려 준다', () => {
    const r = run([plant({ id: 'A', prepMinutes: 10 })], { A: 20 });
    expect(r.best?.arriveAt).toBe(NOW + 30 * MIN);
  });

  it('보낼 수 있는 공장을 빠른 순으로 준다', () => {
    const r = run(
      [
        plant({ id: 'A', prepMinutes: 10 }),
        plant({ id: 'B', prepMinutes: 10 }),
        plant({ id: 'C', prepMinutes: 10 }),
      ],
      { A: 30, B: 10, C: 20 },
    );
    expect(r.usable.map((c) => c.plant.id)).toEqual(['B', 'C', 'A']);
  });
});

describe('matchFastest — 빠르다고 아무 데나 보내지 않는다', () => {
  it('출하를 멈춘 공장은 뺀다', () => {
    const r = run(
      [plant({ id: 'stop', prepMinutes: 5, isOpen: false }), plant({ id: 'ok', prepMinutes: 20 })],
      { stop: 5, ok: 20 },
    );
    expect(r.best?.plant.id).toBe('ok');
    expect(r.blocked.find((c) => c.plant.id === 'stop')?.reason).toBe('출하 중지');
  });

  it('사양을 못 만드는 공장은 뺀다', () => {
    const weak = plant({
      id: 'weak',
      prepMinutes: 1,
      cap: { maxStrength: { 보통: 18 }, aggs: [25], flow: false, cements: [SPEC.cement] },
    });
    const r = run([weak, plant({ id: 'ok', prepMinutes: 20 })], { weak: 1, ok: 20 });
    expect(r.best?.plant.id).toBe('ok');
    expect(r.blocked[0].reason).toContain('24MPa');
  });

  it('차량이나 물량이 없는 공장은 뺀다', () => {
    const empty = plant({ id: 'empty', prepMinutes: 1, availableTrucks: 0, availableVolume: 0 });
    const r = run([empty, plant({ id: 'ok', prepMinutes: 20 })], { empty: 1, ok: 20 });
    expect(r.best?.plant.id).toBe('ok');
    expect(r.blocked[0].reason).toBe('출하 여력 없음');
  });

  it('허용 이동시간을 넘으면 뺀다 — 도착해도 못 붓는다', () => {
    // 20℃ → 제한 120분, 허용 이동 = 120 − 10 − 20 − 10 = 80분
    const r = run([plant({ id: 'far', prepMinutes: 5 })], { far: 90 });
    expect(r.allowedTravelMinutes).toBe(80);
    expect(r.best).toBeNull();
    expect(r.blocked[0].reason).toContain('제한시간 내 도착 불가');
  });

  it('더운 날은 허용 이동시간이 줄어 같은 공장이 걸린다', () => {
    const plants = [plant({ id: 'p', prepMinutes: 5 })];
    // 20℃: 허용 80분 → 통과
    expect(run(plants, { p: 55 }, { tempC: 20 }).best?.plant.id).toBe('p');
    // 30℃: 제한 90분 → 허용 50분 → 걸림
    const hot = run(plants, { p: 55 }, { tempC: 30 });
    expect(hot.allowedTravelMinutes).toBe(50);
    expect(hot.best).toBeNull();
  });

  it('8·5제 밖이면 뺀다 — 기사가 퇴근한다', () => {
    const late = new Date(2026, 8, 29, 16, 30, 0).getTime();
    const r = run([plant({ id: 'p', prepMinutes: 10 })], { p: 40 }, { now: late });
    // 16:30 + 10 + 40 = 17:20 도착, 하역까지 17:40 → 17시를 넘는다
    expect(r.best).toBeNull();
    expect(r.blocked[0].reason).toBe('8·5제 근무시간 밖');
  });

  it('이동시간을 아직 모르면 후보로 안 쓴다', () => {
    const r = run([plant({ id: 'a', prepMinutes: 5 }), plant({ id: 'b', prepMinutes: 5 })], { b: 20 });
    expect(r.best?.plant.id).toBe('b');
    expect(r.blocked[0].reason).toBe('이동시간 계산 중');
  });
});

describe('matchFastest — 안 될 때 이유를 모아 준다', () => {
  it('이유별로 몇 곳인지 센다', () => {
    const r = run(
      [
        plant({ id: 's1', prepMinutes: 5, isOpen: false }),
        plant({ id: 's2', prepMinutes: 5, isOpen: false }),
        plant({ id: 'e1', prepMinutes: 5, availableTrucks: 0, availableVolume: 0 }),
      ],
      { s1: 10, s2: 10, e1: 10 },
    );
    expect(r.best).toBeNull();
    expect(r.reasons).toEqual([
      { reason: '출하 중지', count: 2 },
      { reason: '출하 여력 없음', count: 1 },
    ]);
  });

  it('공장이 하나도 없으면 빈 결과다', () => {
    const r = run([], {});
    expect(r.best).toBeNull();
    expect(r.usable).toEqual([]);
    expect(r.reasons).toEqual([]);
  });
});

describe('matchFastest — 물량이 빠듯해도 막지는 않는다', () => {
  it('긴급에서는 한 대라도 받는 편이 낫다', () => {
    const tight = plant({ id: 'tight', prepMinutes: 5, availableVolume: 3 });
    const r = run([tight], { tight: 20 }, { volumeM3: 6 });
    expect(r.best?.plant.id).toBe('tight');
    expect(r.best?.level).toBe('warn');
    expect(r.best?.reason).toContain('물량 부족');
  });
});
