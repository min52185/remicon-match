/**
 * 시방·KS 규칙 — 프로토타입 A 의 RULES / KS_TABLE / PourRules / DeliveryRules 이전.
 *
 * 이 파일은 UI·저장소·외부 API 를 전혀 모른다. 순수 함수만 둔다.
 * 시방 수치는 전부 여기 상수로만 쓴다 (CLAUDE.md 규칙).
 */

import type {
  ConcreteType,
  Delivery,
  Judgement,
  Level,
  Plant,
  SlumpKind,
  Spec,
} from './types';

export const MIN = 60_000;

/** 팀이 정할 설정값 — 현장이 바꿀 수 있어야 한다 (지시서 11장) */
export const RULES = Object.freeze({
  /** 이 값 "이상"이면 고온 기준 */
  HOT_THRESHOLD_C: 25,
  /** 25℃ 이상: 비비기 시작 ~ 타설 완료 90분 이내 */
  LIMIT_HOT_MIN: 90,
  /** 25℃ 미만: 120분 이내 */
  LIMIT_NORMAL_MIN: 120,
  /** 출하 준비시간(비비기~공장 출발) 기본값 */
  DEFAULT_PREP_MIN: 10,
  /** 현장 대기·하역·타설 여유 기본값 */
  DEFAULT_SITE_BUFFER_MIN: 20,
  /** AI 배분에서 쓰는 안전 여유 (지시서 6장 m) */
  DEFAULT_SAFETY_MARGIN_MIN: 10,
  /** [가정] 허용 이동시간 대비 남는 시간이 이 값 미만이면 '빠듯함' */
  CAUTION_MARGIN_MIN: 5,
  /** [가정] 타설 기한 이 분 전에 경고 */
  LIMIT_WARN_MIN: 10,
  /** 콜드조인트 경고 — 다음 차 도착 공백이 이 분을 넘으면 알린다 (팀이 정할 값) */
  COLD_JOINT_WARN_GAP_MIN: 20,
  /**
   * 허용 이어치기 시간간격 — KCS 14 20 10:2024-12-30, 3.3 (8) 표 3.3-1 원문 확인 완료.
   *
   *   외기온도 25 ℃ 초과 → 2.0시간
   *   외기온도 25 ℃ 이하 → 2.5시간
   *
   * 경계가 '초과 / 이하'다. 비비기~타설 제한(1.5/2시간)은 '이상 / 미만'이라 기준이 다르므로,
   * 정확히 25℃ 일 때 두 규정이 다른 쪽으로 갈린다 — coldJointLimitMinutes() 는 > 를 쓴다.
   *
   * ⚠ 표 3.3-1 의 주석은 이 시간을 "하층 콘크리트 비비기 시작 ~ 상층 콘크리트가 타설되기까지"로
   *   정의한다. 그런데 monitorPour() 는 "지금 차 타설 종료 ~ 다음 차 도착"으로 공백을 잰다.
   *   시작점이 비비기가 아니라 타설 종료라서, 우리 계산이 원문보다 짧게 나온다 =
   *   위험을 과소평가할 수 있다. 기준점을 맞추는 작업이 남아 있다.
   */
  COLD_JOINT_LIMIT_HOT_MIN: 120,
  COLD_JOINT_LIMIT_NORMAL_MIN: 150,
});

/** [가정] 믹서트럭 1대 적재량 — 실제 운행 기록이 쌓이면 고친다 */
export const TRUCK_CAPACITY_M3 = 6;
/** [가정] 현장 도착 후 하역·타설 추정 시간 */
export const UNLOAD_EST_MIN = 20;
/** [가정] 승용차 경로시간 → 믹서트럭 보정 (가속·차로 제약) */
export const TRUCK_FACTOR = 1.25;

/* ==========================================================================
 * 레미콘 사양 (KS F 4009)
 * ======================================================================== */

