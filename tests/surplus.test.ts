import { describe, expect, it } from 'vitest';
import { MIN, SURPLUS, UNLOAD_EST_MIN } from '../lib/rules';
import {
  claimNote,
  isLive,
  mustArriveBy,
  offersForSite,
  surplusPrice,
  surplusTotal,
  validateSurplus,
} from '../lib/surplus';
import type { Plant, SurplusListing } from '../lib/types';

/** 2026-10-03 09:00 */
const T0 = new Date(2026, 9, 3, 9, 0, 0).getTime();
const at = (min: number) => T0 + min * MIN;

const plant = (id: string): Plant => ({
  id,
  name: `${id} 공장`,
  address: '',
  phone: '',
  lat: 37.2,
  lng: 127.1,
  fleetSize: 5,
  availableTrucks: 3,
  availableVolume: 60,
  hourlyRate: 4,
  prepMinutes: 10,
  isOpen: true,
  cap: { maxStrength: { 보통: 35 }, aggs: [25], flow: false, cements: [] },
});

const listing = (p: Partial<SurplusListing> & { id: string }): SurplusListing => ({
  plantId: 'p1',
  reason: 'cancelled',
  spec: {
    type: '보통',
    aggMm: 25,
    strength: 24,
    slumpKind: 'slump',
    slumpMm: 150,
    cement: '보통 포틀랜드 시멘트 (1종)',
  },
  volumeM3: 6,
  mixStartAt: at(0),
  limitMinutes: 90,
  tempC: 27,
  unitPrice: 90000,
  discountPct: 20,
  status: 'open',
  createdAt: at(0),
  ...p,
});

describe('급처가', () => {
  it('정상가에서 할인율만큼 깎는다', () => {
    expect(surplusPrice(90000, 20)).toBe(72000);
  });

  it('100원 단위로 끊는다 — 현장에 유리하게 내림', () => {
    expect(surplusPrice(87650, 15)).toBe(74500);
  });

  it('한 건 전체 금액과 아끼는 금액을 낸다', () => {
    const m = surplusTotal({ unitPrice: 90000, discountPct: 20, volumeM3: 6 });
    expect(m.unit).toBe(72000);
    expect(m.total).toBe(432000);
    expect(m.saved).toBe(108000);
  });
});

describe('올리기 전 검사', () => {
  const ok = { volumeM3: 6, unitPrice: 90000, discountPct: 20, mixStartAt: at(0) };

  it('정상 입력은 통과한다', () => {
    expect(validateSurplus(ok, at(5))).toBeNull();
  });

  it('최소 할인율보다 적게 깎으면 막는다 — 급처는 싸야 한다', () => {
    expect(validateSurplus({ ...ok, discountPct: SURPLUS.MIN_DISCOUNT_PCT - 1 }, at(5))).toMatch(
      /최소/,
    );
  });

  it('할인율이 지나치게 크면 입력 실수로 본다', () => {
    expect(validateSurplus({ ...ok, discountPct: SURPLUS.MAX_DISCOUNT_PCT + 1 }, at(5))).not.toBeNull();
  });

  it('차 한 대보다 많은 물량은 나눠 올리게 한다', () => {
    expect(validateSurplus({ ...ok, volumeM3: 7 }, at(5))).toMatch(/나눠/);
  });

  it('아직 비비지 않은 레미콘은 급처가 아니다', () => {
    expect(validateSurplus({ ...ok, mixStartAt: at(10) }, at(5))).not.toBeNull();
  });
});

describe('시한', () => {
  it('제한시간에서 하역·타설 시간을 뺀 때까지 닿아야 한다', () => {
    const l = listing({ id: 'a', mixStartAt: at(0), limitMinutes: 90 });
    expect(mustArriveBy(l)).toBe(at(90 - UNLOAD_EST_MIN));
  });

  it('시한이 지나면 더는 보이지 않는다', () => {
    const l = listing({ id: 'a' });
    expect(isLive(l, at(60))).toBe(true);
    expect(isLive(l, at(90 - UNLOAD_EST_MIN))).toBe(false);
  });

  it('누가 가져갔거나 공장이 내렸으면 보이지 않는다', () => {
    expect(isLive(listing({ id: 'a', status: 'claimed' }), at(1))).toBe(false);
    expect(isLive(listing({ id: 'a', status: 'withdrawn' }), at(1))).toBe(false);
  });
});

