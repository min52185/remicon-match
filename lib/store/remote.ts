'use client';

/**
 * Supabase 저장소 — local.ts 와 똑같은 함수 이름·모양을 제공한다.
 * 화면 코드는 둘 중 어느 것이 쓰이는지 모른다 (index.ts 가 고른다).
 *
 * 설계: DB 를 매번 물어보지 않고 **메모리 캐시**를 하나 두고, Realtime 으로
 * 바뀐 것만 통보받아 다시 읽는다. 그래서 useDb() 는 지금까지처럼 동기로 값을 준다.
 * 화면 20여 곳을 async 로 고치지 않아도 된다.
 *
 * 바뀐 행만 골라 캐시에 꽂는 방식(증분 패치)은 쓰지 않았다. 주문 상태 변경이
 * 배송·공장 재고까지 함께 건드려 어긋나기 쉬운데, 시연 규모(행 수백 개)에서는
 * 전체 다시 읽기가 훨씬 안전하고 충분히 빠르다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../supabase/client';
import {
  deliveryInsert,
  favoriteInsert,
  iso,
  orderInsert,
  toDelivery,
  toFavorite,
  toLocation,
  toOrder,
  toPlan,
  toPlanItem,
  toPlant,
  toSite,
  toTruck,
  type AllocationPlanRow,
  type DeliveryRow,
  type FavoriteMixRow,
  type OrderRow,
  type PlanItemRow,
  type PlantRow,
  type PlantStatusRow,
  type SiteRow,
  type TruckLocationRow,
  type TruckRow,
} from '../supabase/mappers';
import { MIN, PourRules, RULES, TRUCK_CAPACITY_M3 } from '../rules';
import { simulatedArrivalAt } from '../services/tracking';
import type {
  AllocationPlan,
  Delivery,
  FavoriteMix,
  Order,
  OrderStatus,
  Plant,
  TruckLocation,
} from '../types';
import { emptyDb, type Db, type DispatchInput, type NewOrder } from './shared';

/* ==========================================================================
 * 캐시와 구독
 * ======================================================================== */

let db: Db = emptyDb();
const listeners = new Set<() => void>();
let started = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const emit = () => listeners.forEach((f) => f());

const SERVER_DB = emptyDb();

export const store = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    start();
    return () => listeners.delete(fn);
  },
  snapshot: (): Db => db,
  serverSnapshot: (): Db => SERVER_DB,
  /** 시연 데이터 비우기 — 공유 DB 라 함부로 지우지 않는다 */
  async reset() {
    console.warn('[store] Supabase 모드에서는 화면에서 데이터를 지우지 않습니다.');
  },
};

/** 여러 변경이 몰릴 때 한 번만 다시 읽는다 */
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, 250);
}

