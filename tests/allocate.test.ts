/**
 * 지시서 6장 A~G 예시를 고정한다.
 * 회차 순서는 해가 여러 개라 달라도 되지만, 공장별 대수는 바뀌면 안 된다.
 */

import { describe, expect, it } from 'vitest';
import {
  allocate,
  intervalMinutes,
  simulateNaive,
  trucksNeeded,
  type AllocationInput,
} from '../lib/ai/allocate';
import { MIN, PourRules } from '../lib/rules';

/** 2026-09-23 09:00 (로컬) */
const POUR_START = new Date(2026, 8, 23, 9, 0, 0).getTime();

/** 지시서 6장 '예시 입력(가정)' — 공장당 이 현장에 시간당 최대 4대 */
const EXAMPLE: AllocationInput = {
  totalVolumeM3: 300,
  pumpRate: 60,
  pourStartAt: POUR_START,
  tempC: 28, // 25℃ 이상 → 제한 90분
  truckCapacityM3: 6,
  settings: { prepMinutes: 10, siteBufferMinutes: 20, safetyMarginMinutes: 10 },
  plants: [
    { id: 'A', name: 'A공장', availableTrucks: 5, hourlyRate: 4, travelMinutes: 15 },
    { id: 'B', name: 'B공장', availableTrucks: 4, hourlyRate: 4, travelMinutes: 20 },
    { id: 'C', name: 'C공장', availableTrucks: 10, hourlyRate: 4, travelMinutes: 25 },
    { id: 'D', name: 'D공장', availableTrucks: 5, hourlyRate: 4, travelMinutes: 30 },
    { id: 'E', name: 'E공장', availableTrucks: 12, hourlyRate: 4, travelMinutes: 35 },
    { id: 'F', name: 'F공장', availableTrucks: 20, hourlyRate: 4, travelMinutes: 45 },
    { id: 'G', name: 'G공장', availableTrucks: 25, hourlyRate: 4, travelMinutes: 60 },
  ],
};

const countsOf = (r: ReturnType<typeof allocate>) =>
  Object.fromEntries(r.items.map((i) => [i.plantId, i.trucks]));

describe('기본량 (지시서 6장 수식)', () => {
  it('N = ⌈300 / 6⌉ = 50대', () => {
    expect(trucksNeeded(300, 6)).toBe(50);
  });

  it('Δt = (6 / 60) × 60 = 6분', () => {
    expect(intervalMinutes(60, 6)).toBe(6);
  });

  it('T_허용 = 90 − 10 − 20 − 10 = 50분', () => {
    expect(
      PourRules.allowedTravelMinutes(28, {
        prepMinutes: 10,
        siteBufferMinutes: 20,
        safetyMarginMinutes: 10,
      }),
    ).toBe(50);
  });
});

describe('AI 배분 — A~G 예시', () => {
  const result = allocate(EXAMPLE);

  it('배분이 가능하다', () => {
    expect(result.feasible).toBe(true);
    expect(result.unassigned).toBe(0);
  });

  it('공장별 대수가 A5·B4·C10·D5·E12·F14·G0 이다', () => {
    expect(countsOf(result)).toEqual({ A: 5, B: 4, C: 10, D: 5, E: 12, F: 14 });
  });

  it('G공장은 허용 이동시간 초과로 제외된다', () => {
    const g = result.excluded.find((e) => e.plantId === 'G');
    expect(g).toBeDefined();
    expect(g!.reason).toContain('60분 > 허용 50분');
  });

  it('배정 대수 합이 필요 대수와 같다', () => {
    expect(result.items.reduce((s, i) => s + i.trucks, 0)).toBe(50);
  });

  it('이동시간 합(목적함수)이 1605분이다', () => {
    // 5·15 + 4·20 + 10·25 + 5·30 + 12·35 + 14·45
    expect(result.totalTravelMinutes).toBe(1605);
  });

  it('타설은 09:00 ~ 14:00 (300m³ ÷ 60m³/h = 5시간)', () => {
    expect(result.pourEndAt - result.pourStartAt).toBe(5 * 60 * MIN);
  });

  it('모든 회차가 정확히 한 번씩 배정된다 (제약 ①)', () => {
    const all = result.items.flatMap((i) => i.rounds).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 50 }, (_, k) => k));
  });

  it('공장별 배정 합이 출하 가능 대수를 넘지 않는다 (제약 ②)', () => {
    for (const item of result.items) {
      const plant = EXAMPLE.plants.find((p) => p.id === item.plantId)!;
      expect(item.trucks).toBeLessThanOrEqual(plant.availableTrucks);
    }
  });

  it('어느 60분 구간에서도 공장별 대수가 시간당 출하 능력을 넘지 않는다 (제약 ③)', () => {
    const windowSize = 60 / result.intervalMinutes; // 10회차
    for (const item of result.items) {
      const plant = EXAMPLE.plants.find((p) => p.id === item.plantId)!;
      for (let start = 0; start + windowSize <= 50; start++) {
        const inWindow = item.rounds.filter((r) => r >= start && r < start + windowSize).length;
        expect(inWindow).toBeLessThanOrEqual(plant.hourlyRate);
      }
    }
  });

  it('E·F를 첫 시간부터 섞어 쓴다 — 가까운 공장만 먼저 쓰지 않는다', () => {
    const firstHour = 10; // 60분 = 10회차
    const e = result.items.find((i) => i.plantId === 'E')!;
    const f = result.items.find((i) => i.plantId === 'F')!;
    expect(e.rounds.some((r) => r < firstHour)).toBe(true);
    expect(f.rounds.some((r) => r < firstHour)).toBe(true);
  });

  it('출하 시각 = 도착 − 이동 − 출하 준비', () => {
    const a = result.items.find((i) => i.plantId === 'A')!;
    expect(a.arriveAts[0] - a.mixStartAts[0]).toBe((15 + 10) * MIN);
  });
});

describe('비교 — 가까운 공장부터 채우는 단순 방식', () => {
  it('50대를 끝까지 채우지 못하고 중간에 끊긴다', () => {
    const naive = simulateNaive(EXAMPLE);
    expect(naive.brokeAtRound).not.toBeNull();
    expect(naive.filled).toBeLessThan(50);
  });

  it('AI 배분은 끊기지 않는다', () => {
    expect(allocate(EXAMPLE).feasible).toBe(true);
  });
});

describe('배분이 불가능할 때 대안을 낸다', () => {
  const tight: AllocationInput = {
    ...EXAMPLE,
    plants: EXAMPLE.plants.filter((p) => ['A', 'B'].includes(p.id)),
  };
  const result = allocate(tight);

  it('불가 판정을 낸다', () => {
    expect(result.feasible).toBe(false);
    expect(result.unassigned).toBeGreaterThan(0);
  });

  it('"불가"만 말하지 않고 대안을 같이 낸다', () => {
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives.some((a) => a.kind === 'capacity')).toBe(true);
  });
});

describe('외기온도가 제한시간을 바꾼다', () => {
  it('25℃ 미만이면 120분 제한 → 허용 이동시간이 늘어 G공장도 후보가 된다', () => {
    const cold = allocate({ ...EXAMPLE, tempC: 18 });
    expect(cold.limitMinutes).toBe(120);
    expect(cold.allowedTravelMinutes).toBe(80);
    expect(cold.excluded.find((e) => e.plantId === 'G')).toBeUndefined();
  });
});
