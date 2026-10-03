/**
 * 전자 납품서 — 차량 한 대가 한 장이다.
 * 종이 납품서는 트럭 한 대가 실은 배치마다 한 장씩 나온다. 주문 한 건에 열 대가
 * 갔으면 납품서도 열 장이다.
 */

import { describe, expect, it } from 'vitest';
import {
  buildNote,
  dayKey,
  dayLabel,
  groupByDay,
  notesOfSite,
  notesToCsv,
} from '../lib/delivery-note';
import { MIN, TRUCK_CAPACITY_M3 } from '../lib/rules';
import { emptyDb, type Db } from '../lib/store/shared';
import type { Delivery, Order, Spec } from '../lib/types';

/** 2026-09-29(화) 09:00 */
const T0 = new Date(2026, 8, 29, 9, 0, 0).getTime();
const at = (min: number) => T0 + min * MIN;

const SPEC: Spec = {
  type: '보통',
  aggMm: 25,
  strength: 24,
  slumpKind: 'slump',
  slumpMm: 150,
  cement: '보통 포틀랜드 시멘트 (1종)',
};

const order = (p: Partial<Order> & { id: string; code: string }): Order => ({
  siteId: 's1',
  plantId: 'p1',
  spec: SPEC,
  volumeM3: 60,
  pourStartAt: at(60),
  pumpRate: 60,
  status: 'delivering',
  tempC: 22,
  createdAt: at(-60),
  ...p,
});

const delivery = (p: Partial<Delivery> & { id: string; mixStartAt: number }): Delivery => ({
  orderId: 'o1',
  truckId: 't1',
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
});

const db = (over: Partial<Db> = {}): Db => ({
  ...emptyDb(),
  loaded: true,
  sites: [{ id: 's1', name: '서천동 현장', address: '용인시 기흥구', lat: 37.23, lng: 127.07 }],
  plants: [
    {
      id: 'p1',
      name: '가온레미콘',
      address: '화성시 동탄면',
      phone: '031-000-1001',
      lat: 37.17,
      lng: 127.12,
      fleetSize: 3,
      availableTrucks: 3,
      availableVolume: 100,
      hourlyRate: 4,
      prepMinutes: 10,
      isOpen: true,
      cap: { maxStrength: { 보통: 35 }, aggs: [25], flow: false, cements: [SPEC.cement] },
    },
  ],
  trucks: [
    { id: 't1', plantId: 'p1', no: 1, plateNo: '경기 80바 1234', driver: '김기사', capacityM3: 6 },
    { id: 't2', plantId: 'p1', no: 2, plateNo: '경기 80바 5678', driver: '이기사', capacityM3: 6 },
  ],
  ...over,
});

/* ========================================================================== */

