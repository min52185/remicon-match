/**
 * 슬럼프 손실 약산 — S(t) = S0 − ∫k(τ)dτ, k(t) 는 유도기 → 가속기 → 소진기.
 */

import { describe, expect, it } from 'vitest';
import {
  estimateSlump,
  slumpLoss,
  slumpLossRate,
  slumpPhase,
  tempFactor,
} from '../lib/ai/slump';
import { MIN, SLUMP_LOSS, slumpTolerance } from '../lib/rules';

const REF = SLUMP_LOSS.TEMP_REF_C;
const T0 = new Date(2026, 9, 3, 9, 0, 0).getTime();
const at = (min: number) => T0 + min * MIN;

describe('저하 속도 k(t) — 그래프 모양', () => {
  it('처음(유도기)에는 낮다', () => {
    expect(slumpLossRate(0, REF)).toBeCloseTo(SLUMP_LOSS.K_BASE, 2);
    expect(slumpLossRate(20, REF)).toBeLessThan(0.3);
  });

  it('60분 무렵 정점(1.35)에 이른다', () => {
    expect(slumpLossRate(60, REF)).toBeCloseTo(SLUMP_LOSS.K_PEAK, 5);
    expect(slumpLossRate(60, REF)).toBeGreaterThan(slumpLossRate(50, REF));
    expect(slumpLossRate(60, REF)).toBeGreaterThan(slumpLossRate(70, REF));
  });

  it('약 42분·78분에 상수 가정값(0.8) 근처를 지난다', () => {
    expect(slumpLossRate(42, REF)).toBeGreaterThan(0.7);
    expect(slumpLossRate(42, REF)).toBeLessThan(0.9);
    expect(slumpLossRate(78, REF)).toBeCloseTo(slumpLossRate(42, REF), 5);
  });

  it('소진기(120분)에는 다시 낮아진다', () => {
    expect(slumpLossRate(120, REF)).toBeLessThan(0.2);
  });
});

describe('기온 보정', () => {
  it('기준 기온이면 그대로, 더우면 크게, 추우면 작게', () => {
    expect(tempFactor(REF)).toBe(1);
    expect(tempFactor(30)).toBeCloseTo(1.3, 5);
    expect(tempFactor(10)).toBeCloseTo(0.7, 5);
  });

  it('아주 추워도 하한 아래로는 줄지 않는다', () => {
    expect(tempFactor(-30)).toBe(SLUMP_LOSS.TEMP_FACTOR_MIN);
  });
});

describe('누적 손실', () => {
  it('0분이면 0', () => {
    expect(slumpLoss(0, REF)).toBe(0);
  });

  it('시간이 갈수록 늘기만 한다', () => {
    let prev = 0;
    for (const t of [5, 17.3, 30, 45, 60, 75, 90, 120]) {
      const l = slumpLoss(t, REF);
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
  });

  it('처음 30분은 조금, 30~90분에 크게 떨어진다', () => {
    const first30 = slumpLoss(30, REF);
    const mid = slumpLoss(90, REF) - first30;
    expect(first30).toBeLessThan(10);
    expect(mid).toBeGreaterThan(40);
  });

  it('간격에 맞지 않는 시간(10.2분)도 끝까지 적분한다', () => {
    expect(slumpLoss(10.2, REF)).toBeGreaterThan(slumpLoss(10, REF));
  });

  it('더우면 같은 시간에 더 많이 떨어진다', () => {
    expect(slumpLoss(60, 30)).toBeGreaterThan(slumpLoss(60, REF));
  });
});

describe('단계', () => {
  it.each([
    [10, '유도기'],
    [60, '가속기'],
    [100, '소진기'],
  ])('%i분 → %s', (t, phase) => {
    expect(slumpPhase(t)).toBe(phase);
  });
});

describe('운반 중 슬럼프 추정', () => {
  const base = {
    initialMm: 180,
    orderedMm: 150,
    departAt: at(0),
    arriveAt: at(50),
    arrived: false,
    tempC: REF,
  };

  it('출발 직후에는 초기값 그대로다', () => {
    expect(estimateSlump({ ...base, now: at(0) }).nowMm).toBe(180);
  });

  it('출발 뒤 시간이 지나면 줄고, 도착 때 값도 미리 낸다', () => {
    const e = estimateSlump({ ...base, now: at(30) });
    expect(e.elapsedMin).toBe(30);
    expect(e.nowMm).toBeLessThan(180);
    expect(e.atArrivalMm).not.toBeNull();
    expect(e.atArrivalMm!).toBeLessThan(e.nowMm);
  });

  it('도착한 뒤에는 도착 시각에서 멈춘다 — 그 뒤는 타설이다', () => {
    const arrived = { ...base, arrived: true, arriveAt: at(40) };
    expect(estimateSlump({ ...arrived, now: at(90) }).nowMm).toBe(
      estimateSlump({ ...arrived, now: at(40) }).nowMm,
    );
    expect(estimateSlump({ ...arrived, now: at(90) }).atArrivalMm).toBeNull();
  });

  it('주문 슬럼프 하한(KS F 4009 허용차) 아래로 떨어지면 알린다', () => {
    expect(slumpTolerance(150)).toBe(25);
    expect(slumpTolerance(65)).toBe(15);
    expect(slumpTolerance(25)).toBe(10);
    // 150 주문을 150 으로 실어 오래 달리면 125 아래로 떨어진다
    const e = estimateSlump({ ...base, initialMm: 150, arriveAt: at(90), now: at(10) });
    expect(e.lowerMm).toBe(125);
    expect(e.belowLower).toBe(true);
  });

  it('0 아래로는 내려가지 않는다', () => {
    expect(estimateSlump({ ...base, initialMm: 20, now: at(200), arriveAt: at(300) }).nowMm).toBe(0);
  });
});