function start() {
  if (started) return;
  const sb = getSupabase();
  if (!sb) return;
  started = true;

  void refresh();

  sb.channel('remicon-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'truck_locations' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plant_status' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_items' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'allocation_plans' }, scheduleRefresh)
    .subscribe();
}

/* ==========================================================================
 * 전체 다시 읽기
 * ======================================================================== */

export async function refresh(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    const [sitesR, plantsR, statusR, trucksR, favR, ordersR, plansR, itemsR, delivR] =
      await Promise.all([
        sb.from('sites').select('*').order('name'),
        sb.from('plants').select('*').order('name'),
        sb.from('plant_status').select('*'),
        sb.from('trucks').select('*').order('no'),
        sb.from('favorite_mixes').select('*'),
        sb.from('orders').select('*').order('created_at', { ascending: false }),
        sb.from('allocation_plans').select('*'),
        sb.from('plan_items').select('*'),
        sb.from('deliveries').select('*').order('mix_start_at'),
      ]);

    const statusByPlant = new Map(
      ((statusR.data ?? []) as PlantStatusRow[]).map((r) => [r.plant_id, r]),
    );
    const plants: Plant[] = ((plantsR.data ?? []) as PlantRow[]).map((r) =>
      toPlant(r, statusByPlant.get(r.id)),
    );
    const plantName = new Map(plants.map((p) => [p.id, p.name]));

    const orders: Order[] = ((ordersR.data ?? []) as OrderRow[]).map(toOrder);
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const itemsByPlan = new Map<string, PlanItemRow[]>();
    for (const it of (itemsR.data ?? []) as PlanItemRow[]) {
      const list = itemsByPlan.get(it.plan_id) ?? [];
      list.push(it);
      itemsByPlan.set(it.plan_id, list);
    }
    const plans: AllocationPlan[] = ((plansR.data ?? []) as AllocationPlanRow[]).map((r) =>
      toPlan(
        r,
        (itemsByPlan.get(r.id) ?? []).map((it) => toPlanItem(it, plantName.get(it.plant_id) ?? '')),
      ),
    );

    const deliveries: Delivery[] = ((delivR.data ?? []) as DeliveryRow[]).map((r) =>
      toDelivery(r, orderById.get(r.order_id)),
    );

    // 위치 기록은 진행 중인 배송 것만 가져온다 — 전부 끌어오면 금방 무거워진다
    const activeIds = deliveries.filter((d) => !d.completedAt).map((d) => d.id);
    let truckLocations: TruckLocation[] = [];
    if (activeIds.length > 0) {
      const locR = await sb
        .from('truck_locations')
        .select('*')
        .in('delivery_id', activeIds)
        .order('recorded_at', { ascending: false })
        .limit(1000);
      truckLocations = ((locR.data ?? []) as TruckLocationRow[]).map(toLocation).reverse();
    }

    db = {
      sites: ((sitesR.data ?? []) as SiteRow[]).map(toSite),
      plants,
      trucks: ((trucksR.data ?? []) as TruckRow[]).map((r) => toTruck(r)),
      favoriteMixes: ((favR.data ?? []) as FavoriteMixRow[]).map(toFavorite),
      orders,
      plans,
      deliveries,
      truckLocations,
      orderSeq: orders.length + 1,
      loaded: true,
    };
    emit();
  } catch (e) {
    console.warn('[store] 데이터를 읽지 못했습니다.', e);
  }
}

const client = (): SupabaseClient => {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase 가 설정되지 않았습니다.');
  return sb;
};

const myId = async (sb: SupabaseClient) => (await sb.auth.getUser()).data.user?.id ?? null;

/* ==========================================================================
 * 공장 출하 현황
 * ======================================================================== */

export async function updatePlantStatus(
  plantId: string,
  patch: Partial<Pick<Plant, 'availableTrucks' | 'availableVolume' | 'isOpen'>>,
) {
  const sb = client();
  const row: Record<string, unknown> = { plant_id: plantId, updated_at: new Date().toISOString() };
  if (patch.availableTrucks !== undefined) row.available_trucks = patch.availableTrucks;
  if (patch.availableVolume !== undefined) row.available_volume = patch.availableVolume;
  if (patch.isOpen !== undefined) row.is_open = patch.isOpen;
  const { error } = await sb.from('plant_status').upsert(row, { onConflict: 'plant_id' });
  if (error) throw error;
  await refresh();
}

/* ==========================================================================
 * 즐겨찾기
 * ======================================================================== */

export async function saveFavorite(fav: Omit<FavoriteMix, 'id' | 'useCount' | 'createdAt'>) {
  const sb = client();
  const { error } = await sb.from('favorite_mixes').insert(favoriteInsert(fav, await myId(sb)));
  if (error) throw error;
  await refresh();
  return '';
}

export async function deleteFavorite(id: string) {
  const sb = client();
  const { error } = await sb.from('favorite_mixes').delete().eq('id', id);
  if (error) throw error;
  await refresh();
}

export async function bumpFavorite(id: string) {
  const sb = client();
  const current = db.favoriteMixes.find((f) => f.id === id);
  const { error } = await sb
    .from('favorite_mixes')
    .update({ use_count: (current?.useCount ?? 0) + 1 })
    .eq('id', id);
  if (error) throw error;
  await refresh();
}