describe('buildNote — 한 대가 한 장', () => {
  const base = db({
    orders: [order({ id: 'o1', code: 'R-0929-001' })],
    deliveries: [
      delivery({ id: 'd1', mixStartAt: at(0), truckId: 't1' }),
      delivery({ id: 'd2', mixStartAt: at(20), truckId: 't2' }),
    ],
  });

  it('공급자·수요자·차량이 한 장에 다 들어간다', () => {
    const n = buildNote(base, base.deliveries[0])!;
    expect(n.plantName).toBe('가온레미콘');
    expect(n.plantPhone).toBe('031-000-1001');
    expect(n.siteName).toBe('서천동 현장');
    expect(n.truckNo).toBe(1);
    expect(n.plateNo).toBe('경기 80바 1234');
    expect(n.driverName).toBe('김기사');
  });

  it('납품서 번호는 주문번호에 회차를 붙인다', () => {
    expect(buildNote(base, base.deliveries[0])!.code).toBe('R-0929-001-01');
    expect(buildNote(base, base.deliveries[1])!.code).toBe('R-0929-001-02');
  });

  it('회차는 비비기 시작 순이다 — 배열 순서가 아니라', () => {
    const shuffled = db({
      orders: [order({ id: 'o1', code: 'R-0929-001' })],
      deliveries: [
        delivery({ id: 'late', mixStartAt: at(40) }),
        delivery({ id: 'early', mixStartAt: at(0) }),
      ],
    });
    expect(buildNote(shuffled, shuffled.deliveries[0])!.round).toBe(2);
    expect(buildNote(shuffled, shuffled.deliveries[1])!.round).toBe(1);
  });

  it('누계는 이 주문에서 이 차까지 실은 물량이다', () => {
    const three = db({
      orders: [order({ id: 'o1', code: 'R-0929-001' })],
      deliveries: [
        delivery({ id: 'c', mixStartAt: at(40), volumeM3: 3.5 }),
        delivery({ id: 'a', mixStartAt: at(0) }),
        delivery({ id: 'b', mixStartAt: at(20) }),
      ],
    });
    const byId = (id: string) => buildNote(three, three.deliveries.find((x) => x.id === id)!)!;
    expect(byId('a').cumulativeM3).toBe(6);
    expect(byId('b').cumulativeM3).toBe(12);
    expect(byId('c').cumulativeM3).toBe(15.5);
  });

  it('비고에는 현장 진입 메모, 지정사항에는 주문 메모가 들어간다', () => {
    const noted = db({
      sites: [{ id: 's1', name: '서천동 현장', address: '', lat: 0, lng: 0, accessNote: '2번 게이트' }],
      orders: [order({ id: 'o1', code: 'R-0929-001', note: '공기량 4.5±1.5%' })],
      deliveries: [delivery({ id: 'd1', mixStartAt: at(0) })],
    });
    const n = buildNote(noted, noted.deliveries[0])!;
    expect(n.siteAccessNote).toBe('2번 게이트');
    expect(n.orderNote).toBe('공기량 4.5±1.5%');
  });

  it('메모가 없으면 빈 칸이다', () => {
    const n = buildNote(base, base.deliveries[0])!;
    expect(n.siteAccessNote).toBe('');
    expect(n.orderNote).toBe('');
  });

  it('주문이 없으면 납품서를 만들지 않는다', () => {
    const orphan = db({ orders: [], deliveries: [delivery({ id: 'd1', mixStartAt: at(0) })] });
    expect(buildNote(orphan, orphan.deliveries[0])).toBeNull();
  });
});

describe('buildNote — 제한시간 판정', () => {
  const withTimes = (completedAt?: number) =>
    db({
      orders: [order({ id: 'o1', code: 'R-0929-001' })],
      deliveries: [delivery({ id: 'd1', mixStartAt: at(0), arriveAt: at(40), completedAt })],
    });

  it('끝났으면 경과와 판정이 찍힌다', () => {
    const d = withTimes(at(55));
    const n = buildNote(d, d.deliveries[0])!;
    expect(n.elapsedMin).toBe(55);
    expect(n.within).toBe(true);
  });

  it('제한을 넘기면 초과로 잡는다', () => {
    const d = withTimes(at(130)); // 제한 120분
    const n = buildNote(d, d.deliveries[0])!;
    expect(n.elapsedMin).toBe(130);
    expect(n.within).toBe(false);
  });

  it('진행 중이면 판정을 미룬다', () => {
    const d = withTimes(undefined);
    const n = buildNote(d, d.deliveries[0])!;
    expect(n.elapsedMin).toBeNull();
    expect(n.within).toBeNull();
  });
});

