/**
 * 전자 납품서(송장) — 차량 한 대가 한 장이다.
 *
 * 종이 납품서는 트럭 한 대가 실은 한 배치마다 한 장씩 나온다. 현장은 그 장을
 * 받아 서명하고, 나중에 정산·품질 확인에 쓴다. 주문 한 건에 열 대가 갔으면
 * 납품서도 열 장이다.
 *
 * 전에는 주문 한 건이 납품서 하나였고 차량은 그 안의 표 한 줄이었다. 실제와
 * 맞지 않아서, 한 장을 뽑아 현장에 주거나 차량별로 보관할 수가 없었다.
 *
 * 이 파일은 화면을 모른다. 순수 함수라 테스트로 고정할 수 있다.
 */

import { DeliveryRules, MIN, specCode, specText } from './rules';
import type { Db } from './store/shared';
import type { Delivery, Spec } from './types';

export interface DeliveryNote {
  deliveryId: string;
  /** 납품서 번호 — 주문번호에 회차를 붙인다 (예: R-0929-001-03) */
  code: string;
  /** 이 주문에서 몇 번째 차인가 (1부터) */
  round: number;

  /** 공급자 */
  plantName: string;
  plantAddress: string;
  plantPhone: string;

  /** 수요자 */
  siteName: string;
  siteAddress: string;

  /** 운반 차량 */
  truckNo: number | null;
  plateNo: string;
  driverName: string;

  spec: Spec;
  volumeM3: number;
  tempC: number;

  /** 비비기 시작 = 출하 시각. 납품서의 기준 시각이다. */
  mixStartAt: number;
  departAt: number;
  arriveAt?: number;
  completedAt?: number;

  limitMinutes: number;
  /** 비비기~타설 완료 경과(분). 아직 안 끝났으면 null */
  elapsedMin: number | null;
  /** 제한시간 이내였나. 진행 중이면 null */
  within: boolean | null;

  /**
   * 확정됐나 — 기사가 하역 완료를 누른 순간 이 장은 더 못 바꾼다.
   *
   * 그 전까지 납품서는 "지금까지 이렇게 되고 있다" 는 진행 상황이고,
   * 누른 뒤부터는 정산·품질 확인에 쓰는 증빙이다. 현장이 둘을 섞어 보면
   * 아직 붓고 있는 차의 숫자를 확정된 값으로 읽게 된다.
   */
  issued: boolean;
  /** 확정 시각 = 하역 완료를 누른 시각. 현장으로 보낸 시각이기도 하다 */
  issuedAt?: number;

  /** 기사가 올린 종이 납품서 사진 */
  notePhotoPath?: string;
}

/** 납품서 번호 — 주문번호-회차 */
const noteCode = (orderCode: string, round: number) =>
  `${orderCode}-${String(round).padStart(2, '0')}`;

/**
 * 배송 한 건을 납품서 한 장으로.
 * 주문이 없으면(지워졌으면) 납품서를 만들 수 없다.
 */
export function buildNote(db: Db, d: Delivery): DeliveryNote | null {
  const order = db.orders.find((o) => o.id === d.orderId);
  if (!order) return null;

  const plant = db.plants.find((p) => p.id === order.plantId);
  const site = db.sites.find((s) => s.id === order.siteId);
  const truck = db.trucks.find((t) => t.id === d.truckId);

  // 같은 주문 안에서 몇 번째 차인가 — 비비기 시작 순
  const siblings = db.deliveries
    .filter((x) => x.orderId === d.orderId)
    .sort((a, b) => a.mixStartAt - b.mixStartAt);
  const round = siblings.findIndex((x) => x.id === d.id) + 1;

  return {
    deliveryId: d.id,
    code: noteCode(order.code, round),
    round,

    plantName: plant?.name ?? '',
    plantAddress: plant?.address ?? '',
    plantPhone: plant?.phone ?? '',

    siteName: site?.name ?? '',
    siteAddress: site?.address ?? '',

    truckNo: truck?.no ?? null,
    plateNo: truck?.plateNo ?? '',
    driverName: truck?.driver ?? '',

    spec: order.spec,
    volumeM3: d.volumeM3,
    tempC: order.tempC,

    mixStartAt: d.mixStartAt,
    departAt: d.departAt,
    arriveAt: d.arriveAt,
    completedAt: d.completedAt,

    limitMinutes: d.limitMinutes,
    elapsedMin: d.completedAt ? Math.round((d.completedAt - d.mixStartAt) / MIN) : null,
    within: DeliveryRules.withinLimit(d),

    // 하역 완료를 누른 시각이 곧 확정 시각이다. 따로 적는 칸을 두지 않는다 —
    // 사람이 손으로 넣는 시각은 틀리거나 비어 있기 마련이다.
    issued: d.completedAt != null,
    issuedAt: d.completedAt,

    notePhotoPath: d.notePhotoPath,
  };
}