export const CONCRETE_TYPES: ConcreteType[] = ['보통', '경량', '포장', '고강도'];
export const AGG_OPTIONS = [20, 25, 40];
export const STRENGTH_OPTIONS = [18, 21, 24, 27, 30, 35, 40];
/** 포장 콘크리트는 휨강도라 선택지를 따로 둔다 */
export const FLEX_STRENGTH_OPTIONS = [4.0, 4.5];

export const SLUMP_OPTIONS: Record<ConcreteType, { slump: number[]; flow: number[] }> = {
  보통: { slump: [80, 120, 150, 180, 210], flow: [500, 600] },
  경량: { slump: [80, 120, 150, 180, 210], flow: [] },
  포장: { slump: [25, 65], flow: [] },
  고강도: { slump: [120, 150, 180, 210], flow: [500, 600, 700] },
};

/** [가정] 국내에서 흔히 쓰는 시멘트 (KS L 5201 / 5210 / 5211) */
export const CEMENT_TYPES = [
  '보통 포틀랜드 시멘트 (1종)',
  '중용열 포틀랜드 시멘트 (2종)',
  '조강 포틀랜드 시멘트 (3종)',
  '저열 포틀랜드 시멘트 (4종)',
  '내황산염 포틀랜드 시멘트 (5종)',
  '고로 슬래그 시멘트 1종',
  '고로 슬래그 시멘트 2종',
  '고로 슬래그 시멘트 3종',
  '플라이애시 시멘트 1종',
  '플라이애시 시멘트 2종',
  '포틀랜드 포졸란 시멘트',
  '백색 포틀랜드 시멘트',
] as const;

export const [C1, C2, C3, C4, C5, SLAG1, SLAG2, SLAG3, FLY1, FLY2, POZZ, WHITE] = CEMENT_TYPES;

/** 종류를 바꾸면 그 종류에서 흔한 값으로 맞춰 준다 */
export const TYPE_DEFAULTS: Record<ConcreteType, Omit<Spec, 'type' | 'cement'>> = {
  보통: { aggMm: 25, strength: 24, slumpKind: 'slump', slumpMm: 150 },
  경량: { aggMm: 20, strength: 24, slumpKind: 'slump', slumpMm: 150 },
  포장: { aggMm: 40, strength: 4.5, slumpKind: 'slump', slumpMm: 65 },
  고강도: { aggMm: 25, strength: 40, slumpKind: 'slump', slumpMm: 180 },
};

export const DEFAULT_SPEC: Spec = Object.freeze({
  type: '보통',
  ...TYPE_DEFAULTS.보통,
  cement: C1,
});

/** KS F 4009 레디믹스트 콘크리트 종류표 */
export const KS_TABLE: {
  type: ConcreteType;
  agg: number[];
  kind: SlumpKind;
  slump: number[];
  strength: number[];
}[] = [
  { type: '보통', agg: [20, 25], kind: 'slump', slump: [80, 120, 150, 180], strength: [18, 21, 24, 27, 30, 35] },
  { type: '보통', agg: [20, 25], kind: 'slump', slump: [210], strength: [21, 24, 27, 30, 35] },
  { type: '보통', agg: [20, 25], kind: 'flow', slump: [500, 600], strength: [27, 30, 35] },
  { type: '보통', agg: [40], kind: 'slump', slump: [50, 80, 120, 150], strength: [18, 21, 24, 27, 30, 35] },
  { type: '경량', agg: [15, 20], kind: 'slump', slump: [80, 120, 150, 180, 210], strength: [18, 21, 24, 27, 30, 35, 40] },
  { type: '포장', agg: [20, 25, 40], kind: 'slump', slump: [25, 65], strength: [4, 4.5] },
  { type: '고강도', agg: [15, 20, 25], kind: 'slump', slump: [120, 150, 180, 210], strength: [40, 45, 50] },
  { type: '고강도', agg: [15, 20, 25], kind: 'flow', slump: [500, 600, 700], strength: [40, 45, 50, 55, 60] },
];