describe('notesOfSite — 주문 열 건이면 납품서도 열 장', () => {
  it('한 주문의 차량 수만큼 납품서가 나온다', () => {
    const d = db({
      orders: [order({ id: 'o1', code: 'R-0929-001' })],
      deliveries: Array.from({ length: 10 }, (_, i) =>
        delivery({ id: `d${i}`, mixStartAt: at(i * 10) }),
      ),
    });
    expect(notesOfSite(d, 's1')).toHaveLength(10);
  });

  it('다른 현장의 납품서는 섞이지 않는다', () => {
    const d = db({
      orders: [
        order({ id: 'o1', code: 'R-1', siteId: 's1' }),
        order({ id: 'o2', code: 'R-2', siteId: 's9' }),
      ],
      deliveries: [
        delivery({ id: 'd1', mixStartAt: at(0), orderId: 'o1' }),
        delivery({ id: 'd2', mixStartAt: at(0), orderId: 'o2' }),
      ],
    });
    expect(notesOfSite(d, 's1').map((n) => n.deliveryId)).toEqual(['d1']);
  });
});

describe('groupByDay — 현장 사무는 날짜로 센다', () => {
  const twoDays = db({
    orders: [order({ id: 'o1', code: 'R-0929-001' })],
    deliveries: [
      delivery({ id: 'a', mixStartAt: at(0) }), // 9/29 09:00
      delivery({ id: 'b', mixStartAt: at(120) }), // 9/29 11:00
      delivery({ id: 'c', mixStartAt: at(24 * 60) }), // 9/30 09:00
    ],
  });

  it('날짜별로 묶고 최근 날짜를 앞에 둔다', () => {
    const days = groupByDay(notesOfSite(twoDays, 's1'));
    expect(days).toHaveLength(2);
    expect(days[0].notes).toHaveLength(1); // 9/30
    expect(days[1].notes).toHaveLength(2); // 9/29
  });

  it('하루 안에서는 이른 출하가 위로 — 실제 납품 순서다', () => {
    const days = groupByDay(notesOfSite(twoDays, 's1'));
    expect(days[1].notes.map((n) => n.deliveryId)).toEqual(['a', 'b']);
  });

  it('그날 물량을 합산한다', () => {
    const days = groupByDay(notesOfSite(twoDays, 's1'));
    expect(days[1].totalM3).toBe(12); // 6 + 6
  });

  it('제한 초과 장수를 센다', () => {
    const over = db({
      orders: [order({ id: 'o1', code: 'R-1' })],
      deliveries: [
        delivery({ id: 'ok', mixStartAt: at(0), completedAt: at(50) }),
        delivery({ id: 'bad', mixStartAt: at(10), completedAt: at(200) }),
      ],
    });
    expect(groupByDay(notesOfSite(over, 's1'))[0].overCount).toBe(1);
  });

  it('요일을 붙인다 — 2026-09-29 는 화요일', () => {
    expect(dayLabel(T0)).toBe('2026년 9월 29일 (화)');
    expect(dayKey(T0)).toBe('20260929');
  });
});

describe('notesToCsv — 엑셀에서 열린다', () => {
  const one = db({
    orders: [order({ id: 'o1', code: 'R-0929-001' })],
    deliveries: [delivery({ id: 'd1', mixStartAt: at(0), arriveAt: at(40), completedAt: at(55) })],
  });

  it('BOM 으로 시작한다 — 없으면 엑셀이 한글을 깨뜨린다', () => {
    expect(notesToCsv(notesOfSite(one, 's1')).startsWith('﻿')).toBe(true);
  });

  it('머리글과 자료 한 줄이 나온다', () => {
    const lines = notesToCsv(notesOfSite(one, 's1')).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('납품서번호');
    expect(lines[1]).toContain('R-0929-001-01');
    expect(lines[1]).toContain('제한내');
  });

  it('쉼표가 든 값은 따옴표로 감싼다', () => {
    const comma = db({
      orders: [order({ id: 'o1', code: 'R-1' })],
      deliveries: [delivery({ id: 'd1', mixStartAt: at(0) })],
      sites: [{ id: 's1', name: '서천동, 2공구', address: '용인', lat: 37, lng: 127 }],
    });
    expect(notesToCsv(notesOfSite(comma, 's1'))).toContain('"서천동, 2공구"');
  });
});
