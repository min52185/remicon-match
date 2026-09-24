/**
 * 두 저장소 구현(local.ts · remote.ts)이 함께 쓰는 타입과 조회 함수.
 *
 * 조회는 전부 순수 함수다 — 캐시로 받은 Db 하나만 보고 답한다.
 * 그래서 브라우저 저장소를 쓰든 Supabase 를 쓰든 화면 코드가 똑같다.
 */

import type {
  AllocationPlan,
  Delivery,
  FavoriteMix,
  Order,
  Plant,
  Site,
  Truck,
  TruckLocation,
} from '../types';

export interface Db {
  sites: Site[];
  plants: Plant[];
  trucks: Truck[];
  favoriteMixes: FavoriteMix[];
  orders: Order[];
  plans: AllocationPlan[];
  deliveries: Delivery[];
  truckLocations: TruckLocation[];
  /** 주문번호 채번용 */
  orderSeq: number;
  /** 처음 읽기가 끝났는가 — Supabase 모드에서 '불러오는 중'을 구분하려고 둔다 */
  loaded: boolean;
}

export const emptyDb = (): Db => ({
  sites: [],
  plants: [],
  trucks: [],
  favoriteMixes: [],
  orders: [],
  plans: [],
  deliveries: [],
  truckLocations: [],
  orderSeq: 1,
  loaded: false,
});

export type NewOrder = Omit<Order, 'id' | 'code' | 'status' | 'createdAt'>;

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

export const locationsOfDelivery = (d: Db, deliveryId: string) =>
  d.truckLocations.filter((l) => l.deliveryId === deliveryId);
