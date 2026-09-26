/**
 * 현황판 집계 — 화면에 뜨는 숫자를 고정한다.
 *
 * 현장·공장이 이 숫자로 "지금 비벼야 하나"를 판단한다. 틀리면 콜드조인트가 생기는
 * 쪽이라, 배분 알고리즘과 같은 수준으로 검증해 둔다.
 */

import { describe, expect, it } from 'vitest';
import {
  dayRange,
  demandBySite,
  isWithin,
  shipmentRhythm,
  targetInterval,
  todaysOrders,
  upcomingShipments,
} from '../lib/dashboard';
import { MIN, TRUCK_CAPACITY_M3 } from '../lib/rules';
import { emptyDb, type Db } from '../lib/store/shared';
import type { AllocationPlan, Delivery, Order, Spec } from '../lib/types';

/** 2026-09-26 09:00 (로컬) */
const T0 = new Date(2026, 8, 26, 9, 0, 0).getTime();
const at = (min: number) => T0 + min * MIN;

const SPEC: Spec = {
  type: '보통',
  aggMm: 25,
  strength: 24,
  slumpKind: 'slump',
  slumpMm: 150,
  cement: '보통 포틀랜드 시멘트 (1종)',
};

function order(p: Partial<Order> & { id: string }): Order {
  return {
    code: `R-${p.id}`,
    siteId: 's1',
    plantId: 'p1',
    spec: SPEC,
    volumeM3: 60,
    pourStartAt: at(60),
    pumpRate: 60,
    status: 'accepted',
    tempC: 20,
    createdAt: at(0),
    ...p,
  };
}

function delivery(p: Partial<Delivery> & { id: string; mixStartAt: number }): Delivery {
  return {
    orderId: 'o1',
    truckId: `t-${p.id}`,
    plantId: 'p1',
    siteId: 's1',
    volumeM3: TRUCK_CAPACITY_M3,
    departAt: p.mixStartAt + 10 * MIN,
    etaInitialAt: p.mixStartAt + 40 * MIN,
    etaCurrentAt: p.mixStartAt + 40 * MIN,
    limitMinutes: 120,
    limitAt: p.mixStartAt + 120 * MIN,
    travelMinutes: 30,
    path: [],
    distanceKm: 20,
    ...p,
  };
}

function db(over: Partial<Db> = {}): Db {
  return {
    ...emptyDb(),
    sites: [
      { id: 's1', name: '서천동 현장', address: '용인', lat: 37.23, lng: 127.07 },
      { id: 's2', name: '광교 현장', address: '수원', lat: 37.28, lng: 127.04 },
    ],
    loaded: true,
    ...over,
  };
}

/* ========================================================================== */

describe('dayRange — 시연 시계 기준 하루', () => {
  it('자정에서 시작해 24시간이다', () => {
    const r = dayRange(at(0));
    expect(new Date(r.start).getHours()).toBe(0);
    expect(r.end - r.start).toBe(24 * 60 * MIN);
  });

  it('끝 경계는 포함하지 않는다', () => {
    const r = dayRange(at(0));
    expect(isWithin(r.start, r)).toBe(true);
    expect(isWithin(r.end - 1, r)).toBe(true);
    expect(isWithin(r.end, r)).toBe(false);
  });
});

describe('todaysOrders', () => {
  const day = dayRange(at(0));

  it('오늘 타설이거나 오늘 넣은 주문을 센다', () => {
    const orders = [
      order({ id: 'o1', pourStartAt: at(120), createdAt: at(-2 * 24 * 60) }), // 오늘 타설
      order({ id: 'o2', pourStartAt: at(5 * 24 * 60), createdAt: at(30) }), // 오늘 주문
      order({ id: 'o3', pourStartAt: at(5 * 24 * 60), createdAt: at(-5 * 24 * 60) }), // 둘 다 아님
    ];
    expect(todaysOrders(orders, 's1', day).map((o) => o.id)).toEqual(['o1', 'o2']);
  });

  it('거절·취소는 빼고, 다른 현장 것도 뺀다', () => {
    const orders = [
      order({ id: 'ok' }),
      order({ id: 'rej', status: 'rejected' }),
      order({ id: 'can', status: 'cancelled' }),
      order({ id: 'other', siteId: 's2' }),
    ];
    expect(todaysOrders(orders, 's1', day).map((o) => o.id)).toEqual(['ok']);
  });
});

