/**
 * DB 행 ↔ 앱 타입 변환.
 *
 * DB 는 snake_case 에 시각은 ISO 문자열, 앱은 camelCase 에 시각은 epoch ms 다.
 * 두 세계가 만나는 지점을 이 파일 하나로 모아, 화면 코드가 DB 모양을 몰라도 되게 한다.
 *
 * 앱 타입에는 있는데 DB 에는 없는 값(예: delivery.plantId)은 주문에서 끌어와 채운다.
 * DB 에 중복 저장하지 않고 유도하는 편이 어긋날 여지가 없다.
 */

import { MIN } from '../rules';
import type {
  AllocationItem,
  AllocationPlan,
  Delivery,
  FavoriteMix,
  Order,
  OrderStatus,
  Plant,
  PlantCapability,
  Site,
  Spec,
  Truck,
  TruckLocation,
} from '../types';

const ms = (v: string | null | undefined): number | undefined =>
  v ? new Date(v).getTime() : undefined;
const msReq = (v: string): number => new Date(v).getTime();
export const iso = (v: number): string => new Date(v).toISOString();

/* ==========================================================================
 * DB 행 타입 — 0001_init.sql 의 컬럼과 1:1
 * ======================================================================== */

export interface SiteRow {
  id: string;
  company_id: string | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  access_note: string | null;
}

export interface PlantRow {
  id: string;
  company_id: string | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  capability: PlantCapability;
  fleet_size: number;
  hourly_rate: number;
}

export interface PlantStatusRow {
  plant_id: string;
  available_trucks: number;
  available_volume: number;
  is_open: boolean;
}

export interface TruckRow {
  id: string;
  plant_id: string;
  no: number;
  plate_no: string;
  capacity_m3: number;
  driver_id: string | null;
}

export interface FavoriteMixRow {
  id: string;
  site_id: string;
  alias: string;
  spec: Spec;
  volume_m3: number;
  pump_rate: number;
  preferred_plant_id: string | null;
  note: string | null;
  use_count: number;
  created_at: string;
}

export interface OrderRow {
  id: string;
  code: string;
  site_id: string;
  plant_id: string;
  spec: Spec;
  volume_m3: number;
  pour_start_at: string;
  pump_rate: number;
  temp_c: number;
  status: OrderStatus;
  plan_id: string | null;
  reject_reason: string | null;
  note: string | null;
  created_at: string;
}

export interface AllocationPlanRow {
  id: string;
  site_id: string;
  total_volume_m3: number;
  pour_start_at: string;
  pump_rate: number;
  temp_c: number;
  summary: string | null;
  created_at: string;
}

export interface PlanItemRow {
  id: string;
  plan_id: string;
  plant_id: string;
  trucks: number;
  travel_minutes: number;
  rounds: number[];
  mix_start_ats: string[];
}

export interface DeliveryRow {
  id: string;
  order_id: string;
  truck_id: string;
  volume_m3: number;
  mix_start_at: string;
  depart_at: string;
  eta_initial_at: string;
  eta_current_at: string;
  arrive_at: string | null;
  completed_at: string | null;
  limit_minutes: number;
  travel_minutes: number;
  distance_km: number | null;
  path: [number, number][];
  delay_reason: string | null;
  sim_seed: string | null;
}

export interface TruckLocationRow {
  id: number;
  delivery_id: string;
  lat: number;
  lng: number;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  role: 'site' | 'plant' | 'driver' | 'admin';
  company_id: string | null;
  phone: string | null;
}

/* ==========================================================================
 * DB → 앱
 * ======================================================================== */

export const toSite = (r: SiteRow): Site => ({
  id: r.id,
  companyId: r.company_id ?? undefined,
  name: r.name,
  address: r.address,
  lat: r.lat,
  lng: r.lng,
  accessNote: r.access_note ?? undefined,
});

/** 공장은 plants 와 plant_status 두 테이블을 합쳐야 화면이 쓰는 모양이 된다 */
export function toPlant(r: PlantRow, status?: PlantStatusRow): Plant {
  return {
    id: r.id,
    companyId: r.company_id ?? undefined,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    phone: r.phone ?? '',
    fleetSize: r.fleet_size,
    hourlyRate: r.hourly_rate,
    availableTrucks: status?.available_trucks ?? 0,
    availableVolume: Number(status?.available_volume ?? 0),
    isOpen: status?.is_open ?? false,
    cap: r.capability,
  };
}

/** 기사 이름은 profiles 에 있다. 아직 배정 전이면 '미배정'. */
export function toTruck(r: TruckRow, driverName?: string): Truck {
  return {
    id: r.id,
    plantId: r.plant_id,
    no: r.no,
    plateNo: r.plate_no,
    driver: driverName ?? (r.driver_id ? '배정됨' : '미배정'),
    driverId: r.driver_id ?? undefined,
    capacityM3: Number(r.capacity_m3),
  };
}

