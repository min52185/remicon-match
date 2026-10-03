/**
 * 슬럼프 손실 예측 — 운반 중인 레미콘의 슬럼프가 지금 얼마쯤일지.
 *
 *   S(t) = S0 − ∫₀ᵗ k(τ) dτ
 *
 * S0 는 공장이 출하할 때 적은 초기 슬럼프, t 는 기사가 공장을 출발한 뒤 지난 시간,
 * k(τ) 는 유도기 → 가속기 → 소진기로 움직이는 저하 속도(mm/분)다.
 * 상수와 근거는 lib/rules.ts 의 SLUMP_LOSS 에 있다. 실측이 아니라 약산이다.
 *
 * 순수 함수라 테스트로 고정한다.
 */

import { MIN, SLUMP_LOSS, slumpTolerance } from '../rules';

export type SlumpPhase = '유도기' | '가속기' | '소진기';

/** 기온 보정 배율 — 더우면 빨리, 추우면 천천히 떨어진다 */
export function tempFactor(tempC: number): number {
  const f = 1 + SLUMP_LOSS.TEMP_COEF * (tempC - SLUMP_LOSS.TEMP_REF_C);
  return Math.max(SLUMP_LOSS.TEMP_FACTOR_MIN, f);
}

/** 경과 t분 시점의 저하 속도 k (mm/분) */
export function slumpLossRate(tMin: number, tempC: number): number {
  const { K_BASE, K_PEAK, PEAK_MIN, SIGMA_MIN } = SLUMP_LOSS;
  const bell = Math.exp(-((tMin - PEAK_MIN) ** 2) / (2 * SIGMA_MIN ** 2));
  return (K_BASE + (K_PEAK - K_BASE) * bell) * tempFactor(tempC);
}

/** 0~t분 동안 떨어진 슬럼프 (mm) — 사다리꼴 적분 */
export function slumpLoss(tMin: number, tempC: number): number {
  let sum = 0;
  for (let a = 0; a < tMin; a += SLUMP_LOSS.STEP_MIN) {
    const b = Math.min(a + SLUMP_LOSS.STEP_MIN, tMin);
    sum += ((slumpLossRate(a, tempC) + slumpLossRate(b, tempC)) / 2) * (b - a);
  }
  return sum;
}

/** 경과 시간으로 본 단계 — 그래프의 세 구간 */
export function slumpPhase(tMin: number): SlumpPhase {
  const { PEAK_MIN, SIGMA_MIN } = SLUMP_LOSS;
  // 정점 ±1.25σ 를 가속기로 본다 — 그래프에서 약 40~80분
  if (tMin < PEAK_MIN - 1.25 * SIGMA_MIN) return '유도기';
  if (tMin <= PEAK_MIN + 1.25 * SIGMA_MIN) return '가속기';
  return '소진기';
}

export interface SlumpEstimate {
  /** 초기 슬럼프 (공장이 적은 값) */
  initialMm: number;
  /** 주문한 슬럼프 — 허용차 판정의 기준 */
  orderedMm: number;
  /** 출발 뒤 지난 분 */
  elapsedMin: number;
  /** 지금 추정 슬럼프 */
  nowMm: number;
  /** 지금 저하 속도 (mm/분) */
  rateNow: number;
  phase: SlumpPhase;
  /** 도착 예정 시각의 추정 슬럼프 — 아직 안 왔을 때만 */
  atArrivalMm: number | null;
  /** 주문 슬럼프 하한 (주문값 − 허용차) */
  lowerMm: number;
  /** 지금 또는 도착 때 하한 아래로 떨어지나 */
  belowLower: boolean;
}

const round = (v: number) => Math.round(v);

/**
 * @param departAt 기사가 공장을 출발한 시각 — t 를 여기서부터 잰다
 * @param arriveAt 도착 예정(또는 실제 도착) 시각. 이미 도착했으면 그때 값으로 멈춘다
 */
export function estimateSlump(input: {
  initialMm: number;
  orderedMm: number;
  departAt: number;
  arriveAt: number;
  arrived: boolean;
  now: number;
  tempC: number;
}): SlumpEstimate {
  const { initialMm, orderedMm, departAt, arriveAt, arrived, now, tempC } = input;
  // 도착한 뒤에는 타설이 시작되므로 '운반 중 손실'은 도착 시각에서 멈춘다
  const until = arrived ? Math.min(now, arriveAt) : now;
  const elapsedMin = Math.max(0, (until - departAt) / MIN);
  const nowMm = Math.max(0, initialMm - slumpLoss(elapsedMin, tempC));

  const arrivalMin = Math.max(0, (arriveAt - departAt) / MIN);
  const atArrivalMm = arrived ? null : Math.max(0, initialMm - slumpLoss(arrivalMin, tempC));

  const lowerMm = orderedMm - slumpTolerance(orderedMm);
  return {
    initialMm,
    orderedMm,
    elapsedMin: round(elapsedMin),
    nowMm: round(nowMm),
    rateNow: Math.round(slumpLossRate(elapsedMin, tempC) * 100) / 100,
    phase: slumpPhase(elapsedMin),
    atArrivalMm: atArrivalMm == null ? null : round(atArrivalMm),
    lowerMm,
    belowLower: round(nowMm) < lowerMm || (atArrivalMm != null && round(atArrivalMm) < lowerMm),
  };
}
