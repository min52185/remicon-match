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
  SurplusListing,
  Truck,
  TruckLocation,
} from '../types';
import { isLive } from '../surplus';
import { SEED_PLANTS, SEED_SITES, SEED_TRUCKS } from './seed';
import {
  emptyDb as blankDb,
  SurplusGoneError,
  type Db,
  type DispatchInput,
  type NewOrder,
  type NewPlant,
  type NewSite,
  type NewSurplus,
  type NewTruck,
} from './shared';

const KEY = 'remicon.db.v1';


const emptyDb = (): Db => ({
  ...blankDb(),
  sites: SEED_SITES,
  plants: SEED_PLANTS,
  trucks: SEED_TRUCKS,
  loaded: true,
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
        {
          availableTrucks: p.availableTrucks,
          availableVolume: p.availableVolume,
          isOpen: p.isOpen,
          updatedAt: p.updatedAt,
        },
      ]),
    );
    /**
     * 시연 데이터는 코드의 최신 seed 를 쓰되(생산 능력 표가 바뀔 수 있다),
     * 사용자가 직접 등록한 현장·공장·차량은 지우지 않는다.
     * seed 에 없는 id 면 사용자가 만든 것이다.
     */
    const seedIds = {
      sites: new Set(SEED_SITES.map((x) => x.id)),
      plants: new Set(SEED_PLANTS.map((x) => x.id)),
      trucks: new Set(SEED_TRUCKS.map((x) => x.id)),
    };
    const mine = {
      sites: (parsed.sites ?? []).filter((x) => !seedIds.sites.has(x.id)),
      plants: (parsed.plants ?? []).filter((x) => !seedIds.plants.has(x.id)),
      trucks: (parsed.trucks ?? []).filter((x) => !seedIds.trucks.has(x.id)),
    };

    return {
      ...emptyDb(),
      ...parsed,
      sites: [...SEED_SITES, ...mine.sites],
      trucks: [...SEED_TRUCKS, ...mine.trucks],
      plants: [
        ...SEED_PLANTS.map((p) => ({ ...p, ...(savedStatus.get(p.id) ?? {}) })),
        ...mine.plants,
      ],
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

/* ==========================================================================
 * 쓰기 — 공장 출하 현황
 * ======================================================================== */

export async function updatePlantStatus(
  plantId: string,
  patch: Partial<Pick<Plant, 'availableTrucks' | 'availableVolume' | 'isOpen'>>,
) {
  update((d) => ({
    ...d,
    plants: d.plants.map((p) =>
      p.id === plantId ? { ...p, ...patch, updatedAt: Date.now() } : p,
    ),
  }));
}

/* ==========================================================================
 * 쓰기 — 즐겨찾기 (지시서 5장 ★)
 * ======================================================================== */

export async function saveFavorite(fav: Omit<FavoriteMix, 'id' | 'useCount' | 'createdAt'>) {
  const id = `f${Date.now().toString(36)}`;
  update((d) => ({
    ...d,
    favoriteMixes: [...d.favoriteMixes, { ...fav, id, useCount: 0, createdAt: Date.now() }],
  }));
  return id;
}

export async function deleteFavorite(id: string) {
  update((d) => ({ ...d, favoriteMixes: d.favoriteMixes.filter((f) => f.id !== id) }));
}

export async function bumpFavorite(id: string) {
  update((d) => ({
    ...d,
    favoriteMixes: d.favoriteMixes.map((f) => (f.id === id ? { ...f, useCount: f.useCount + 1 } : f)),
  }));
}

/* ==========================================================================
 * 쓰기 — 주문
 * ======================================================================== */


export async function createOrder(input: NewOrder): Promise<Order> {
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
export async function createOrdersFromPlan(plan: AllocationPlan, base: Omit<NewOrder, 'plantId' | 'volumeM3' | 'planId'>) {
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

export async function setOrderStatus(orderId: string, status: OrderStatus, rejectReason?: string) {
  update((d) => ({
    ...d,
    orders: d.orders.map((o) => (o.id === orderId ? { ...o, status, rejectReason } : o)),
  }));
}

/* ==========================================================================
 * 쓰기 — 배차 · 배송
 * ======================================================================== */


/** 공장이 '출하 지시'를 누르면 납품서 한 장이 만들어진다 */
export async function dispatchTruck(input: DispatchInput): Promise<Delivery> {
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
    initialSlumpMm: input.initialSlumpMm,
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
          updatedAt: Date.now(),
        }
      : p,
  );

  commit({ ...db, deliveries: [...db.deliveries, delivery], orders, plants });
  return delivery;
}

/** 기사가 올린 납품서 사진 경로를 배송에 붙인다 */
export async function saveNotePhoto(deliveryId: string, notePhotoPath: string | undefined) {
  update((d) => ({
    ...d,
    deliveries: d.deliveries.map((x) => (x.id === deliveryId ? { ...x, notePhotoPath } : x)),
  }));
}

/** 1분마다 다시 계산한 ETA 를 반영한다 */
export async function updateEta(deliveryId: string, etaCurrentAt: number, delayReason?: string) {
  update((d) => ({
    ...d,
    deliveries: d.deliveries.map((x) =>
      x.id === deliveryId ? { ...x, etaCurrentAt, delayReason: delayReason ?? x.delayReason } : x,
    ),
  }));
}

export async function markArrived(deliveryId: string, at: number) {
  update((d) => ({
    ...d,
    deliveries: d.deliveries.map((x) =>
      x.id === deliveryId ? { ...x, arriveAt: at, etaCurrentAt: at } : x,
    ),
  }));
}

/** 하역·타설 완료 — 납품서가 확정된다 */
export async function markCompleted(deliveryId: string, at: number) {
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

export async function pushLocation(loc: TruckLocation) {
  update((d) => ({
    ...d,
    // 브라우저 저장소 용량 때문에 배송당 최근 500건만 남긴다.
    // Supabase 로 옮기면 전부 보관한다.
    truckLocations: [...d.truckLocations, loc].slice(-5000),
  }));
}


/* ==========================================================================
 * 쓰기 — 급처 매물
 * ======================================================================== */

export async function createSurplus(input: NewSurplus): Promise<SurplusListing> {
  ensureHydrated();
  const listing: SurplusListing = {
    ...input,
    id: `L${Date.now().toString(36)}`,
    status: 'open',
    createdAt: Date.now(),
  };
  commit({ ...db, surplus: [...db.surplus, listing] });
  return listing;
}

/** 공장이 매물을 내린다 — 가져간 뒤에는 못 내린다 */
export async function withdrawSurplus(listingId: string) {
  update((d) => ({
    ...d,
    surplus: d.surplus.map((l) =>
      l.id === listingId && l.status === 'open' ? { ...l, status: 'withdrawn' } : l,
    ),
  }));
}

/**
 * 현장이 매물을 가져간다 — 매물을 잠그고, 그 공장으로 주문을 보낸다.
 * 두 현장이 같은 매물을 동시에 누르면 먼저 잠근 쪽만 가져간다.
 */
export async function claimSurplus(
  listingId: string,
  siteId: string,
  order: NewOrder,
  now: number,
): Promise<Order> {
  ensureHydrated();
  const listing = db.surplus.find((l) => l.id === listingId);
  if (!listing || !isLive(listing, now)) throw new SurplusGoneError();

  commit({
    ...db,
    surplus: db.surplus.map((l) =>
      l.id === listingId
        ? { ...l, status: 'claimed', claimedSiteId: siteId, claimedAt: Date.now() }
        : l,
    ),
  });
  return createOrder(order);
}

/* ==========================================================================
 * 기사 ↔ 차량 배정 (시연 모드)
 * 로그인이 없으므로 'demo' 라는 한 사람이 차를 맡는 것으로 둔다.
 * ======================================================================== */

export async function claimTruck(truckId: string) {
  update((d) => ({
    ...d,
    trucks: d.trucks.map((t) => (t.id === truckId ? { ...t, driverId: 'demo' } : t)),
  }));
}

export async function releaseTruck(truckId: string) {
  update((d) => ({
    ...d,
    trucks: d.trucks.map((t) => (t.id === truckId ? { ...t, driverId: undefined } : t)),
  }));
}

/* ==========================================================================
 * 쓰기 — 등록
 *
 * 브라우저 저장소 모드에서는 소속 회사가 없다(로그인이 없다). 등록한 자료는
 * companyId 없이 저장되고, RoleShells 가 '소속 없는 것은 누구나 본다'로
 * 다루므로 시연에 지장이 없다.
 * ======================================================================== */

export async function createSite(input: NewSite): Promise<string> {
  ensureHydrated();
  const id = `s${Date.now().toString(36)}`;
  commit({ ...db, sites: [...db.sites, { ...input, id }] });
  return id;
}

export async function createPlant(input: NewPlant): Promise<string> {
  ensureHydrated();
  const id = `p${Date.now().toString(36)}`;
  const plant: Plant = {
    ...input,
    id,
    // 등록 직후에는 아직 아무것도 못 내보낸다. 공장이 출하 현황에서 채운다.
    availableTrucks: 0,
    availableVolume: 0,
    isOpen: false,
    updatedAt: Date.now(),
  };
  commit({ ...db, plants: [...db.plants, plant] });
  return id;
}

/** 공장 정보·생산 능력 고치기 (출하 현황과 달리 자주 바뀌지 않는 값) */
export async function updatePlantInfo(
  plantId: string,
  patch: Partial<
    Pick<
      Plant,
      'name' | 'address' | 'phone' | 'lat' | 'lng' | 'fleetSize' | 'hourlyRate' | 'prepMinutes' | 'cap'
    >
  >,
) {
  update((d) => ({
    ...d,
    plants: d.plants.map((p) => (p.id === plantId ? { ...p, ...patch } : p)),
  }));
}

/** 시연 모드에는 로그인이 없다 — 내 차로 가져가면 이 id 를 쓴다 */
const DEMO_DRIVER_ID = 'demo-driver';

export async function createTruck(input: NewTruck): Promise<string> {
  ensureHydrated();
  const id = `t${Date.now().toString(36)}`;
  // 호차 번호는 그 공장에서 쓰지 않은 가장 작은 수로 자동 부여한다
  const used = new Set(db.trucks.filter((t) => t.plantId === input.plantId).map((t) => t.no));
  let no = 1;
  while (used.has(no)) no += 1;

  const truck: Truck = {
    id,
    plantId: input.plantId,
    no,
    plateNo: input.plateNo,
    driver: input.claim ? '배정됨' : '미배정',
    driverId: input.claim ? DEMO_DRIVER_ID : undefined,
    capacityM3: input.capacityM3,
  };
  commit({ ...db, trucks: [...db.trucks, truck] });
  return id;
}

/** 차량 정보 고치기 — 차량번호·적재량 */
export async function updateTruck(
  truckId: string,
  patch: Partial<Pick<Truck, 'plateNo' | 'capacityM3'>>,
) {
  update((d) => ({
    ...d,
    trucks: d.trucks.map((t) => (t.id === truckId ? { ...t, ...patch } : t)),
  }));
}

/**
 * 차량 지우기.
 * 운행 기록(배송)이 있는 차는 지우지 않는다 — 지난 납품서가 어느 차로 갔는지
 * 알 수 없게 된다. 기사가 맡고 있는 차도 막는다.
 */
export async function deleteTruck(truckId: string) {
  ensureHydrated();
  const truck = db.trucks.find((t) => t.id === truckId);
  if (!truck) return;
  if (truck.driverId) throw new Error('기사가 맡고 있는 차량입니다. 반납 후에 지울 수 있습니다.');
  if (db.deliveries.some((d) => d.truckId === truckId)) {
    throw new Error('운행 기록이 있는 차량은 지울 수 없습니다.');
  }
  commit({ ...db, trucks: db.trucks.filter((t) => t.id !== truckId) });
}