describe('현장에서 보는 매물', () => {
  const plants = [plant('p1'), plant('p2'), plant('p3')];

  it('제시간에 올 수 있는 것을 앞에, 그 안에서는 싼 것부터', () => {
    const listings = [
      listing({ id: 'far', plantId: 'p1', discountPct: 40 }), // 가장 싸지만 못 온다
      listing({ id: 'pricey', plantId: 'p2', discountPct: 10 }),
      listing({ id: 'cheap', plantId: 'p3', discountPct: 30 }),
    ];
    const travel: Record<string, number> = { p1: 80, p2: 20, p3: 30 };
    const offers = offersForSite(listings, plants, at(10), (p) => travel[p.id]);

    expect(offers.map((o) => o.listing.id)).toEqual(['cheap', 'pricey', 'far']);
    expect(offers[2].reachable).toBe(false);
  });

  it('여유 시간 = 시한 - 지금 받았을 때 도착 시각', () => {
    const offers = offersForSite([listing({ id: 'a' })], plants, at(10), () => 30);
    // 시한 09:70(=10:10) - 도착 09:40 = 30분
    expect(offers[0].slackMinutes).toBe(90 - UNLOAD_EST_MIN - 10 - 30);
  });

  it('경로를 아직 모르는 공장의 매물은 판정을 미룬다', () => {
    expect(offersForSite([listing({ id: 'a' })], plants, at(10), () => undefined)).toHaveLength(0);
  });

  it('시한이 지난 매물은 목록에서 빠진다', () => {
    expect(offersForSite([listing({ id: 'a' })], plants, at(80), () => 5)).toHaveLength(0);
  });
});

describe('가져간 매물로 보내는 주문', () => {
  it('급처 건이라는 것과 약속한 가격을 메모에 남긴다', () => {
    const n = claimNote(listing({ id: 'L1' }), { name: '서천동 현장' });
    expect(n.urgentReason).toContain('급처');
    expect(n.urgentReason).toContain('72,000원');
    expect(n.note).toContain('L1');
    expect(n.note).toContain('90,000원');
  });
});

describe('급처로 생긴 주문 — 시계는 이미 돌고 있다', () => {
  /**
   * 급처는 공장이 벌써 비벼 둔 물건이다. 배차할 때 "지금 비비기 시작" 으로 찍으면
   * 타설 기한이 실제보다 뒤로 밀려, 없는 여유를 있다고 말하게 된다.
   * 아래 식이 화면(app/plant/dispatch)이 쓰는 그 식이다.
   */
  const mixStartFor = (order: { mixStartedAt?: number }, now: number) =>
    order.mixStartedAt ?? now;

  it('보통 주문은 출하 지시를 누른 때가 비비기 시작이다', () => {
    const now = Date.UTC(2026, 9, 3, 8, 30);
    expect(mixStartFor({}, now)).toBe(now);
  });

  it('급처 주문은 매물이 비벼진 때를 그대로 쓴다', () => {
    const mixed = Date.UTC(2026, 9, 3, 8, 0);
    const now = Date.UTC(2026, 9, 3, 8, 30);
    expect(mixStartFor({ mixStartedAt: mixed }, now)).toBe(mixed);
  });

  it('그래서 타설 기한이 30분 앞당겨진다 — 이 차이가 사고를 막는다', () => {
    const mixed = Date.UTC(2026, 9, 3, 8, 0);
    const now = Date.UTC(2026, 9, 3, 8, 30);
    const limitMs = 120 * 60_000;

    const 틀린기한 = now + limitMs;
    const 맞는기한 = mixStartFor({ mixStartedAt: mixed }, now) + limitMs;

    expect(맞는기한).toBeLessThan(틀린기한);
    expect((틀린기한 - 맞는기한) / 60_000).toBe(30);
  });
});
