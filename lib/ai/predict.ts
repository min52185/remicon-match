/**
 * AI ② 도착 지연·조기 도착 예측과 콜드조인트 경고 — 지시서 7장.
 *
 * 단계
 *  1단계 규칙 기반 (지금 구현)  남은 거리를 다시 길찾기 → duration × 트럭 보정
 *  2단계 구간별 지연 원인        카카오 응답의 traffic_state·도로명으로 "어디서 막히는지"
 *  3단계 학습 보정               실제 도착 − API 예상의 오차를 시간대·요일·거리·공장·날씨로 학습
 *  4단계 자동 대응               예측 지연이 타설 공백을 만들면 재배분 추천
 *
 * 3단계는 실제 운행 기록(deliveries + truck_locations) 수백 건이 쌓여야 한다.
 * 그때까지 learnedBias() 는 기록에서 구한 단순 평균 오차만 돌려준다 —
 * 데이터가 모자라면 0을 돌려주고, 화면에 "보정 없음"으로 표시된다.
 */

import { MIN, RULES, UNLOAD_EST_MIN, coldJointLimitMinutes } from '../rules';
import type { Delivery, Level } from '../types';

/* ==========================================================================
 * 1. 지연·조기 도착
 * ======================================================================== */

export interface DelayAnalysis {
  /** + 늦음, − 빠름 (분) */
  minutes: number;
  level: Level;
  /** "처음 예상보다 7분 늦음" */
  text: string;
  reason?: string;
}

export function analyzeDelay(d: Delivery): DelayAnalysis {
  const minutes = Math.round((d.etaCurrentAt - d.etaInitialAt) / MIN);

  // 늦는 것 자체보다 "타설 제한시간을 넘느냐"가 중요하다
  const slackMin = (d.limitAt - d.etaCurrentAt) / MIN;
  let level: Level = 'ok';
  if (slackMin < 0) level = 'bad';
  else if (slackMin < RULES.LIMIT_WARN_MIN || minutes >= 10) level = 'warn';

  const text =
    minutes > 0
      ? `처음 예상보다 ${minutes}분 늦음`
      : minutes < 0
        ? `처음 예상보다 ${-minutes}분 빠름`
        : '처음 예상대로';

  return { minutes, level, text, reason: d.delayReason };
}

/**
 * 3단계 학습 보정의 자리.
 * 완료된 배송에서 (실제 이동시간 − 계획 이동시간)의 평균을 구한다.
 * 기록이 MIN_SAMPLES 보다 적으면 보정하지 않는다 — 몇 건으로 만든 계수는 오히려 해롭다.
 */
const MIN_SAMPLES = 30;

export function learnedBias(history: Delivery[]): { minutes: number; samples: number } {
  const done = history.filter((d) => d.arriveAt && d.departAt && d.travelMinutes > 0);
  if (done.length < MIN_SAMPLES) return { minutes: 0, samples: done.length };
  const errors = done.map((d) => (d.arriveAt! - d.departAt) / MIN - d.travelMinutes);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  return { minutes: Math.round(mean * 10) / 10, samples: done.length };
}

/* ==========================================================================
 * 2. 타설 모니터 · 콜드조인트 경고
 * ======================================================================== */

export interface PourMonitor {
  /** 타설 완료된 물량 */
  pouredM3: number;
  /** 남은 물량 */
  remainingM3: number;
  /** 지금 현장에서 타설 중인 차가 끝나는 예상 시각 */
  currentPourEndAt: number | null;
  /** 다음 차 도착 예상 시각 */
  nextArrivalAt: number | null;
  /** 공백(분) — 다음 차 도착 − 지금 차 타설 종료. 음수면 겹쳐서 안전하다. */
  gapMinutes: number | null;
  level: Level;
  message: string;
  /** 이어치기 허용 시간간격(분) */
  coldJointLimitMin: number;
}

export interface PourMonitorInput {
  totalVolumeM3: number;
  tempC: number;
  /** 이 타설에 속한 배송 전부 */
  deliveries: Delivery[];
  now: number;
  /** 경고를 띄울 공백 기준 (팀이 정한 값) */
  warnGapMin?: number;
}

