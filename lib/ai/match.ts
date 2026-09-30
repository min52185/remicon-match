/**
 * AI ③ 긴급 매칭 — 지금 가장 빨리 올 수 있는 공장 하나를 고른다.
 *
 * AI 배분(allocate.ts)과 푸는 문제가 다르다.
 *   배분   300㎥ 를 여러 공장에 몇 대씩 나눌까 — 이동시간 합을 최소화
 *   매칭   한 대를 어디서 가장 빨리 받을까 — 도착 시각을 최소화
 *
 * 도착 예상 = 지금 + 상차 준비시간 + 이동시간
 *
 * 세 항이 모두 공장마다 다르다. 준비시간은 믹서가 비어 있는지에 달렸고(plants.prep_minutes),
 * 이동시간은 카카오 길찾기가 실시간 교통을 반영해 준다. 가까운 공장이 늘 빠른 것이 아니다 —
 * 15분 거리인데 준비에 20분 걸리는 공장보다, 25분 거리인데 5분이면 나가는 공장이 빠르다.
 *
 * 빠르다고 아무 데나 보내면 안 된다. 먼저 거른다.
 *   출하 중지 · 사양 생산 불가 · 물량/차량 부족 · 허용 이동시간 초과 · 8·5제 밖
 *
 * 허용 이동시간을 넘으면 도착해도 못 붓고, 8·5제를 넘으면 기사가 퇴근한다.
 * 둘 다 "빨리 가는 것" 보다 먼저 봐야 할 조건이다.
 */

import {
  DEFAULT_POUR_SETTINGS,
  MIN,
  PourRules,
  UNLOAD_EST_MIN,
  checkWorkHours,
  type PourSettings,
} from '../rules';
import type { Level, Plant, Spec } from '../types';

/** 길찾기 결과 중 매칭이 쓰는 것만 */
export interface MatchRoute {
  minutes: number;
  distanceKm: number;
  source: 'kakao' | 'approx';
}

export interface MatchCandidate {
  plant: Plant;
  route: MatchRoute | null;

  /** 상차 준비시간(분) */
  prepMinutes: number;
  /** 이동시간(분) */
  travelMinutes: number | null;
  /** 준비 + 이동 — 지금 주문하면 몇 분 뒤에 도착하나 */
  etaMinutes: number | null;
  /** 도착 예상 시각 */
  arriveAt: number | null;

  /** 보낼 수 있는가 */
  ok: boolean;
  /** 안 되는 이유 — 화면에 그대로 띄운다 */
  reason?: string;
  level: Level;
}

export interface MatchInput {
  now: number;
  plants: Plant[];
  /** 공장 id → 길찾기 결과. 없으면 후보에서 뺀다(아직 계산 중). */
  routes: Map<string, MatchRoute>;
  spec: Spec;
  volumeM3: number;
  tempC: number;
  settings?: PourSettings;
}

export interface MatchResult {
  /** 가장 빨리 오는 공장. 없으면 null */
  best: MatchCandidate | null;
  /** 보낼 수 있는 공장 — 빠른 순 */
  usable: MatchCandidate[];
  /** 보낼 수 없는 공장 — 이유와 함께, 그래도 빠른 순 */
  blocked: MatchCandidate[];
  /** 이유별 집계 — "사양 생산 불가 3곳" 처럼 보여 준다 */
  reasons: { reason: string; count: number }[];
  /** 허용 이동시간(분) — 왜 걸렀는지 설명할 때 쓴다 */
  allowedTravelMinutes: number;
}

/**
 * 한 공장을 재 본다.
 * 거르는 순서가 곧 화면에 뜨는 이유의 우선순위다. 공장이 출하를 멈췄으면
 * 사양을 따질 것도 없다.
 */
function judge(
  plant: Plant,
  route: MatchRoute | null,
  input: MatchInput,
  allowedMin: number,
): MatchCandidate {
  const prepMinutes = plant.prepMinutes;
  const travelMinutes = route?.minutes ?? null;
  const etaMinutes = travelMinutes == null ? null : prepMinutes + travelMinutes;
  const arriveAt = etaMinutes == null ? null : input.now + etaMinutes * MIN;

  const base = { plant, route, prepMinutes, travelMinutes, etaMinutes, arriveAt };

  if (!plant.isOpen) {
    return { ...base, ok: false, reason: '출하 중지', level: 'bad' };
  }

  const spec = PourRules.judgeSpec(plant, input.spec);
  if (spec.level === 'bad') {
    return { ...base, ok: false, reason: spec.label, level: 'bad' };
  }

  const supply = PourRules.judgeSupply(plant, input.volumeM3, input.spec);
  if (supply.level === 'bad') {
    return { ...base, ok: false, reason: supply.label, level: 'bad' };
  }

  if (travelMinutes == null) {
    return { ...base, ok: false, reason: '이동시간 계산 중', level: 'warn' };
  }

  // 도착해도 못 부으면 보내는 의미가 없다
  if (travelMinutes > allowedMin) {
    return {
      ...base,
      ok: false,
      reason: `제한시간 내 도착 불가 (허용 ${allowedMin}분)`,
      level: 'bad',
    };
  }

  // 8·5제 — 도착해서 다 붓기까지가 근무시간 안에 들어와야 한다
  const work = checkWorkHours(input.now, arriveAt! + UNLOAD_EST_MIN * MIN);
  if (work.level === 'bad') {
    return { ...base, ok: false, reason: '8·5제 근무시간 밖', level: 'bad' };
  }

  // 물량이 빠듯한 것은 막지 않는다 — 긴급에서는 한 대라도 받는 편이 낫다
  return {
    ...base,
    ok: true,
    reason: supply.level === 'warn' ? supply.label : undefined,
    level: supply.level === 'warn' || work.level === 'warn' ? 'warn' : 'ok',
  };
}

/** 도착이 이른 순. 아직 이동시간을 모르는 공장은 뒤로. */
const byArrival = (a: MatchCandidate, b: MatchCandidate) =>
  (a.etaMinutes ?? Number.POSITIVE_INFINITY) - (b.etaMinutes ?? Number.POSITIVE_INFINITY);

export function matchFastest(input: MatchInput): MatchResult {
  const settings = input.settings ?? DEFAULT_POUR_SETTINGS;
  const allowedTravelMinutes = PourRules.allowedTravelMinutes(input.tempC, settings);

  const all = input.plants.map((p) =>
    judge(p, input.routes.get(p.id) ?? null, input, allowedTravelMinutes),
  );

  const usable = all.filter((c) => c.ok).sort(byArrival);
  const blocked = all.filter((c) => !c.ok).sort(byArrival);

  // 이유별로 몇 곳인지 — "사양 생산 불가 3곳" 처럼 한 줄로 보여 준다
  const counts = new Map<string, number>();
  for (const c of blocked) {
    const r = c.reason ?? '알 수 없음';
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  return {
    best: usable[0] ?? null,
    usable,
    blocked,
    reasons: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    allowedTravelMinutes,
  };
}