/** KS 표에 있는 조합인가 */
export const isKsSpec = (s: Spec): boolean =>
  KS_TABLE.some(
    (r) =>
      r.type === s.type &&
      r.agg.includes(s.aggMm) &&
      r.kind === s.slumpKind &&
      r.slump.includes(s.slumpMm) &&
      r.strength.includes(s.strength),
  );

export const specCode = (s: Spec) => `${s.aggMm}-${s.strength}-${s.slumpMm}`;
export const specText = (s: Spec) =>
  `${s.type} ${specCode(s)}${s.slumpKind === 'flow' ? ' (플로)' : ''}`;
export const cementShort = (c: string) =>
  String(c).replace(' 시멘트', '').replace(/\s*\((\d종)\)/, ' $1');
export const slumpLabel = (s: Spec) =>
  `${s.slumpKind === 'flow' ? '슬럼프 플로' : '슬럼프'} ${s.slumpMm}mm`;
export const strengthLabel = (s: Spec) =>
  s.type === '포장' ? `휨 ${s.strength}MPa` : `${s.strength}MPa`;

/* ==========================================================================
 * 판정 규칙
 * ======================================================================== */

const LEVEL_RANK: Record<Level, number> = { ok: 0, warn: 1, bad: 2 };

export const LEVEL_LABEL: Record<Level, string> = {
  ok: '주문 가능',
  warn: '확인 필요',
  bad: '주문 불가',
};

export const ORDER_STATUS_LABEL = {
  requested: '수락 대기',
  accepted: '출하 대기',
  delivering: '납품 중',
  completed: '납품 완료',
  rejected: '거절됨',
  cancelled: '취소됨',
} as const;

export const ORDER_TONE = {
  requested: 'info',
  accepted: 'accent',
  delivering: 'accent',
  completed: 'ok',
  rejected: 'bad',
  cancelled: 'muted',
} as const;

export const PHASE_LABEL = {
  loading: '상차 중',
  transit: '운반 중',
  onsite: '현장 도착',
  done: '타설 완료',
} as const;

export const PHASE_TONE = {
  loading: 'warn',
  transit: 'info',
  onsite: 'accent',
  done: 'ok',
} as const;

export interface PourSettings {
  prepMinutes: number;
  siteBufferMinutes: number;
  safetyMarginMinutes: number;
}

export const DEFAULT_POUR_SETTINGS: PourSettings = {
  prepMinutes: RULES.DEFAULT_PREP_MIN,
  siteBufferMinutes: RULES.DEFAULT_SITE_BUFFER_MIN,
  safetyMarginMinutes: RULES.DEFAULT_SAFETY_MARGIN_MIN,
};

