/**
 * 데이터 저장소.
 *
 * 지금은 브라우저 localStorage 에 담고, 같은 브라우저의 다른 탭에는 storage 이벤트로 알린다.
 * (현장 탭 / 공장 탭 / 기사 탭을 나란히 띄워 놓고 시연할 수 있다.)
 *
 * 지시서 9-A 대로 Supabase 는 뒤로 미룬다. 옮길 때는 이 파일의 함수 시그니처를 그대로 두고
 * 내부만 supabase 호출로 바꾸면 된다. 테이블 이름은 지시서 4장과 맞춰 두었고,
 * SQL 은 supabase/migrations/0001_init.sql 에 이미 있다.
 *
 * ⚠ 브라우저 저장소이므로 다른 휴대폰끼리는 공유되지 않는다. 화면에도 그렇게 표시한다.
 */

'use client';

import { MIN, PourRules, TRUCK_CAPACITY_M3, RULES } from '../rules';
import { simulatedArrivalAt } from '../services/tracking';
import type {
  AllocationPlan,
  Delivery,
  FavoriteMix,
  Order,
  OrderStatus,
  Plant,
  Site,
  Truck,
  TruckLocation,
} from '../types';
import { SEED_PLANTS, SEED_SITES, SEED_TRUCKS } from './seed';

const KEY = 'remicon.db.v1';

export interface Db {
  sites: Site[];
  plants: Plant[];
  trucks: Truck[];
  favoriteMixes: FavoriteMix[];
  orders: Order[];
  plans: AllocationPlan[];
  deliveries: Delivery[];
  truckLocations: TruckLocation[];
  /** 주문번호 채번 */
  orderSeq: number;
}

const emptyDb = (): Db => ({
  sites: SEED_SITES,
  plants: SEED_PLANTS,
  trucks: SEED_TRUCKS,
  favoriteMixes: [],
  orders: [],
  plans: [],
  deliveries: [],
  truckLocations: [],
  orderSeq: 1,
});

/* ==========================================================================
 * 저장·구독
 * ======================================================================== */

let db: Db = emptyDb();
let hydrated = false;
const listeners = new Set<() => void>();

function load(): Db {
  if (typeof window === 'undefined') return emptyDb();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw) as Partial<Db>;
    // 공장·현장·차량은 항상 코드의 최신 seed 를 쓴다(생산 능력 표가 바뀔 수 있으므로),
    // 다만 공장이 직접 입력한 출하 현황은 저장된 값을 살린다.
    const savedStatus = new Map(
      (parsed.plants ?? []).map((p) => [
        p.id,
        { availableTrucks: p.availableTrucks, availableVolume: p.availableVolume, isOpen: p.isOpen },
      ]),
    );
    return {
      ...emptyDb(),
      ...parsed,
      sites: SEED_SITES,
      trucks: SEED_TRUCKS,
      plants: SEED_PLANTS.map((p) => ({ ...p, ...(savedStatus.get(p.id) ?? {}) })),
    };
  } catch {
    return emptyDb();
  }
}

function ensureHydrated() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  db = load();
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    db = load();
    emit();
  });
}

function emit() {
  listeners.forEach((f) => f());
}

function commit(next: Db) {
  db = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 용량 초과 등 — 메모리로만 동작 */
  }
  emit();
}

const update = (fn: (d: Db) => Db) => {
  ensureHydrated();
  commit(fn(db));
};