/** 한 현장의 납품서 전부 — 최근 것이 앞에 */
export function notesOfSite(db: Db, siteId: string): DeliveryNote[] {
  const orderIds = new Set(db.orders.filter((o) => o.siteId === siteId).map((o) => o.id));
  return db.deliveries
    .filter((d) => orderIds.has(d.orderId))
    .sort((a, b) => b.mixStartAt - a.mixStartAt)
    .map((d) => buildNote(db, d))
    .filter((n): n is DeliveryNote => n != null);
}

/** 한 공장이 내보낸 납품서 전부 */
export function notesOfPlant(db: Db, plantId: string): DeliveryNote[] {
  const orderIds = new Set(db.orders.filter((o) => o.plantId === plantId).map((o) => o.id));
  return db.deliveries
    .filter((d) => orderIds.has(d.orderId))
    .sort((a, b) => b.mixStartAt - a.mixStartAt)
    .map((d) => buildNote(db, d))
    .filter((n): n is DeliveryNote => n != null);
}

/* ==========================================================================
 * 날짜별 묶기
 *
 * 현장 사무는 "9월 29일 화요일에 몇 ㎥ 들어왔나" 로 센다. 주문 단위가 아니라
 * 날짜 단위다. 정산도 그렇게 한다.
 * ======================================================================== */

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** 2026년 9월 29일 (화) */
export function dayLabel(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`;
}

/** 파일 이름에 쓸 20260929 */
export function dayKey(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export interface NoteDay {
  /** 그날 0시 (정렬·키로 쓴다) */
  startAt: number;
  label: string;
  key: string;
  notes: DeliveryNote[];
  totalM3: number;
  /** 제한시간을 넘긴 장수 */
  overCount: number;
}

/** 납품서를 날짜별로 묶는다 — 최근 날짜가 앞에 */
export function groupByDay(notes: DeliveryNote[]): NoteDay[] {
  const byDay = new Map<number, DeliveryNote[]>();

  for (const n of notes) {
    const d = new Date(n.mixStartAt);
    d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    const list = byDay.get(k);
    if (list) list.push(n);
    else byDay.set(k, [n]);
  }

  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([startAt, list]) => ({
      startAt,
      label: dayLabel(startAt),
      key: dayKey(startAt),
      // 하루 안에서는 이른 출하가 위로 — 실제 납품 순서다
      notes: list.slice().sort((a, b) => a.mixStartAt - b.mixStartAt),
      totalM3: Math.round(list.reduce((s, n) => s + n.volumeM3, 0) * 10) / 10,
      overCount: list.filter((n) => n.within === false).length,
    }));
}

/* ==========================================================================
 * 내보내기
 * ======================================================================== */

const hhmm = (at: number | undefined) =>
  at == null
    ? ''
    : new Date(at).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

/** 쉼표·따옴표·줄바꿈이 있으면 감싼다 */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = [
  '납품서번호',
  '날짜',
  '호차',
  '차량번호',
  '기사',
  '공장',
  '현장',
  '규격',
  '호칭',
  '물량(m3)',
  '외기온도(C)',
  '비비기시작',
  '공장출발',
  '현장도착',
  '타설완료',
  '경과(분)',
  '제한(분)',
  '판정',
] as const;

/**
 * 엑셀에서 바로 열리는 CSV.
 *
 * 맨 앞에 BOM 을 붙인다. 없으면 엑셀이 한글을 깨뜨린다 — 현장 사무가 받는
 * 파일이라 열었을 때 글자가 깨지면 쓸모가 없다.
 */
export function notesToCsv(notes: DeliveryNote[]): string {
  const rows = notes.map((n) =>
    [
      n.code,
      dayKey(n.mixStartAt),
      n.truckNo ?? '',
      n.plateNo,
      n.driverName,
      n.plantName,
      n.siteName,
      specText(n.spec),
      specCode(n.spec),
      n.volumeM3,
      n.tempC,
      hhmm(n.mixStartAt),
      hhmm(n.departAt),
      hhmm(n.arriveAt),
      hhmm(n.completedAt),
      n.elapsedMin ?? '',
      n.limitMinutes,
      n.within == null ? '진행중' : n.within ? '제한내' : '초과',
    ].map(csvCell),
  );

  return '﻿' + [CSV_COLUMNS.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/* ==========================================================================
 * 현장이 "새로 받은" 납품서
 *
 * 확정된 장만 받은 것으로 친다. 아직 붓고 있는 차의 장은 현장도 이미 추적
 * 화면에서 보고 있으므로 새로 알릴 것이 없다.
 * ======================================================================== */

/** 확정된 장만 */
export const issuedNotes = (notes: DeliveryNote[]) => notes.filter((n) => n.issued);

/** 확정됐는데 아직 안 본 장 */
export function unseenNotes(notes: DeliveryNote[], seen: ReadonlySet<string>): DeliveryNote[] {
  return issuedNotes(notes).filter((n) => !seen.has(n.code));
}
