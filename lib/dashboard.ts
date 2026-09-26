/**
 * 현황판이 쓰는 집계 — 화면과 떼어 놓은 순수 함수만 둔다.
 *
 * 화면 컴포넌트 안에 계산을 두면 테스트를 못 쓴다. 숫자가 틀리면 현장이
 * 잘못된 판단을 하는 화면이라, 규칙(lib/rules.ts)·배분(lib/ai)과 같은 수준으로
 * 검증해야 한다 (CLAUDE.md: 기능을 만들면 테스트도 만든다).
 *
 * 여기 있는 함수는 Db 스냅샷 하나만 보고 답한다. 저장소가 브라우저든
 * Supabase 든 상관없다.
 */

import { intervalMinutes } from './ai/allocate';
import { MIN, TRUCK_CAPACITY_M3, UNLOAD_EST_MIN } from './rules';
import type { Db } from './store/shared';
import type { Delivery, Order } from './types';

/* ==========================================================================
 * 하루 구간
 * ======================================================================== */

export interface DayRange {
  start: number;
  end: number;
}

/** 시연 시계 기준 하루의 시작~끝 */
export function dayRange(now: number): DayRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return { start: start.getTime(), end: start.getTime() + 24 * 60 * MIN };
}

export const isWithin = (at: number, r: DayRange) => at >= r.start && at < r.end;

/* ==========================================================================
 * 현장 — 오늘 주문
 * ======================================================================== */

/**
 * 오늘로 칠 주문.
 * 타설 예정이 오늘이거나, 오늘 넣은 주문이다. 거절·취소는 뺀다.
 *
 * 둘 다 보는 이유 — 내일 새벽 타설을 오늘 밤에 주문하는 일이 흔하고(그날 넣은 주문),
 * 어제 넣어 둔 주문으로 오늘 타설하는 일도 흔하다(그날 타설).
 */
export function todaysOrders(orders: Order[], siteId: string, day: DayRange): Order[] {
  return orders.filter(
    (o) =>
      o.siteId === siteId &&
      o.status !== 'rejected' &&
      o.status !== 'cancelled' &&
      (isWithin(o.pourStartAt, day) || isWithin(o.createdAt, day)),
  );
}

/* ==========================================================================
 * 공장 — 출하 리듬
 * ======================================================================== */

export interface ShipmentRhythm {
  /** 비비기 시작 순으로 정렬한 오늘 출하 */
  sorted: Delivery[];
  /** 마지막 비비기 시작 시각 */
  lastMixStartAt: number | null;
  /** 마지막 출하로부터 지난 시간(분) */
  sinceLastMin: number | null;
  /** 오늘 출하 간격의 평균(분). 두 대 이상 나가야 잴 수 있다. */
  avgGapMin: number | null;
}

export function shipmentRhythm(today: Delivery[], now: number): ShipmentRhythm {
  const sorted = today.slice().sort((a, b) => a.mixStartAt - b.mixStartAt);
  const last = sorted[sorted.length - 1] ?? null;

  const gaps = sorted
    .slice(1)
    .map((d, i) => Math.round((d.mixStartAt - sorted[i].mixStartAt) / MIN));

  return {
    sorted,
    lastMixStartAt: last?.mixStartAt ?? null,
    sinceLastMin: last ? Math.round((now - last.mixStartAt) / MIN) : null,
    avgGapMin: gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
  };
}

export interface TargetInterval {
  minutes: number;
  /** 'plan' 은 AI 배분 시각표, 'pump' 는 펌프 속도로만 어림한 값 */
  source: 'plan' | 'pump';
}

/**
 * 이 공장이 지켜야 할 출하 간격.
 *
 * AI 배분으로 짠 주문이면 그 시각표의 회차 간격이 정답이다 — 이 공장 몫만 뽑아
 * 만든 표라, 현장 전체 간격(펌프 속도 기준)보다 길다. 예를 들어 6분마다 한 대가
 * 들어가야 하는 현장에 세 공장이 나눠 대면 공장 하나는 18분마다 한 대면 된다.
 * 계획이 없는 주문이면 펌프 속도로만 어림한다 — 그 공장이 혼자 다 댄다고 본 값이라
 * 실제보다 짧게 나온다.
 */
