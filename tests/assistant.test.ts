/**
 * 레캉쌤 — 숫자는 앱이 계산하고, 키가 없으면 정해진 문장으로 답한다.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSiteContext,
  classify,
  contextBlock,
  followUps,
  GENERAL_STARTERS,
  offlineAnswer,
  SITE_STARTERS,
  templateAnswer,
  type SiteContext,
} from '../lib/ai/assistant';
import { MIN, RULES, TRUCK_CAPACITY_M3 } from '../lib/rules';
import { emptyDb, type Db } from '../lib/store/shared';
import type { Delivery, Order, Plant, Site } from '../lib/types';

/** 2026-10-03 09:00 */
const T0 = new Date(2026, 9, 3, 9, 0, 0).getTime();
const at = (min: number) => T0 + min * MIN;

const SITE: Site = { id: 's1', name: '서천동 현장', address: '', lat: 37.23, lng: 127.07 };

const plant = (id: string, lat: number, extra: Partial<Plant> = {}): Plant => ({
  id,
  name: `${id} 공장`,
  address: '',
  phone: '',
  lat,
  lng: 127.07,
  fleetSize: 5,
  availableTrucks: 3,
  availableVolume: 60,
  hourlyRate: 4,
  prepMinutes: 10,
  isOpen: true,
  cap: { maxStrength: { 보통: 35 }, aggs: [25], flow: false, cements: [] },
  ...extra,
});

const ORDER: Order = {
  id: 'o1',
  code: 'R-1003-001',
  siteId: 's1',
  plantId: 'near',
  spec: {
    type: '보통',
    aggMm: 25,
    strength: 24,
    slumpKind: 'slump',
    slumpMm: 150,
    cement: '보통 포틀랜드 시멘트 (1종)',
  },
  volumeM3: 12,
  pourStartAt: at(40),
  pumpRate: 40,
  status: 'delivering',
  tempC: 20,
  createdAt: at(-60),
};

const delivery = (p: Partial<Delivery> & { id: string }): Delivery => ({
  orderId: 'o1',
  truckId: 't1',
  plantId: 'near',
  siteId: 's1',
  volumeM3: TRUCK_CAPACITY_M3,
  mixStartAt: at(0),
  departAt: at(5),
  etaInitialAt: at(40),
  etaCurrentAt: at(40),
  limitMinutes: 120,
  limitAt: at(120),
  travelMinutes: 35,
  path: [],
  distanceKm: 20,
  ...p,
});

const db = (over: Partial<Db> = {}): Db => ({
  ...emptyDb(),
  loaded: true,
  sites: [SITE],
  plants: [plant('near', 37.24), plant('far', 37.6), plant('closed', 37.231, { isOpen: false })],
  trucks: [{ id: 't1', plantId: 'near', no: 3, plateNo: '경기 80바 1234', driver: '김기사', capacityM3: 6 }],
  orders: [ORDER],
  ...over,
});

describe('질문 종류 가리기', () => {
  it.each([
    ['아까 주문한 거 왜 안 와요', 'delivery'],
    ['레미콘 언제 들어와', 'delivery'],
    ['차 어디쯤이야', 'delivery'],
    ['3호차 언제 도착해요?', 'truck'],
    ['3 호차 어디야', 'truck'],
    ['주문 수락됐어?', 'order'],
    ['주문 어떻게 됐어', 'order'],
    ['지금 근처 공장들 어때?', 'plants'],
    ['가까운 업체 추천해줘', 'plants'],
    ['급처 매물 있어?', 'surplus'],
    ['싼 레미콘 없나', 'surplus'],
    ['콜드조인트 괜찮아요?', 'pour'],
    ['타설 끊길 것 같아?', 'pour'],
    ['콜드조인트가 뭐예요', 'faq'],
    ['슬럼프가 뭐예요', 'faq'],
    ['급처가 뭐야', 'faq'],
    ['주문 어떻게 해요?', 'faq'],
    ['슬럼프', 'faq'],
    ['안녕하세요', 'smalltalk'],
    ['고마워요', 'smalltalk'],
    ['오늘 점심 뭐 먹지', 'general'],
  ])('%s → %s', (q, intent) => {
    expect(classify(q)).toBe(intent);
  });
});