export function monitorPour(input: PourMonitorInput): PourMonitor {
  const { deliveries, now, totalVolumeM3, tempC } = input;
  const warnGap = input.warnGapMin ?? RULES.COLD_JOINT_WARN_GAP_MIN;
  const coldJointLimitMin = coldJointLimitMinutes(tempC);

  const pouredM3 = deliveries
    .filter((d) => d.completedAt)
    .reduce((s, d) => s + d.volumeM3, 0);
  const remainingM3 = Math.max(0, totalVolumeM3 - pouredM3);

  // 지금 현장에 있는 차 — 도착했고 아직 타설이 안 끝난 차
  const onsite = deliveries
    .filter((d) => !d.completedAt && d.arriveAt && d.arriveAt <= now)
    .sort((a, b) => a.arriveAt! - b.arriveAt!);
  const current = onsite[0] ?? null;
  const currentPourEndAt = current ? current.arriveAt! + UNLOAD_EST_MIN * MIN : null;

  // 아직 도착하지 않은 차 중 가장 빠른 도착 예상
  const inbound = deliveries
    .filter((d) => !d.completedAt && (!d.arriveAt || d.arriveAt > now))
    .sort((a, b) => a.etaCurrentAt - b.etaCurrentAt);
  const nextArrivalAt = inbound[0]?.etaCurrentAt ?? null;

  if (remainingM3 <= 0) {
    return {
      pouredM3,
      remainingM3,
      currentPourEndAt,
      nextArrivalAt,
      gapMinutes: null,
      level: 'ok',
      message: '전 물량 타설이 끝났습니다.',
      coldJointLimitMin,
    };
  }

  if (!nextArrivalAt) {
    return {
      pouredM3,
      remainingM3,
      currentPourEndAt,
      nextArrivalAt,
      gapMinutes: null,
      level: remainingM3 > 0 ? 'bad' : 'ok',
      message: `남은 ${remainingM3}m³ 에 배차된 차량이 없습니다. 추가 주문이 필요합니다.`,
      coldJointLimitMin,
    };
  }

  // 지금 타설 중인 차가 없으면 "마지막으로 타설이 끝난 시각"부터 공백을 잰다
  const lastDone = deliveries
    .filter((d) => d.completedAt)
    .sort((a, b) => b.completedAt! - a.completedAt!)[0];
  const since = currentPourEndAt ?? lastDone?.completedAt ?? null;

  if (since == null) {
    return {
      pouredM3,
      remainingM3,
      currentPourEndAt,
      nextArrivalAt,
      gapMinutes: null,
      level: 'ok',
      message: '첫 차 도착을 기다리는 중입니다.',
      coldJointLimitMin,
    };
  }

  const gapMinutes = Math.round((nextArrivalAt - since) / MIN);

  let level: Level = 'ok';
  let message: string;

  if (gapMinutes >= coldJointLimitMin) {
    level = 'bad';
    message = `다음 차까지 ${gapMinutes}분 공백 — 이어치기 허용 시간간격 ${coldJointLimitMin}분을 넘습니다. 콜드조인트가 생깁니다. 즉시 다른 공장에 긴급 출하를 요청하거나 시공 이음을 계획하세요.`;
  } else if (gapMinutes >= coldJointLimitMin * 0.7) {
    level = 'bad';
    message = `다음 차까지 ${gapMinutes}분 공백 — 이어치기 허용 ${coldJointLimitMin}분에 가까워지고 있습니다. 다른 공장 추가 출하를 검토하세요.`;
  } else if (gapMinutes >= warnGap) {
    level = 'warn';
    message = `다음 차까지 ${gapMinutes}분 공백이 예상됩니다. 기준(${warnGap}분)을 넘었습니다.`;
  } else {
    message =
      gapMinutes <= 0
        ? '다음 차가 타설 종료 전에 도착합니다. 연속 타설이 유지됩니다.'
        : `다음 차까지 ${gapMinutes}분 공백 — 연속 타설에 문제 없습니다.`;
  }

  return {
    pouredM3,
    remainingM3,
    currentPourEndAt,
    nextArrivalAt,
    gapMinutes,
    level,
    message,
    coldJointLimitMin,
  };
}

/* ==========================================================================
 * 3. 4단계 자동 대응 — 공백이 생길 때 무엇을 할지
 * ======================================================================== */

export interface Recommendation {
  level: Level;
  action: string;
  detail: string;
}

export function recommend(monitor: PourMonitor, remainingTrucks: number): Recommendation[] {
  if (monitor.level === 'ok') return [];

  const out: Recommendation[] = [];

  if (monitor.gapMinutes != null && monitor.gapMinutes > 0) {
    out.push({
      level: monitor.level,
      action: '다음 차 출하를 앞당기기',
      detail: `공장에 ${monitor.gapMinutes}분 앞당겨 비비기를 시작해 달라고 요청합니다. 제한시간(비비기~타설 완료) 안에 들어오는지 먼저 확인하세요.`,
    });
  }

  if (remainingTrucks > 0) {
    out.push({
      level: monitor.level,
      action: '다른 공장에 추가 출하 요청',
      detail: `남은 ${remainingTrucks}대를 더 가까운 공장으로 다시 배분하면 공백을 줄일 수 있습니다. AI 배분을 다시 돌려 보세요.`,
    });
  }

  if (monitor.level === 'bad') {
    out.push({
      level: 'bad',
      action: '시공 이음 위치를 미리 정하기',
      detail:
        '공백을 메우지 못하면 계획된 위치에 시공 이음을 두는 편이 낫습니다. 책임기술자와 협의하세요.',
    });
  }

  return out;
}