describe('shipmentRhythm — 출하 간격', () => {
  it('마지막 출하 경과와 평균 간격을 잰다', () => {
    const today = [
      delivery({ id: 'd1', mixStartAt: at(0) }),
      delivery({ id: 'd3', mixStartAt: at(40) }), // 일부러 순서를 섞어 넣는다
      delivery({ id: 'd2', mixStartAt: at(20) }),
    ];
    const r = shipmentRhythm(today, at(50));

    expect(r.sorted.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
    expect(r.lastMixStartAt).toBe(at(40));
    expect(r.sinceLastMin).toBe(10);
    expect(r.avgGapMin).toBe(20); // 20분, 20분
  });

  it('한 대만 나갔으면 간격을 잴 수 없다', () => {
    const r = shipmentRhythm([delivery({ id: 'd1', mixStartAt: at(0) })], at(15));
    expect(r.sinceLastMin).toBe(15);
    expect(r.avgGapMin).toBeNull();
  });

  it('오늘 출하가 없으면 전부 없음이다', () => {
    const r = shipmentRhythm([], at(15));
    expect(r.lastMixStartAt).toBeNull();
    expect(r.sinceLastMin).toBeNull();
    expect(r.avgGapMin).toBeNull();
  });
});

/* ── AI 배분 시각표가 있는 상황 ── */

const PLAN: AllocationPlan = {
  id: 'pl1',
  siteId: 's1',
  totalVolumeM3: 60,
  pourStartAt: at(60),
  pumpRate: 60,
  tempC: 20,
  items: [
    {
      plantId: 'p1',
      plantName: 'A공장',
      trucks: 4,
      travelMinutes: 30,
      rounds: [0, 1, 2, 3],
      // 일부러 뒤섞어 둔다 — 정렬을 함수가 책임져야 한다
      mixStartAts: [at(54), at(36), at(72), at(18)],
    },
  ],
  summary: 'A공장 4대',
  createdAt: at(0),
};

describe('targetInterval — 지켜야 할 출하 간격', () => {
  it('계획이 있으면 그 시각표의 회차 간격을 쓴다', () => {
    const t = targetInterval(db({ plans: [PLAN] }), 'p1', [order({ id: 'o1', planId: 'pl1' })]);
    expect(t).toEqual({ minutes: 18, source: 'plan' });
  });

  it('계획이 없으면 펌프 속도로 어림한다', () => {
    // 6m³ / 60m³·h = 0.1h = 6분
    const t = targetInterval(db(), 'p1', [order({ id: 'o1', pumpRate: 60 })]);
    expect(t).toEqual({ minutes: 6, source: 'pump' });
  });

  it('계획이 다른 공장 것뿐이면 펌프 속도로 떨어진다', () => {
    const t = targetInterval(db({ plans: [PLAN] }), 'p9', [order({ id: 'o1', planId: 'pl1' })]);
    expect(t?.source).toBe('pump');
  });

  it('진행 중인 주문이 없으면 없음이다', () => {
    expect(targetInterval(db(), 'p1', [])).toBeNull();
  });
});

describe('upcomingShipments — 출하 예정 차량', () => {
  it('이미 내보낸 만큼을 시각표에서 잘라 낸다', () => {
    const d = db({
      plans: [PLAN],
      deliveries: [
        delivery({ id: 'd1', mixStartAt: at(18) }),
        delivery({ id: 'd2', mixStartAt: at(36) }),
      ],
    });
    const { slots, unplanned } = upcomingShipments(d, 'p1', [order({ id: 'o1', planId: 'pl1' })]);

    expect(unplanned).toEqual([]);
    expect(slots.map((s) => s.at)).toEqual([at(54), at(72)]);
    expect(slots.map((s) => s.round)).toEqual([3, 4]); // 3회차부터
  });

  it('여러 주문의 회차를 시각 순으로 합친다', () => {
    const plan2: AllocationPlan = {
      ...PLAN,
      id: 'pl2',
      siteId: 's2',
      items: [{ ...PLAN.items[0], mixStartAts: [at(27), at(45)], trucks: 2, rounds: [0, 1] }],
    };
    const d = db({ plans: [PLAN, plan2] });
    const { slots } = upcomingShipments(d, 'p1', [
      order({ id: 'o1', planId: 'pl1' }),
      order({ id: 'o2', planId: 'pl2', siteId: 's2' }),
    ]);

    expect(slots.map((s) => s.at)).toEqual([at(18), at(27), at(36), at(45), at(54), at(72)]);
    expect(slots[1].siteName).toBe('광교 현장');
  });

  it('계획 없는 주문은 남은 대수만 알려 준다', () => {
    const d = db({
      deliveries: [delivery({ id: 'd1', mixStartAt: at(0), orderId: 'o1' })],
    });
    const { slots, unplanned } = upcomingShipments(d, 'p1', [order({ id: 'o1', volumeM3: 30 })]);

    expect(slots).toEqual([]);
    expect(unplanned).toEqual([
      { orderId: 'o1', orderCode: 'R-o1', siteName: '서천동 현장', trucksLeft: 4 }, // (30−6)/6
    ]);
  });

  it('전량 내보낸 주문은 남은 것으로 세지 않는다', () => {
    const d = db({
      deliveries: [
        delivery({ id: 'd1', mixStartAt: at(0), orderId: 'o1' }),
        delivery({ id: 'd2', mixStartAt: at(20), orderId: 'o1' }),
      ],
    });
    const { unplanned } = upcomingShipments(d, 'p1', [order({ id: 'o1', volumeM3: 12 })]);
    expect(unplanned).toEqual([]);
  });

  it('다른 공장이 내보낸 배송은 내 회차에서 빼지 않는다', () => {
    const d = db({
      plans: [PLAN],
      deliveries: [delivery({ id: 'd1', mixStartAt: at(18), plantId: 'p9' })],
    });
    const { slots } = upcomingShipments(d, 'p1', [order({ id: 'o1', planId: 'pl1' })]);
    expect(slots).toHaveLength(4);
  });
});

describe('demandBySite — 현장별 주문량', () => {
  it('현장별로 묶고 타설이 이른 순으로 준다', () => {
    const d = db({
      deliveries: [
        delivery({ id: 'd1', mixStartAt: at(0), orderId: 'o1' }),
        delivery({ id: 'd2', mixStartAt: at(20), orderId: 'o1' }),
      ],
    });
    const rows = demandBySite(d, 'p1', [
      order({ id: 'o1', siteId: 's1', volumeM3: 60, pourStartAt: at(120) }),
      order({ id: 'o2', siteId: 's1', volumeM3: 30, pourStartAt: at(180) }),
      order({ id: 'o3', siteId: 's2', volumeM3: 24, pourStartAt: at(60) }),
    ]);

    expect(rows.map((r) => r.siteId)).toEqual(['s2', 's1']); // 타설 이른 순

    const s1 = rows.find((r) => r.siteId === 's1')!;
    expect(s1.orderCount).toBe(2);
    expect(s1.volumeM3).toBe(90);
    expect(s1.sentM3).toBe(12);
    expect(s1.leftM3).toBe(78);
    expect(s1.nextPourAt).toBe(at(120)); // 두 주문 중 이른 쪽
  });

  it('다른 공장이 내보낸 물량은 내 출하로 세지 않는다', () => {
    const d = db({
      deliveries: [delivery({ id: 'd1', mixStartAt: at(0), orderId: 'o1', plantId: 'p9' })],
    });
    const rows = demandBySite(d, 'p1', [order({ id: 'o1', volumeM3: 60 })]);
    expect(rows[0].sentM3).toBe(0);
    expect(rows[0].leftM3).toBe(60);
  });

  it('진행 중인 주문이 없으면 빈 표다', () => {
    expect(demandBySite(db(), 'p1', [])).toEqual([]);
  });
});
