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
  toSurplus,
  toTruck,
  surplusInsert,
  type SurplusRow,
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
  SurplusListing,
  Truck,
  TruckLocation,
} from '../types';
import {
  emptyDb,
  SurplusGoneError,
  type Db,
  type DispatchInput,
  type NewOrder,
  type NewPlant,
  type NewSite,
  type NewSurplus,
  type NewTruck,
} from './shared';

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

  /*
   * 세션이 붙기 전에 읽으면 PostgREST 가 요청을 익명으로 보고, RLS 가 0건을 돌려준다.
   * 그러면 "내 소속에 등록된 현장이 없습니다" 가 뜬 채로 영영 복구되지 않는다 —
   * Realtime 은 데이터가 바뀔 때만 알려 주므로 다시 읽을 계기가 없기 때문이다.
   * 그래서 (1) 세션이 확정된 뒤에 처음 읽고 (2) 로그인·토큰 갱신 때마다 다시 읽는다.
   */
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      db = emptyDb();
      emit();
      return;
    }
    scheduleRefresh();
  });

  void sb.auth.getSession().then(() => refresh());

  sb.channel('remicon-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'truck_locations' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plant_status' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_items' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'allocation_plans' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'surplus_listings' }, scheduleRefresh)
    .subscribe();
}

/* ==========================================================================
 * 전체 다시 읽기
 * ======================================================================== */

