/**
 * 급처 매물 — 공장이 이미 비빈 레미콘을 싸게 내놓고, 현장이 가져간다.
 *
 * 두 가지 경우에 생긴다.
 *   주문 취소  현장이 타설을 접어 실은 차가 갈 곳을 잃었다
 *   잔량      출하하고 차에 남았다
 *
 * 어느 쪽이든 이미 비볐으므로 시계가 돌고 있다. 비비기~타설 완료 제한시간 안에
 * 현장에 닿아 부어야 쓸 수 있다. 그래서 현장마다 "지금 받으면 제시간에 오나"를
 * 따로 판정해 보여 준다.
 *
 * 이 파일은 화면을 모른다. 순수 함수라 테스트로 고정할 수 있다.
 */

import { won } from './format';
import { MIN, SURPLUS, TRUCK_CAPACITY_M3, UNLOAD_EST_MIN } from './rules';
import type { Plant, Site, SurplusListing } from './types';

/** 급처가 (원/m³) — 100원 단위로 끊는다 */
export function surplusPrice(unitPrice: number, discountPct: number): number {
  const raw = unitPrice * (1 - discountPct / 100);
  return Math.floor(raw / SURPLUS.PRICE_ROUND_WON) * SURPLUS.PRICE_ROUND_WON;
}

/** 이 매물 한 건을 다 가져가면 내는 돈과 아끼는 돈 */
export function surplusTotal(l: Pick<SurplusListing, 'unitPrice' | 'discountPct' | 'volumeM3'>) {
  const unit = surplusPrice(l.unitPrice, l.discountPct);
  const total = Math.round(unit * l.volumeM3);
  const normal = Math.round(l.unitPrice * l.volumeM3);
  return { unit, total, saved: normal - total };
}

/**
 * 늦어도 이 시각에는 현장에 닿아야 한다.
 * 제한시간은 '타설 완료'까지라서, 하역·타설 시간만큼 앞당긴다.
 */
export const mustArriveBy = (l: Pick<SurplusListing, 'mixStartAt' | 'limitMinutes'>) =>
  l.mixStartAt + l.limitMinutes * MIN - UNLOAD_EST_MIN * MIN;

/** 아직 가져갈 수 있는 매물인가 — 열려 있고, 지금 출발해 닿을 시간이 남았나 */
export const isLive = (l: SurplusListing, now: number) =>
  l.status === 'open' && now < mustArriveBy(l);

/** 올리기 전 검사. 문제가 없으면 null */
export function validateSurplus(
  input: Pick<SurplusListing, 'volumeM3' | 'unitPrice' | 'discountPct' | 'mixStartAt'>,
  now: number,
): string | null {
  if (!(input.volumeM3 > 0)) return '물량을 넣어 주세요.';
  if (input.volumeM3 > TRUCK_CAPACITY_M3)
    return `한 매물은 차 한 대(${TRUCK_CAPACITY_M3}m³)까지입니다. 남은 차가 여럿이면 나눠 올려 주세요.`;
  if (!(input.unitPrice > 0)) return '정상 단가를 넣어 주세요.';
  if (input.discountPct < SURPLUS.MIN_DISCOUNT_PCT)
    return `급처는 정상가보다 최소 ${SURPLUS.MIN_DISCOUNT_PCT}% 싸게 내놓아야 합니다.`;
  if (input.discountPct > SURPLUS.MAX_DISCOUNT_PCT)
    return `할인율이 ${SURPLUS.MAX_DISCOUNT_PCT}%를 넘습니다. 입력을 확인해 주세요.`;
  if (input.mixStartAt > now) return '비비기 시작 시각이 아직 오지 않았습니다.';
  return null;
}

/* ==========================================================================
 * 현장에서 보는 매물 목록
 * ======================================================================== */

export interface SurplusOffer {
  listing: SurplusListing;
  plant: Plant;
  /** 지금 출발하면 걸리는 시간(분) */
  travelMinutes: number;
  /** 지금 받으면 도착하는 시각 */
  arriveAt: number;
  /** 늦어도 이때까지 닿아야 한다 */
  deadlineAt: number;
  /** 도착하고도 남는 여유(분). 음수면 제시간에 못 온다 */
  slackMinutes: number;
  reachable: boolean;
  unitPrice: number;
  total: number;
  saved: number;
}

/**
 * 한 현장이 볼 매물.
 * 제시간에 올 수 있는 것을 앞에, 그 안에서는 싼 것부터.
 *
 * @param travelOf 공장 → 이 현장 이동시간(분). 경로를 아직 모르면 undefined
 */
export function offersForSite(
  listings: SurplusListing[],
  plants: Plant[],
  now: number,
  travelOf: (plant: Plant) => number | undefined,
): SurplusOffer[] {
  const plantById = new Map(plants.map((p) => [p.id, p]));
  const offers: SurplusOffer[] = [];

  for (const l of listings) {
    if (!isLive(l, now)) continue;
    const plant = plantById.get(l.plantId);
    if (!plant) continue;
    const travel = travelOf(plant);
    if (travel == null) continue;

    const arriveAt = now + travel * MIN;
    const deadlineAt = mustArriveBy(l);
    const slackMinutes = Math.floor((deadlineAt - arriveAt) / MIN);
    const money = surplusTotal(l);

    offers.push({
      listing: l,
      plant,
      travelMinutes: travel,
      arriveAt,
      deadlineAt,
      slackMinutes,
      reachable: slackMinutes >= 0,
      unitPrice: money.unit,
      total: money.total,
      saved: money.saved,
    });
  }

  return offers.sort(
    (a, b) =>
      Number(b.reachable) - Number(a.reachable) ||
      a.unitPrice - b.unitPrice ||
      a.travelMinutes - b.travelMinutes,
  );
}

/** 한 공장이 올린 매물 — 최근 것이 앞에 */
export const surplusOfPlant = (listings: SurplusListing[], plantId: string) =>
  listings.filter((l) => l.plantId === plantId).sort((a, b) => b.createdAt - a.createdAt);

/**
 * 가져간 매물로 보낼 주문의 메모.
 * 공장 주문 화면에서 급처 건이라는 것과 약속한 값을 바로 알아보게 한다.
 */
export function claimNote(l: SurplusListing, site: Pick<Site, 'name'>): {
  urgentReason: string;
  note: string;
} {
  const { unit } = surplusTotal(l);
  return {
    urgentReason: `급처 매물 — 이미 비빈 레미콘, m³당 ${won(unit)} (${l.discountPct}% 할인)`,
    note: `급처 매물 ${l.id} · ${site.name} · 정상가 ${won(l.unitPrice)}/m³ → 급처가 ${won(unit)}/m³`,
  };
}

export const REASON_LABEL: Record<SurplusListing['reason'], string> = {
  cancelled: '주문 취소',
  leftover: '출하 잔량',
};