export const store = {
  subscribe(fn: () => void) {
    ensureHydrated();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  snapshot(): Db {
    ensureHydrated();
    return db;
  },
  /** SSR 에서는 seed 만 있는 상태를 돌려준다 (hydration 불일치 방지) */
  serverSnapshot(): Db {
    return SERVER_DB;
  },
  reset() {
    ensureHydrated();
    commit(emptyDb());
  },
};

const SERVER_DB = emptyDb();

/* ==========================================================================
 * 조회
 * ======================================================================== */

export const getSite = (d: Db, id: string) => d.sites.find((s) => s.id === id);
export const getPlant = (d: Db, id: string) => d.plants.find((p) => p.id === id);
export const getTruck = (d: Db, id: string) => d.trucks.find((t) => t.id === id);
export const getOrder = (d: Db, id: string) => d.orders.find((o) => o.id === id);

export const ordersOfSite = (d: Db, siteId: string) =>
  d.orders.filter((o) => o.siteId === siteId).sort((a, b) => b.createdAt - a.createdAt);

export const ordersOfPlant = (d: Db, plantId: string) =>
  d.orders.filter((o) => o.plantId === plantId).sort((a, b) => b.createdAt - a.createdAt);

export const deliveriesOfOrder = (d: Db, orderId: string) =>
  d.deliveries.filter((x) => x.orderId === orderId).sort((a, b) => a.mixStartAt - b.mixStartAt);

export const deliveriesOfSite = (d: Db, siteId: string) =>
  d.deliveries.filter((x) => x.siteId === siteId).sort((a, b) => a.mixStartAt - b.mixStartAt);

export const deliveriesOfPlant = (d: Db, plantId: string) =>
  d.deliveries.filter((x) => x.plantId === plantId).sort((a, b) => a.mixStartAt - b.mixStartAt);

export const activeDeliveriesOfPlant = (d: Db, plantId: string) =>
  deliveriesOfPlant(d, plantId).filter((x) => !x.completedAt);

export const favoritesOfSite = (d: Db, siteId: string) =>
  d.favoriteMixes
    .filter((f) => f.siteId === siteId)
    .sort((a, b) => b.useCount - a.useCount || b.createdAt - a.createdAt);

/* ==========================================================================
 * 쓰기 — 공장 출하 현황
 * ======================================================================== */

export function updatePlantStatus(
  plantId: string,
  patch: Partial<Pick<Plant, 'availableTrucks' | 'availableVolume' | 'isOpen'>>,
) {
  update((d) => ({
    ...d,
    plants: d.plants.map((p) => (p.id === plantId ? { ...p, ...patch } : p)),
  }));
}

/* ==========================================================================
 * 쓰기 — 즐겨찾기 (지시서 5장 ★)
 * ======================================================================== */

export function saveFavorite(fav: Omit<FavoriteMix, 'id' | 'useCount' | 'createdAt'>) {
  const id = `f${Date.now().toString(36)}`;
  update((d) => ({
    ...d,
    favoriteMixes: [...d.favoriteMixes, { ...fav, id, useCount: 0, createdAt: Date.now() }],
  }));
  return id;
}

export function deleteFavorite(id: string) {
  update((d) => ({ ...d, favoriteMixes: d.favoriteMixes.filter((f) => f.id !== id) }));
}

export function bumpFavorite(id: string) {
  update((d) => ({
    ...d,
    favoriteMixes: d.favoriteMixes.map((f) => (f.id === id ? { ...f, useCount: f.useCount + 1 } : f)),
  }));
}

/* ==========================================================================
 * 쓰기 — 주문
 * ======================================================================== */

export type NewOrder = Omit<Order, 'id' | 'code' | 'status' | 'createdAt'>;

export function createOrder(input: NewOrder): Order {
  ensureHydrated();
  const seq = db.orderSeq;
  const d = new Date();
  const code = `R-${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(seq).padStart(3, '0')}`;
  const order: Order = {
    ...input,
    id: `o${Date.now().toString(36)}${seq}`,
    code,
    status: 'requested',
    createdAt: Date.now(),
  };
  commit({ ...db, orders: [...db.orders, order], orderSeq: seq + 1 });
  return order;
}

/** AI 배분 결과를 공장별 주문으로 한 번에 보낸다 */
export function createOrdersFromPlan(plan: AllocationPlan, base: Omit<NewOrder, 'plantId' | 'volumeM3' | 'planId'>) {
  ensureHydrated();
  let seq = db.orderSeq;
  const d = new Date();
  const orders: Order[] = plan.items.map((item, i) => {
    const code = `R-${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(seq + i).padStart(3, '0')}`;
    return {
      ...base,
      id: `o${Date.now().toString(36)}${seq + i}`,
      code,
      plantId: item.plantId,
      volumeM3: item.trucks * TRUCK_CAPACITY_M3,
      planId: plan.id,
      status: 'requested' as OrderStatus,
      createdAt: Date.now(),
    };
  });
  seq += plan.items.length;
  commit({ ...db, plans: [...db.plans, plan], orders: [...db.orders, ...orders], orderSeq: seq });
  return orders;
}

export function setOrderStatus(orderId: string, status: OrderStatus, rejectReason?: string) {
  update((d) => ({
    ...d,
    orders: d.orders.map((o) => (o.id === orderId ? { ...o, status, rejectReason } : o)),
  }));
}

/* ==========================================================================
 * 쓰기 — 배차 · 배송
 * ======================================================================== */

export interface DispatchInput {
  order: Order;
  truckId: string;
  /** 계획 이동시간(분) */
  travelMinutes: number;
  distanceKm: number;
  path: [number, number][];
  /** 실을 물량 */
  volumeM3: number;
  /** 비비기 시작 시각 */
  mixStartAt: number;
  prepMinutes?: number;
  /** 시연용 가짜 차량이면 true — 도착 시각을 미리 정해 둔다 */
  simulate?: boolean;
}

/** 공장이 '출하 지시'를 누르면 납품서 한 장이 만들어진다 */
export function dispatchTruck(input: DispatchInput): Delivery {
  ensureHydrated();
  const prep = input.prepMinutes ?? RULES.DEFAULT_PREP_MIN;
  const departAt = input.mixStartAt + prep * MIN;
  const etaInitialAt = departAt + input.travelMinutes * MIN;
  const limitMinutes = PourRules.limitMinutes(input.order.tempC);
  const id = `d${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

  const delivery: Delivery = {
    id,
    orderId: input.order.id,
    truckId: input.truckId,
    plantId: input.order.plantId,
    siteId: input.order.siteId,
    volumeM3: input.volumeM3,
    mixStartAt: input.mixStartAt,
    departAt,
    etaInitialAt,
    etaCurrentAt: etaInitialAt,
    limitMinutes,
    limitAt: input.mixStartAt + limitMinutes * MIN,
    travelMinutes: input.travelMinutes,
    distanceKm: input.distanceKm,
    path: input.path,
    simSeed: input.simulate === false ? undefined : id,
  };

  // 가짜 차량이면 "실제" 도착 시각을 지금 정한다 (교통 흐름 곡선 기준)
  if (delivery.simSeed) {
    delivery.arriveAt = simulatedArrivalAt(delivery.simSeed, departAt, input.travelMinutes);
  }

  const orders = db.orders.map((o) =>
    o.id === input.order.id && o.status === 'accepted' ? { ...o, status: 'delivering' as OrderStatus } : o,
  );
  const plants = db.plants.map((p) =>
    p.id === input.order.plantId
      ? {
          ...p,
          availableTrucks: Math.max(0, p.availableTrucks - 1),
          availableVolume: Math.max(0, p.availableVolume - input.volumeM3),
        }
      : p,
  );

  commit({ ...db, deliveries: [...db.deliveries, delivery], orders, plants });
  return delivery;
}

/** 1분마다 다시 계산한 ETA 를 반영한다 */
export function updateEta(deliveryId: string, etaCurrentAt: number, delayReason?: string) {
  update((d) => ({
    ...d,
    deliveries: d.deliveries.map((x) =>
      x.id === deliveryId ? { ...x, etaCurrentAt, delayReason: delayReason ?? x.delayReason } : x,
    ),
  }));
}

export function markArrived(deliveryId: string, at: number) {
  update((d) => ({
    ...d,
    deliveries: d.deliveries.map((x) =>
      x.id === deliveryId ? { ...x, arriveAt: at, etaCurrentAt: at } : x,
    ),
  }));
}

/** 하역·타설 완료 — 납품서가 확정된다 */
export function markCompleted(deliveryId: string, at: number) {
  ensureHydrated();
  const deliveries = db.deliveries.map((x) =>
    x.id === deliveryId ? { ...x, completedAt: at, arriveAt: x.arriveAt ?? at } : x,
  );

  // 주문의 전 물량이 타설되면 주문도 완료 처리
  const done = deliveries.find((x) => x.id === deliveryId);
  let orders = db.orders;
  if (done) {
    const order = db.orders.find((o) => o.id === done.orderId);
    if (order) {
      const poured = deliveries
        .filter((x) => x.orderId === order.id && x.completedAt)
        .reduce((s, x) => s + x.volumeM3, 0);
      if (poured >= order.volumeM3) {
        orders = db.orders.map((o) => (o.id === order.id ? { ...o, status: 'completed' as OrderStatus } : o));
      }
    }
  }

  // 차량이 공장으로 돌아가 다시 출하 가능해진다
  const plants = done
    ? db.plants.map((p) => (p.id === done.plantId ? { ...p, availableTrucks: p.availableTrucks + 1 } : p))
    : db.plants;

  commit({ ...db, deliveries, orders, plants });
}

/* ==========================================================================
 * 쓰기 — GPS 기록
 * 지시서 4장: truck_locations 는 버리지 않는다. 지연 예측 학습 데이터가 된다.
 * ======================================================================== */

export function pushLocation(loc: TruckLocation) {
  update((d) => ({
    ...d,
    // 브라우저 저장소 용량 때문에 배송당 최근 500건만 남긴다.
    // Supabase 로 옮기면 전부 보관한다.
    truckLocations: [...d.truckLocations, loc].slice(-5000),
  }));
}

export const locationsOfDelivery = (d: Db, deliveryId: string) =>
  d.truckLocations.filter((l) => l.deliveryId === deliveryId);