export function targetInterval(db: Db, plantId: string, orders: Order[]): TargetInterval | null {
  for (const o of orders) {
    const item = db.plans.find((p) => p.id === o.planId)?.items.find((i) => i.plantId === plantId);
    const ats = item?.mixStartAts.slice().sort((a, b) => a - b) ?? [];
    if (ats.length >= 2) {
      return { minutes: Math.round((ats[1] - ats[0]) / MIN), source: 'plan' };
    }
  }
  const first = orders[0];
  if (!first) return null;
  return { minutes: Math.round(intervalMinutes(first.pumpRate)), source: 'pump' };
}

/* ==========================================================================
 * 공장 — 출하 예정 차량
 * ======================================================================== */

export interface UpcomingSlot {
  key: string;
  /** 권장 비비기 시작 시각 */
  at: number;
  /** 이 주문에서 몇 번째 차인가 (1부터) */
  round: number;
  orderId: string;
  orderCode: string;
  siteName: string;
}

export interface UnplannedOrder {
  orderId: string;
  orderCode: string;
  siteName: string;
  /** 아직 안 내보낸 대수 */
  trucksLeft: number;
}

export interface Upcoming {
  slots: UpcomingSlot[];
  /** AI 배분 없이 들어와 시각표가 없는 주문 */
  unplanned: UnplannedOrder[];
}

/**
 * 아직 안 내보낸 회차.
 * AI 배분 시각표에서 이미 출하한 만큼을 잘라 낸 나머지다.
 */
export function upcomingShipments(db: Db, plantId: string, orders: Order[]): Upcoming {
  const slots: UpcomingSlot[] = [];
  const unplanned: UnplannedOrder[] = [];

  for (const o of orders) {
    const sent = db.deliveries.filter((d) => d.orderId === o.id && d.plantId === plantId);
    const siteName = db.sites.find((s) => s.id === o.siteId)?.name ?? '';
    const item = db.plans.find((p) => p.id === o.planId)?.items.find((i) => i.plantId === plantId);
    const ats = item?.mixStartAts.slice().sort((a, b) => a - b) ?? [];

    if (ats.length === 0) {
      const sentM3 = sent.reduce((s, d) => s + d.volumeM3, 0);
      const trucksLeft = Math.ceil(Math.max(0, o.volumeM3 - sentM3) / TRUCK_CAPACITY_M3);
      if (trucksLeft > 0) {
        unplanned.push({ orderId: o.id, orderCode: o.code, siteName, trucksLeft });
      }
      continue;
    }

    ats.slice(sent.length).forEach((at, i) => {
      slots.push({
        key: `${o.id}-${sent.length + i}`,
        at,
        round: sent.length + i + 1,
        orderId: o.id,
        orderCode: o.code,
        siteName,
      });
    });
  }

  slots.sort((a, b) => a.at - b.at);
  return { slots, unplanned };
}

/* ==========================================================================
 * 공장 — 현장별 주문량
 * ======================================================================== */

export interface SiteDemand {
  siteId: string;
  name: string;
  orderCount: number;
  volumeM3: number;
  /** 이 공장이 이미 내보낸 물량 */
  sentM3: number;
  leftM3: number;
  /** 가장 이른 타설 시작 예정 */
  nextPourAt: number;
}