export const PourRules = {
  isHot: (tempC: number) => tempC >= RULES.HOT_THRESHOLD_C,

  /** 비비기 시작 ~ 타설 완료 제한시간(분) */
  limitMinutes: (tempC: number) =>
    tempC >= RULES.HOT_THRESHOLD_C ? RULES.LIMIT_HOT_MIN : RULES.LIMIT_NORMAL_MIN,

  /**
   * 허용 이동시간 = 제한시간 − 출하 준비 − 현장 여유 − 안전 여유
   * 지시서 6장: T_허용 = L − t_준비 − t_현장 − m
   */
  allowedTravelMinutes(tempC: number, s: PourSettings = DEFAULT_POUR_SETTINGS) {
    return (
      PourRules.limitMinutes(tempC) - s.prepMinutes - s.siteBufferMinutes - s.safetyMarginMinutes
    );
  },

  judgeTravel(travelMin: number, allowedMin: number): Judgement {
    const margin = allowedMin - travelMin;
    if (allowedMin <= 0 || margin < 0) return { level: 'bad', label: '시간 초과', margin };
    if (margin < RULES.CAUTION_MARGIN_MIN) return { level: 'warn', label: '시간 빠듯함', margin };
    return { level: 'ok', label: '시간 내 도착', margin };
  },

  /** 공장이 이 사양을 만들 수 있는가 */
  judgeSpec(plant: Plant, spec: Spec): Judgement {
    const c = plant.cap;
    const max = c.maxStrength[spec.type];
    if (max == null) return { level: 'bad', label: `${spec.type} 콘크리트 미생산` };
    if (!c.aggs.includes(spec.aggMm)) return { level: 'bad', label: `골재 ${spec.aggMm}mm 없음` };
    if (spec.strength > max)
      return { level: 'bad', label: `${strengthLabel(spec)} 불가 (최대 ${max})` };
    if (spec.slumpKind === 'flow' && !c.flow)
      return { level: 'bad', label: '슬럼프 플로 미생산' };
    if (!c.cements.includes(spec.cement))
      return { level: 'bad', label: `${cementShort(spec.cement)} 없음` };
    return { level: 'ok', label: '사양 생산 가능' };
  },

  judgeSupply(plant: Plant, volumeM3: number, spec?: Spec): Judgement {
    if (!plant.isOpen) return { level: 'bad', label: '출하 중지' };
    if (spec) {
      const sj = PourRules.judgeSpec(plant, spec);
      if (sj.level === 'bad') return sj;
    }
    if (plant.availableTrucks <= 0 || plant.availableVolume <= 0)
      return { level: 'bad', label: '출하 여력 없음' };
    if (volumeM3 > plant.availableVolume)
      return { level: 'warn', label: `물량 부족 (${plant.availableVolume}m³ 가능)` };
    return { level: 'ok', label: '출하 가능' };
  },

  worst: (...levels: Level[]): Level =>
    levels.reduce<Level>((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a), 'ok'),
};

/* ==========================================================================
 * 배송 진행 단계 — 저장하지 않고 시각으로 계산한다
 * ======================================================================== */

export const DeliveryRules = {
  phase(d: Delivery, now: number) {
    if (d.completedAt) return 'done' as const;
    if (now < d.departAt) return 'loading' as const;
    if (!d.arriveAt || now < d.arriveAt) return 'transit' as const;
    return 'onsite' as const;
  },

  /** 타설이 끝나는 시각 — 실제 기록이 없으면 도착 + 하역 추정 */
  pourEndAt: (d: Delivery) =>
    d.completedAt ?? (d.arriveAt ?? d.etaCurrentAt) + UNLOAD_EST_MIN * MIN,

  /** 완료된 건: 제한시간 이내였는가 / 진행 중: null */
  withinLimit: (d: Delivery) =>
    d.completedAt ? d.completedAt - d.mixStartAt <= d.limitMinutes * MIN : null,

  /** 타설 기한 대비 위험도 */
  limitLevel(d: Delivery, now: number): Level {
    if (d.completedAt) return DeliveryRules.withinLimit(d) ? 'ok' : 'bad';
    const slack = d.limitAt - Math.max(now, d.etaCurrentAt);
    if (slack < 0) return 'bad';
    return slack < RULES.LIMIT_WARN_MIN * MIN ? 'warn' : 'ok';
  },

  /**
   * 처음 예상 대비 몇 분 늦음/빠름 (지시서 7장)
   * 지연(분) = ETA_현재 − ETA_출하시   (+ 늦음, − 빠름)
   */
  delayMinutes: (d: Delivery) => Math.round((d.etaCurrentAt - d.etaInitialAt) / MIN),
};

/** 이어치기 허용 시간간격(분) — 외기온도에 따라 */
export const coldJointLimitMinutes = (tempC: number) =>
  tempC > RULES.HOT_THRESHOLD_C
    ? RULES.COLD_JOINT_LIMIT_HOT_MIN
    : RULES.COLD_JOINT_LIMIT_NORMAL_MIN;
