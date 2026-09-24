'use client';

/**
 * 저장소 진입점.
 *
 * Supabase 키가 있으면 remote(공유 DB), 없으면 local(브라우저 저장소)을 쓴다.
 * 화면 코드는 여기서만 가져다 쓰므로 어느 쪽인지 알 필요가 없다.
 *
 * 지시서 9-A 의 "시그니처는 유지하고 내부만 교체" 를 그대로 따른 것이다.
 * 조원이 키 없이 코드를 받아도 앱이 돌고, 키를 넣으면 여러 기기가 같은 자료를 본다.
 */

import { isSupabaseConfigured } from '../supabase/client';
import * as local from './local';
import * as remote from './remote';

const backend = isSupabaseConfigured ? remote : local;

/** 지금 어느 저장소로 도는지 — 화면에 표시해 준다 */
export const storeMode: 'supabase' | 'local' = isSupabaseConfigured ? 'supabase' : 'local';

/* ── 공통 타입·조회 (순수 함수라 구현과 무관) ── */
export type { Db, DispatchInput, NewOrder } from './shared';
export {
  activeDeliveriesOfPlant,
  deliveriesOfOrder,
  deliveriesOfPlant,
  deliveriesOfSite,
  favoritesOfSite,
  getOrder,
  getPlant,
  getSite,
  getTruck,
  locationsOfDelivery,
  ordersOfPlant,
  ordersOfSite,
} from './shared';

/* ── 구독 ── */
export const store = backend.store;

/* ── 쓰기 ── */
export const updatePlantStatus = backend.updatePlantStatus;
export const saveFavorite = backend.saveFavorite;
export const deleteFavorite = backend.deleteFavorite;
export const bumpFavorite = backend.bumpFavorite;
export const createOrder = backend.createOrder;
export const createOrdersFromPlan = backend.createOrdersFromPlan;
export const setOrderStatus = backend.setOrderStatus;
export const dispatchTruck = backend.dispatchTruck;
export const updateEta = backend.updateEta;
export const markArrived = backend.markArrived;
export const markCompleted = backend.markCompleted;
export const pushLocation = backend.pushLocation;