describe('이어서 물어볼 질문', () => {
  const site: SiteContext = {
    site: '서천동 현장',
    now: '09:00',
    tempC: 20,
    limitMinutes: 120,
    orders: [],
    deliveries: [],
    pours: [],
    plants: [],
    surplus: [],
  };
  const SITE_INTENTS = ['truck', 'order', 'delivery', 'pour', 'surplus', 'plants'];

  /** 지금까지 나올 수 있는 질문 전부 — 추천을 따라가며 모은다 */
  function reachable(c: SiteContext | null) {
    const seen = new Set<string>();
    const queue = [...(c ? SITE_STARTERS : GENERAL_STARTERS), '슬럼프', '안녕', '점심 뭐 먹지'];
    while (queue.length > 0) {
      const q = queue.shift()!;
      if (seen.has(q)) continue;
      seen.add(q);
      queue.push(...followUps(q, c));
    }
    return seen;
  }

  it('추천 질문은 누르면 반드시 알아듣는 질문이다 — "답하기 어려워요"가 나오지 않는다', () => {
    for (const c of [site, null]) {
      for (const q of reachable(c)) {
        for (const next of followUps(q, c)) {
          expect(classify(next), `${q} → ${next}`).not.toBe('general');
        }
      }
    }
  });

  it('현장이 없으면 내 현장 질문을 권하지 않는다', () => {
    for (const q of reachable(null)) {
      for (const next of followUps(q, null)) {
        expect(SITE_INTENTS, `${q} → ${next}`).not.toContain(classify(next));
      }
    }
  });

  it('방금 한 질문을 다시 권하지 않고, 많아야 3개다', () => {
    const next = followUps('급처 매물 있어?', site);
    expect(next).not.toContain('급처 매물 있어?');
    expect(next.length).toBeLessThanOrEqual(3);
    expect(next.length).toBeGreaterThan(0);
  });

  it('오는 차가 있으면 그 차를 콕 집어 묻게 한다', () => {
    const withTruck: SiteContext = {
      ...site,
      deliveries: [
        {
          truck: '3호차',
          plant: '',
          spec: '',
          phase: '운반 중',
          eta: '09:20',
          etaInMin: 20,
          remainingKm: 9,
          delay: '',
          delayMin: 0,
          limitSlackMin: 60,
          limitMinutes: 120,
          level: 'ok',
        },
      ],
    };
    expect(followUps('왜 안 와요', withTruck)).toContain('3호차 어디야?');
  });

  it('지식 질문 다음에는 관련 지식을 권한다', () => {
    expect(followUps('슬럼프가 뭐예요?', null)).toContain('슬럼프 플로가 뭐야?');
    expect(followUps('콜드조인트가 뭐야?', site)).toContain('콜드조인트 괜찮아?');
  });
});

describe('키 없이 답하기', () => {
  const ctx = (over: Partial<SiteContext> = {}): SiteContext => ({
    site: '서천동 현장',
    now: '09:00',
    tempC: 20,
    limitMinutes: 120,
    orders: [],
    deliveries: [],
    pours: [],
    plants: [],
    surplus: [],
    ...over,
  });

  it('일반 지식은 현장이 없어도(첫 화면) 답한다 — 숫자는 규칙 파일 값', () => {
    expect(offlineAnswer('제한시간이 뭐예요?', null)).toContain(`${RULES.LIMIT_HOT_MIN}분`);
    expect(offlineAnswer('규격 읽는 법 알려줘', null)).toContain('25-24-150');
  });

  it('내 배송 질문은 첫 화면에서 현장으로 안내한다', () => {
    expect(offlineAnswer('왜 안 와요', null)).toContain('현장 화면');
  });

  it('특정 호차를 물으면 그 차만 답한다', () => {
    const fact = {
      plant: '가온',
      spec: '',
      phase: '운반 중',
      eta: '09:20',
      etaInMin: 20,
      remainingKm: 9,
      delay: '처음 예상대로',
      delayMin: 0,
      limitSlackMin: 60,
      limitMinutes: 120,
      level: 'ok' as const,
    };
    const c = ctx({
      deliveries: [
        { ...fact, truck: '1호차' },
        { ...fact, truck: '3호차', eta: '09:40', etaInMin: 40 },
      ],
    });
    const text = offlineAnswer('3호차 어디야', c);
    expect(text).toContain('3호차');
    expect(text).toContain('09:40');
    expect(text).not.toContain('1호차');
    expect(offlineAnswer('7호차 어디야', c)).toContain('7호차는 없어요');
  });

  it('주문 상태를 화면 문구 그대로 말한다', () => {
    const c = ctx({
      orders: [{ code: 'R-1003-001', plant: '가온', status: '수락 대기', volumeM3: 12, pourStart: '10:00' }],
    });
    expect(offlineAnswer('주문 수락됐어?', c)).toContain("'수락 대기'");
  });

  it('오는 차가 없으면 기다리는 주문이 있는지 같이 말한다', () => {
    const c = ctx({
      orders: [{ code: 'R-1003-001', plant: '가온', status: '출하 대기', volumeM3: 12, pourStart: '10:00' }],
    });
    expect(offlineAnswer('왜 안 와요', c)).toContain('R-1003-001');
  });

  it('못 알아들으면 물어볼 수 있는 예시를 준다', () => {
    expect(offlineAnswer('오늘 점심 뭐 먹지', ctx())).toContain('왜 안 와요');
  });
});