/* ==========================================================================
 * 주문
 * ======================================================================== */

const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * 주문번호. RLS 때문에 내가 볼 수 있는 주문만 세어지므로 다른 회사와 번호가
 * 겹칠 수 있다. code 에 unique 제약이 걸려 있으니, 충돌하면 번호를 올려 다시 시도한다.
 */
async function nextCode(sb: SupabaseClient, offset = 0): Promise<string> {
  const d = new Date();
  const prefix = `R-${p2(d.getMonth() + 1)}${p2(d.getDate())}-`;
  const { count } = await sb
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .like('code', `${prefix}%`);
  return prefix + String((count ?? 0) + 1 + offset).padStart(3, '0');
}

const isDuplicate = (e: { code?: string } | null) => e?.code === '23505';

export async function createOrder(input: NewOrder): Promise<Order> {
  const sb = client();
  const uid = await myId(sb);

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = await nextCode(sb, attempt);
    const { data, error } = await sb
      .from('orders')
      .insert(orderInsert({ ...input, code, status: 'requested' }, uid))
      .select('*')
      .single<OrderRow>();

    if (!error && data) {
      await refresh();
      return toOrder(data);
    }
    if (!isDuplicate(error)) throw error;
  }
  throw new Error('주문번호를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

export async function createOrdersFromPlan(
  plan: AllocationPlan,
  base: Omit<NewOrder, 'plantId' | 'volumeM3' | 'planId'>,
): Promise<Order[]> {
  const sb = client();
  const uid = await myId(sb);

  // 계획 → 항목 → 공장별 주문 순서로 넣는다 (외래키 때문에 순서가 중요하다)
  const { data: planRow, error: planErr } = await sb
    .from('allocation_plans')
    .insert({
      site_id: plan.siteId,
      total_volume_m3: plan.totalVolumeM3,
      pour_start_at: iso(plan.pourStartAt),
      pump_rate: plan.pumpRate,
      temp_c: plan.tempC,
      summary: plan.summary,
      created_by: uid,
    })
    .select('id')
    .single<{ id: string }>();
  if (planErr || !planRow) throw planErr;

  const { error: itemErr } = await sb.from('plan_items').insert(
    plan.items.map((i) => ({
      plan_id: planRow.id,
      plant_id: i.plantId,
      trucks: i.trucks,
      travel_minutes: i.travelMinutes,
      rounds: i.rounds,
      mix_start_ats: i.mixStartAts.map(iso),
    })),
  );
  if (itemErr) throw itemErr;

  const created: Order[] = [];
  for (const item of plan.items) {
    created.push(
      await createOrder({
        ...base,
        plantId: item.plantId,
        volumeM3: item.trucks * TRUCK_CAPACITY_M3,
        planId: planRow.id,
      }),
    );
  }

  await refresh();
  return created;
}

export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  rejectReason?: string,
) {
  const sb = client();
  const { error } = await sb
    .from('orders')
    .update({ status, reject_reason: rejectReason ?? null })
    .eq('id', orderId);
  if (error) throw error;
  await refresh();
}

/* ==========================================================================
 * 배차 · 배송
 * ======================================================================== */

