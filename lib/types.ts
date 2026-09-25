/**
 * 도메인 타입 — 지시서 4장의 테이블 12개와 1:1로 맞춘다.
 * Supabase 를 붙일 때 이 타입이 그대로 Row 타입이 되도록 이름을 맞춰 두었다.
 */

export type Role = 'site' | 'plant' | 'driver';

export type ConcreteType = '보통' | '경량' | '포장' | '고강도';
export type SlumpKind = 'slump' | 'flow';

/** 호칭 방법: 굵은골재 최대치수(mm) - 호칭강도(MPa, 포장은 휨강도) - 슬럼프 또는 슬럼프 플로(mm) */
export interface Spec {
  type: ConcreteType;
  aggMm: number;
  strength: number;
  slumpKind: SlumpKind;
  slumpMm: number;
  cement: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** sites */
export interface Site extends LatLng {
  id: string;
  /** 소속 건설사 — 로그인 사용자의 회사와 맞는 것만 보여 준다 */
  companyId?: string;
  name: string;
  address: string;
  /** 현장 진입 메모 — 트럭 진입로·게이트 위치 등 */
  accessNote?: string;
}

/** 공장 생산 능력 */
export interface PlantCapability {
  /** 생산 가능한 종류별 최대 호칭강도. 키가 없으면 그 종류를 못 만든다. */
  maxStrength: Partial<Record<ConcreteType, number>>;
  aggs: number[];
  /** 슬럼프 플로 생산 가능 여부 */
  flow: boolean;
  cements: string[];
}

/** plants + plant_status 를 합친 화면용 형태 */
export interface Plant extends LatLng {
  id: string;
  /** 소속 레미콘사 */
  companyId?: string;
  name: string;
  address: string;
  phone: string;
  /** 보유 차량 대수 */
  fleetSize: number;
  /** 지금 출하 가능한 차량 대수 */
  availableTrucks: number;
  /** 지금 출하 가능한 물량 m³ */
  availableVolume: number;
  /** 이 현장 한 곳으로 시간당 내보낼 수 있는 최대 대수 (지시서 6장 제약 ③) */
  hourlyRate: number;
  isOpen: boolean;
  cap: PlantCapability;
}

/** trucks */
export interface Truck {
  id: string;
  plantId: string;
  no: number;
  plateNo: string;
  driver: string;
  /** 이 차를 맡은 기사 계정 — 비어 있으면 아직 배정 전 */
  driverId?: string;
  capacityM3: number;
}

/** favorite_mixes — 현장마다 자주 쓰는 레미콘 (지시서 5장 ★) */
export interface FavoriteMix {
  id: string;
  siteId: string;
  /** 별칭 — 예: "2층 슬래브용" */
  alias: string;
  spec: Spec;
  volumeM3: number;
  pumpRate: number;
  /** 자주 쓰는 공장 id */
  preferredPlantId?: string;
  note?: string;
  useCount: number;
  createdAt: number;
}

export type OrderStatus =
  | 'requested'
  | 'accepted'
  | 'delivering'
  | 'completed'
  | 'rejected'
  | 'cancelled';

/** orders */
export interface Order {
  id: string;
  /** 사람이 읽는 주문번호 — 예: "R-0923-014" */
  code: string;
  siteId: string;
  plantId: string;
  spec: Spec;
  volumeM3: number;
  /** 타설 시작 예정 시각 (epoch ms) */
  pourStartAt: number;
  /** 펌프 타설 속도 m³/h */
  pumpRate: number;
  status: OrderStatus;
  /** AI 배분으로 만들어진 주문이면 그 계획 id */
  planId?: string;
  /** 외기온도 — 90분/120분 제한 판정에 쓴 값 */
  tempC: number;
  createdAt: number;
  rejectReason?: string;
  note?: string;
}

/** allocation_plans — AI 배분 1회 = 1행 */
export interface AllocationPlan {
  id: string;
  siteId: string;
  totalVolumeM3: number;
  pourStartAt: number;
  pumpRate: number;
  tempC: number;
  /** plan_items */
  items: AllocationItem[];
  summary: string;
  createdAt: number;
}

/** plan_items — 공장별 배정 결과 */
export interface AllocationItem {
  plantId: string;
  plantName: string;
  /** 배정 대수 */
  trucks: number;
  travelMinutes: number;
  /** 배정된 회차 번호 (0부터) */
  rounds: number[];
  /** 회차별 출하(비비기 시작) 예정 시각 */
  mixStartAts: number[];
}

export type DeliveryStatus = 'loading' | 'transit' | 'onsite' | 'done';

/** deliveries — 납품서 한 장 */
export interface Delivery {
  id: string;
  orderId: string;
  truckId: string;
  plantId: string;
  siteId: string;
  volumeM3: number;
  /** 비비기 시작 */
  mixStartAt: number;
  /** 공장 출발 */
  departAt: number;
  /** 출하 시점에 고정한 최초 도착 예상 */
  etaInitialAt: number;
  /** 1분마다 다시 계산하는 현재 도착 예상 */
  etaCurrentAt: number;
  /** 실제 도착 */
  arriveAt?: number;
  /** 타설 완료 */
  completedAt?: number;
  /** 비비기~타설 완료 제한 (90 또는 120분) */
  limitMinutes: number;
  /** 제한 시각 = mixStartAt + limitMinutes */
  limitAt: number;
  /** 계획 이동시간(분) */
  travelMinutes: number;
  /** 추천 경로 */
  path: [number, number][];
  distanceKm: number;
  /** 지연 원인 표시용 — 예: "영동고속 정체" */
  delayReason?: string;
  /** 시연용 가짜 차량이면 결정적 난수 씨앗 */
  simSeed?: string;
}

/** truck_locations — GPS 기록 */
export interface TruckLocation {
  deliveryId: string;
  lat: number;
  lng: number;
  speedKmh?: number;
  heading?: number;
  recordedAt: number;
}

/** 판정 결과 */
export type Level = 'ok' | 'warn' | 'bad';

export interface Judgement {
  level: Level;
  label: string;
  /** 허용 이동시간 대비 남는 분 (시간 판정일 때만) */
  margin?: number;
}