export const toFavorite = (r: FavoriteMixRow): FavoriteMix => ({
  id: r.id,
  siteId: r.site_id,
  alias: r.alias,
  spec: r.spec,
  volumeM3: Number(r.volume_m3),
  pumpRate: Number(r.pump_rate),
  preferredPlantId: r.preferred_plant_id ?? undefined,
  note: r.note ?? undefined,
  useCount: r.use_count,
  createdAt: msReq(r.created_at),
});

export const toOrder = (r: OrderRow): Order => ({
  id: r.id,
  code: r.code,
  siteId: r.site_id,
  plantId: r.plant_id,
  spec: r.spec,
  volumeM3: Number(r.volume_m3),
  pourStartAt: msReq(r.pour_start_at),
  pumpRate: Number(r.pump_rate),
  tempC: Number(r.temp_c),
  status: r.status,
  planId: r.plan_id ?? undefined,
  rejectReason: r.reject_reason ?? undefined,
  note: r.note ?? undefined,
  createdAt: msReq(r.created_at),
});

export const toPlanItem = (r: PlanItemRow, plantName: string): AllocationItem => ({
  plantId: r.plant_id,
  plantName,
  trucks: r.trucks,
  travelMinutes: Number(r.travel_minutes),
  rounds: r.rounds ?? [],
  mixStartAts: (r.mix_start_ats ?? []).map(msReq),
});

export const toPlan = (r: AllocationPlanRow, items: AllocationItem[]): AllocationPlan => ({
  id: r.id,
  siteId: r.site_id,
  totalVolumeM3: Number(r.total_volume_m3),
  pourStartAt: msReq(r.pour_start_at),
  pumpRate: Number(r.pump_rate),
  tempC: Number(r.temp_c),
  items,
  summary: r.summary ?? '',
  createdAt: msReq(r.created_at),
});

/**
 * 배송에는 공장·현장 id 와 제한 시각이 필요한데 DB 에는 없다.
 * 주문에서 끌어오고, limitAt 은 비비기 시작 + 제한시간으로 계산한다.
 */
export function toDelivery(r: DeliveryRow, order?: Order): Delivery {
  const mixStartAt = msReq(r.mix_start_at);
  return {
    id: r.id,
    orderId: r.order_id,
    truckId: r.truck_id,
    plantId: order?.plantId ?? '',
    siteId: order?.siteId ?? '',
    volumeM3: Number(r.volume_m3),
    mixStartAt,
    departAt: msReq(r.depart_at),
    etaInitialAt: msReq(r.eta_initial_at),
    etaCurrentAt: msReq(r.eta_current_at),
    arriveAt: ms(r.arrive_at),
    completedAt: ms(r.completed_at),
    limitMinutes: r.limit_minutes,
    limitAt: mixStartAt + r.limit_minutes * MIN,
    travelMinutes: Number(r.travel_minutes),
    distanceKm: Number(r.distance_km ?? 0),
    path: Array.isArray(r.path) ? r.path : [],
    delayReason: r.delay_reason ?? undefined,
    simSeed: r.sim_seed ?? undefined,
  };
}

export const toLocation = (r: TruckLocationRow): TruckLocation => ({
  deliveryId: r.delivery_id,
  lat: r.lat,
  lng: r.lng,
  speedKmh: r.speed_kmh ?? undefined,
  heading: r.heading ?? undefined,
  recordedAt: msReq(r.recorded_at),
});

/* ==========================================================================
 * 앱 → DB (쓰기용)
 * ======================================================================== */

export const orderInsert = (o: Omit<Order, 'id' | 'createdAt'>, createdBy: string | null) => ({
  code: o.code,
  site_id: o.siteId,
  plant_id: o.plantId,
  spec: o.spec,
  volume_m3: o.volumeM3,
  pour_start_at: iso(o.pourStartAt),
  pump_rate: o.pumpRate,
  temp_c: o.tempC,
  status: o.status,
  plan_id: o.planId ?? null,
  note: o.note ?? null,
  created_by: createdBy,
});

export const deliveryInsert = (d: Omit<Delivery, 'id' | 'plantId' | 'siteId' | 'limitAt'>) => ({
  order_id: d.orderId,
  truck_id: d.truckId,
  volume_m3: d.volumeM3,
  mix_start_at: iso(d.mixStartAt),
  depart_at: iso(d.departAt),
  eta_initial_at: iso(d.etaInitialAt),
  eta_current_at: iso(d.etaCurrentAt),
  arrive_at: d.arriveAt ? iso(d.arriveAt) : null,
  completed_at: d.completedAt ? iso(d.completedAt) : null,
  limit_minutes: d.limitMinutes,
  travel_minutes: d.travelMinutes,
  distance_km: d.distanceKm,
  path: d.path,
  delay_reason: d.delayReason ?? null,
  sim_seed: d.simSeed ?? null,
});

export const favoriteInsert = (
  f: Omit<FavoriteMix, 'id' | 'useCount' | 'createdAt'>,
  createdBy: string | null,
) => ({
  site_id: f.siteId,
  alias: f.alias,
  spec: f.spec,
  volume_m3: f.volumeM3,
  pump_rate: f.pumpRate,
  preferred_plant_id: f.preferredPlantId ?? null,
  note: f.note ?? null,
  created_by: createdBy,
});