describe('현장 상황 요약', () => {
  it('도착한 차는 남은 거리 0, 굳기 전 여유를 분으로 낸다', () => {
    const d = db({ deliveries: [delivery({ id: 'd1', arriveAt: at(38) })] });
    const c = buildSiteContext(d, SITE, at(45), 20);
    expect(c.deliveries).toHaveLength(1);
    expect(c.deliveries[0]).toMatchObject({
      truck: '3호차',
      phase: '현장 도착',
      etaInMin: 0,
      remainingKm: 0,
      limitSlackMin: 75,
    });
  });

  it('끝난 배송과 다른 현장 배송은 넣지 않는다', () => {
    const d = db({
      deliveries: [
        delivery({ id: 'done', completedAt: at(50), arriveAt: at(38) }),
        delivery({ id: 'other', siteId: 's2' }),
      ],
    });
    expect(buildSiteContext(d, SITE, at(60), 20).deliveries).toHaveLength(0);
  });

  it('근처 공장은 가까운 순이다', () => {
    const c = buildSiteContext(db(), SITE, at(0), 20);
    expect(c.plants[0].travelMin).toBeLessThanOrEqual(c.plants[1].travelMin);
    expect(c.plants.map((p) => p.name)).toContain('far 공장');
  });

  it('기온을 모르면 제한시간도 비워 둔다 — 짐작하지 않는다', () => {
    expect(buildSiteContext(db(), SITE, at(0), null).limitMinutes).toBeNull();
    expect(buildSiteContext(db(), SITE, at(0), 27).limitMinutes).toBe(90);
  });

  it('Claude 에 넘길 때는 JSON 그대로 감싼다', () => {
    const c = buildSiteContext(db(), SITE, at(0), 20);
    expect(contextBlock(c)).toContain('"site":"서천동 현장"');
    expect(contextBlock(null)).toContain('첫 화면');
  });
});

describe('키가 없을 때의 답', () => {
  const base: SiteContext = {
    site: '서천동 현장',
    now: '09:00',
    tempC: 20,
    limitMinutes: 120,
    orders: [],
    deliveries: [],
    pours: [],
    plants: [],
    surplus: [],
  };

  it('오는 차가 없으면 그렇다고 말한다', () => {
    expect(templateAnswer('delivery', base)).toContain('오고 있는 차가 없어요');
  });

  it('오는 차의 거리·도착·여유를 숫자 그대로 말한다', () => {
    const text = templateAnswer('delivery', {
      ...base,
      deliveries: [
        {
          truck: '3호차',
          plant: '가온레미콘',
          spec: '보통 25-24-150',
          phase: '운반 중',
          eta: '09:06',
          etaInMin: 6,
          remainingKm: 0.8,
          delay: '처음 예상보다 4분 늦음',
          delayMin: 4,
          delayReason: '영동고속 정체',
          limitSlackMin: 62,
          limitMinutes: 120,
          level: 'ok',
        },
      ],
    });
    expect(text).toContain('800m');
    expect(text).toContain('6분 뒤 09:06');
    expect(text).toContain('62분 여유');
    expect(text).toContain('영동고속 정체 때문에 처음 예상보다 4분 늦어졌어요');
  });

  it('제한시간을 넘길 것 같으면 공장에 연락하라고 한다', () => {
    const text = templateAnswer('delivery', {
      ...base,
      deliveries: [
        {
          truck: '1호차',
          plant: '',
          spec: '',
          phase: '운반 중',
          eta: '10:00',
          etaInMin: 30,
          remainingKm: 12,
          delay: '처음 예상보다 25분 늦음',
          delayMin: 25,
          limitSlackMin: -8,
          limitMinutes: 90,
          level: 'bad',
        },
      ],
    });
    expect(text).toContain('8분 넘길');
    expect(text).toContain('연락');
  });

  it('공장 추천은 문 연, 차 남은, 제시간 공장 중 가장 가까운 곳', () => {
    const text = templateAnswer('plants', {
      ...base,
      plants: [
        { name: '닫은 공장', travelMin: 5, availableTrucks: 3, isOpen: false, inTime: true },
        { name: '가온', travelMin: 12, availableTrucks: 2, isOpen: true, inTime: true },
        { name: '누리', travelMin: 20, availableTrucks: 4, isOpen: true, inTime: true },
      ],
    });
    expect(text).toContain('가장 가까운 건 가온');
    expect(text).not.toContain('닫은 공장');
    expect(text).toContain('누리(20분) 순이에요');
  });

  it('급처 매물은 제시간에 올 수 있는 것만 권한다', () => {
    const text = templateAnswer('surplus', {
      ...base,
      surplus: [
        {
          plant: '가온',
          spec: '보통 25-24-150',
          volumeM3: 6,
          unitPrice: 72000,
          normalPrice: 90000,
          discountPct: 20,
          arrive: '09:30',
          slackMin: 40,
          reachable: true,
        },
      ],
    });
    expect(text).toContain('72,000원');
    expect(text).toContain('20% 할인');
    expect(templateAnswer('surplus', base)).toContain('없어요');
  });
});