export async function refresh(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    const [sitesR, plantsR, statusR, trucksR, favR, ordersR, plansR, itemsR, delivR, peopleR] =
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
        // 기사 이름·사진. 0004 이전에는 내 것만 읽혀서 '배정됨' 으로만 보였다.
        // RLS 가 같은 회사까지만 열어 주므로, 남의 회사 기사는 여기 안 담긴다.
        sb.from('profiles').select('id, name, photo_path'),
      ]);

    // 급처 매물은 0012 이후에 생긴 표라 따로 읽는다 — 아직 SQL 을 안 돌린 DB 에서도
    // 나머지 화면은 그대로 돌아야 한다. 표가 없으면 빈 목록으로 둔다.
    const surplusR = await sb.from('surplus_listings').select('*').order('created_at', {
      ascending: false,
    });
    const surplus: SurplusListing[] = surplusR.error
      ? []
      : ((surplusR.data ?? []) as SurplusRow[]).map(toSurplus);

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

    const people = new Map(
      ((peopleR.data ?? []) as { id: string; name: string; photo_path: string | null }[]).map(
        (r) => [r.id, r.name],
      ),
    );
    const facePaths = new Map(
      ((peopleR.data ?? []) as { id: string; photo_path: string | null }[])
        .filter((r) => r.photo_path)
        .map((r) => [r.id, r.photo_path as string]),
    );

    db = {
      sites: ((sitesR.data ?? []) as SiteRow[]).map(toSite),
      plants,
      trucks: ((trucksR.data ?? []) as TruckRow[]).map((r) =>
        toTruck(
          r,
          r.driver_id ? people.get(r.driver_id) : undefined,
          r.driver_id ? facePaths.get(r.driver_id) : undefined,
        ),
      ),
      favoriteMixes: ((favR.data ?? []) as FavoriteMixRow[]).map(toFavorite),
      orders,
      plans,
      deliveries,
      truckLocations,
      surplus,
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
 * 급처 매물
 * ======================================================================== */

export async function createSurplus(input: NewSurplus): Promise<SurplusListing> {
  const sb = client();
  const { data, error } = await sb
    .from('surplus_listings')
    .insert(surplusInsert(input, await myId(sb)))
    .select('*')
    .single<SurplusRow>();
  if (error) throw error;
  await refresh();
  return toSurplus(data);
}

export async function withdrawSurplus(listingId: string) {
  const sb = client();
  const { error } = await sb
    .from('surplus_listings')
    .update({ status: 'withdrawn' })
    .eq('id', listingId)
    .eq('status', 'open');
  if (error) throw error;
  await refresh();
}

/**
 * 현장이 매물을 가져간다.
 *
 * 잠그는 일은 DB 함수 claim_surplus 가 한다(0012). 현장은 남의 회사 매물 행을
 * 직접 고칠 권한이 없고, 두 현장이 동시에 눌러도 한 곳만 가져가야 해서다.
 * 잠근 뒤에 주문을 보낸다 — 주문이 먼저 가면 못 가져간 현장의 주문이 남는다.
 */
export async function claimSurplus(
  listingId: string,
  _siteId: string,
  order: NewOrder,
  _now: number,
): Promise<Order> {
  const sb = client();
  const { data, error } = await sb.rpc('claim_surplus', { listing_id: listingId });
  if (error) throw error;
  if (!data) throw new SurplusGoneError();
  return createOrder(order);
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

/* ==========================================================================
 * 기사 ↔ 차량 배정
 * 기사가 비어 있는 차를 자기 앞으로 가져간다. RLS 가 "빈 차 또는 내 차"만
 * 허용하므로, 남이 몰고 있는 차를 가로챌 수는 없다.
 * ======================================================================== */

export async function claimTruck(truckId: string) {
  const sb = client();
  const uid = await myId(sb);
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { error } = await sb.from('trucks').update({ driver_id: uid }).eq('id', truckId);
  if (error) throw error;
  await refresh();
}

export async function releaseTruck(truckId: string) {
  const sb = client();
  const { error } = await sb.from('trucks').update({ driver_id: null }).eq('id', truckId);
  if (error) throw error;
  await refresh();
}

/* ==========================================================================
 * 등록 — 현장·공장·차량
 *
 * 소속 회사는 받지 않고 내 프로필에서 읽는다. 폼에서 받으면 남의 회사에
 * 현장을 끼워 넣을 수 있다 — RLS 도 막지만, 애초에 보내지 않는 편이 낫다.
 * ======================================================================== */

/** 내 소속 회사. 없으면 등록할 수 없다 (가입할 때 회사를 골라야 한다). */
async function myCompanyId(sb: SupabaseClient): Promise<string> {
  const uid = await myId(sb);
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { data, error } = await sb
    .from('profiles')
    .select('company_id')
    .eq('id', uid)
    .single<{ company_id: string | null }>();
  if (error) throw error;
  if (!data?.company_id) throw new Error('소속 회사가 없습니다. 로그인 후 회사를 골라 주세요.');
  return data.company_id;
}

export async function createSite(input: NewSite): Promise<string> {
  const sb = client();
  const companyId = await myCompanyId(sb);

  const { data, error } = await sb
    .from('sites')
    .insert({
      company_id: companyId,
      name: input.name,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      access_note: input.accessNote ?? null,
    })
    .select('id')
    .single<{ id: string }>();
  if (error) throw error;

  await refresh();
  return data.id;
}

export async function createPlant(input: NewPlant): Promise<string> {
  const sb = client();
  const companyId = await myCompanyId(sb);

  const { data, error } = await sb
    .from('plants')
    .insert({
      company_id: companyId,
      name: input.name,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      phone: input.phone || null,
      capability: input.cap,
      fleet_size: input.fleetSize,
      hourly_rate: input.hourlyRate,
      prep_minutes: input.prepMinutes,
    })
    .select('id')
    .single<{ id: string }>();
  if (error) throw error;

  // 출하 현황 행을 같이 만든다. 없으면 현장 화면에서 '출하 여력 없음' 으로만 보이고
  // 공장이 값을 적을 곳도 없다.
  const { error: statusErr } = await sb.from('plant_status').insert({
    plant_id: data.id,
    available_trucks: 0,
    available_volume: 0,
    is_open: false,
    updated_at: new Date().toISOString(),
  });
  if (statusErr) throw statusErr;

  await refresh();
  return data.id;
}

export async function updatePlantInfo(
  plantId: string,
  patch: Partial<
    Pick<
      Plant,
      'name' | 'address' | 'phone' | 'lat' | 'lng' | 'fleetSize' | 'hourlyRate' | 'prepMinutes' | 'cap'
    >
  >,
) {
  const sb = client();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.address !== undefined) row.address = patch.address;
  if (patch.phone !== undefined) row.phone = patch.phone || null;
  if (patch.lat !== undefined) row.lat = patch.lat;
  if (patch.lng !== undefined) row.lng = patch.lng;
  if (patch.fleetSize !== undefined) row.fleet_size = patch.fleetSize;
  if (patch.hourlyRate !== undefined) row.hourly_rate = patch.hourlyRate;
  if (patch.prepMinutes !== undefined) row.prep_minutes = patch.prepMinutes;
  if (patch.cap !== undefined) row.capability = patch.cap;

  const { error } = await sb.from('plants').update(row).eq('id', plantId);
  if (error) throw error;
  await refresh();
}

export async function createTruck(input: NewTruck): Promise<string> {
  const sb = client();
  const uid = await myId(sb);

  // 호차 번호는 그 공장에서 쓰지 않은 가장 작은 수 (unique(plant_id, no) 제약이 있다)
  const used = new Set(db.trucks.filter((t) => t.plantId === input.plantId).map((t) => t.no));
  let no = 1;
  while (used.has(no)) no += 1;

  const { data, error } = await sb
    .from('trucks')
    .insert({
      plant_id: input.plantId,
      no,
      plate_no: input.plateNo,
      capacity_m3: input.capacityM3,
      driver_id: input.claim ? uid : null,
    })
    .select('id')
    .single<{ id: string }>();
  if (error) throw error;

  await refresh();
  return data.id;
}

/** 기사가 올린 납품서 사진 경로를 배송에 붙인다 */
export async function saveNotePhoto(deliveryId: string, notePhotoPath: string | undefined) {
  const sb = client();
  const { error } = await sb
    .from('deliveries')
    .update({ note_photo_path: notePhotoPath ?? null })
    .eq('id', deliveryId);
  if (error) throw error;
  await refresh();
}

/** 차량 정보 고치기 — 차량번호·적재량 */
export async function updateTruck(
  truckId: string,
  patch: Partial<Pick<Truck, 'plateNo' | 'capacityM3'>>,
) {
  const sb = client();
  const row: Record<string, unknown> = {};
  if (patch.plateNo !== undefined) row.plate_no = patch.plateNo;
  if (patch.capacityM3 !== undefined) row.capacity_m3 = patch.capacityM3;

  const { error } = await sb.from('trucks').update(row).eq('id', truckId);
  if (error) throw error;
  await refresh();
}

/**
 * 차량 지우기.
 * deliveries.truck_id 가 on delete restrict 라, 운행 기록이 있으면 DB 가 막는다.
 * 그 오류를 사람이 읽을 수 있는 말로 바꿔 준다.
 */
export async function deleteTruck(truckId: string) {
  const sb = client();
  const truck = db.trucks.find((t) => t.id === truckId);
  if (truck?.driverId) {
    throw new Error('기사가 맡고 있는 차량입니다. 반납 후에 지울 수 있습니다.');
  }

  const { error } = await sb.from('trucks').delete().eq('id', truckId);
  if (error) {
    if (error.code === '23503') {
      throw new Error('운행 기록이 있는 차량은 지울 수 없습니다.');
    }
    throw error;
  }
  await refresh();
}