export async function dispatchTruck(input: DispatchInput): Promise<Delivery> {
  const sb = client();
  const prep = input.prepMinutes ?? RULES.DEFAULT_PREP_MIN;
  const departAt = input.mixStartAt + prep * MIN;
  const etaInitialAt = departAt + input.travelMinutes * MIN;
  const limitMinutes = PourRules.limitMinutes(input.order.tempC);
  const simSeed = input.simulate === false ? undefined : `s${Date.now().toString(36)}`;

  const draft = {
    orderId: input.order.id,
    truckId: input.truckId,
    volumeM3: input.volumeM3,
    mixStartAt: input.mixStartAt,
    departAt,
    etaInitialAt,
    etaCurrentAt: etaInitialAt,
    // 가짜 차량이면 '실제' 도착 시각을 지금 정해 둔다 (교통 흐름 곡선 기준)
    arriveAt: simSeed ? simulatedArrivalAt(simSeed, departAt, input.travelMinutes) : undefined,
    completedAt: undefined,
    limitMinutes,
    travelMinutes: input.travelMinutes,
    distanceKm: input.distanceKm,
    path: input.path,
    delayReason: undefined,
    simSeed,
  };

  const { data, error } = await sb
    .from('deliveries')
    .insert(deliveryInsert(draft))
    .select('*')
    .single<DeliveryRow>();
  if (error || !data) throw error;

  // 출하하면 주문은 '납품 중'이 되고, 공장 재고가 줄어든다
  if (input.order.status === 'accepted') {
    await sb.from('orders').update({ status: 'delivering' }).eq('id', input.order.id);
  }
  const plant = db.plants.find((p) => p.id === input.order.plantId);
  if (plant) {
    await sb
      .from('plant_status')
      .update({
        available_trucks: Math.max(0, plant.availableTrucks - 1),
        available_volume: Math.max(0, plant.availableVolume - input.volumeM3),
        updated_at: new Date().toISOString(),
      })
      .eq('plant_id', plant.id);
  }

  await refresh();
  return toDelivery(data, input.order);
}

export async function updateEta(deliveryId: string, etaCurrentAt: number, delayReason?: string) {
  const sb = client();
  const patch: Record<string, unknown> = { eta_current_at: iso(etaCurrentAt) };
  if (delayReason) patch.delay_reason = delayReason;
  const { error } = await sb.from('deliveries').update(patch).eq('id', deliveryId);
  if (error) throw error;
  // ETA 는 1분마다 갱신된다. 매번 전체를 다시 읽으면 낭비라 Realtime 통보에 맡긴다.
}

export async function markArrived(deliveryId: string, at: number) {
  const sb = client();
  const { error } = await sb
    .from('deliveries')
    .update({ arrive_at: iso(at), eta_current_at: iso(at) })
    .eq('id', deliveryId);
  if (error) throw error;
  await refresh();
}

export async function markCompleted(deliveryId: string, at: number) {
  const sb = client();
  const d = db.deliveries.find((x) => x.id === deliveryId);

  const { error } = await sb
    .from('deliveries')
    .update({ completed_at: iso(at), arrive_at: iso(d?.arriveAt ?? at) })
    .eq('id', deliveryId);
  if (error) throw error;

  if (d) {
    const order = db.orders.find((o) => o.id === d.orderId);
    if (order) {
      const poured =
        db.deliveries
          .filter((x) => x.orderId === order.id && x.completedAt)
          .reduce((s, x) => s + x.volumeM3, 0) + d.volumeM3;
      if (poured >= order.volumeM3) {
        await sb.from('orders').update({ status: 'completed' }).eq('id', order.id);
      }
    }
    // 차량이 공장으로 돌아가 다시 출하 가능해진다
    const plant = db.plants.find((p) => p.id === d.plantId);
    if (plant) {
      await sb
        .from('plant_status')
        .update({ available_trucks: plant.availableTrucks + 1, updated_at: new Date().toISOString() })
        .eq('plant_id', plant.id);
    }
  }

  await refresh();
}

/* ==========================================================================
 * GPS
 * ======================================================================== */

export async function pushLocation(loc: TruckLocation) {
  const sb = client();
  const { error } = await sb.from('truck_locations').insert({
    delivery_id: loc.deliveryId,
    lat: loc.lat,
    lng: loc.lng,
    speed_kmh: loc.speedKmh ?? null,
    heading: loc.heading ?? null,
    recorded_at: iso(loc.recordedAt),
  });
  if (error) throw error;
  // 위치는 10~15초마다 들어온다. 현장 화면은 Realtime 으로 받는다.
}