/** 타설이 이른 현장부터 */
export function demandBySite(db: Db, plantId: string, orders: Order[]): SiteDemand[] {
  const rows = new Map<string, SiteDemand>();

  for (const o of orders) {
    const sentM3 = db.deliveries
      .filter((d) => d.orderId === o.id && d.plantId === plantId)
      .reduce((s, d) => s + d.volumeM3, 0);

    const row = rows.get(o.siteId) ?? {
      siteId: o.siteId,
      name: db.sites.find((s) => s.id === o.siteId)?.name ?? '알 수 없는 현장',
      orderCount: 0,
      volumeM3: 0,
      sentM3: 0,
      leftM3: 0,
      nextPourAt: o.pourStartAt,
    };

    row.orderCount += 1;
    row.volumeM3 += o.volumeM3;
    row.sentM3 += sentM3;
    row.leftM3 = Math.max(0, row.volumeM3 - row.sentM3);
    row.nextPourAt = Math.min(row.nextPourAt, o.pourStartAt);
    rows.set(o.siteId, row);
  }

  return [...rows.values()].sort((a, b) => a.nextPourAt - b.nextPourAt);
}

/* ==========================================================================
 * 기사 — 현장 도착 대기
 * ======================================================================== */

export interface SiteQueue {
  /** 내 앞에 있는 차 — 이미 현장에 있는 차 + 나보다 먼저 도착할 차 */
  ahead: number;
  /** 그중 지금 현장에 서 있는 차 */
  aheadOnSite: number;
  /** 내가 하역을 시작할 수 있는 예상 시각 */
  unloadStartAt: number;
  /** 도착하고 나서 기다려야 하는 시간(분). 0이면 바로 붓는다. */
  waitMin: number;
}

/**
 * 현장에 도착했을 때 바로 부을 수 있는지.
 *
 * 펌프카는 한 대씩만 받는다. 그래서 앞차가 다 부을 때까지 줄을 선다 —
 * 기사가 현장 앞에서 40분씩 서 있는 일이 실제로 흔하고, 그 사이에도
 * 비비기~타설 제한시간은 계속 흐른다.
 *
 * 앞차 하역이 끝나는 시각을 차례로 쌓아, 내 차례가 언제 오는지 계산한다.
 * 하역 시간은 UNLOAD_EST_MIN 추정치다 — 실제 기록이 쌓이면 고친다.
 */
export function siteQueue(db: Db, mine: Delivery, now: number): SiteQueue {
  const others = db.deliveries.filter(
    (d) => d.siteId === mine.siteId && d.id !== mine.id && !d.completedAt,
  );

  // 이미 현장에 서 있는 차 — 도착 순서대로 붓는다
  const onSite = others
    .filter((d) => d.arriveAt != null && d.arriveAt <= now)
    .sort((a, b) => a.arriveAt! - b.arriveAt!);

  // 나보다 먼저 도착할 차
  const inboundAhead = others
    .filter((d) => (d.arriveAt == null || d.arriveAt > now) && d.etaCurrentAt < mine.etaCurrentAt)
    .sort((a, b) => a.etaCurrentAt - b.etaCurrentAt);

  const unloadMs = UNLOAD_EST_MIN * MIN;

  // 앞차들이 차례로 붓고 나면 펌프가 언제 비는가.
  // 이미 현장에 있는 차는 도착한 때부터 부어 왔다 — 지금부터 재면 그만큼 밀려 나온다.
  let freeAt = 0;
  for (const d of onSite) freeAt = Math.max(freeAt, d.arriveAt!) + unloadMs;

  // 아직 '타설 완료'를 안 누른 차가 현장에 있으면, 추정 하역시간이 지났더라도
  // 펌프는 지금 비어 있지 않다. 눌러야 비는 것으로 본다.
  if (onSite.length > 0) freeAt = Math.max(freeAt, now);

  for (const d of inboundAhead) freeAt = Math.max(freeAt, d.etaCurrentAt) + unloadMs;

  const unloadStartAt = Math.max(mine.etaCurrentAt, freeAt);

  return {
    ahead: onSite.length + inboundAhead.length,
    aheadOnSite: onSite.length,
    unloadStartAt,
    waitMin: Math.max(0, Math.round((unloadStartAt - mine.etaCurrentAt) / MIN)),
  };
}
