/**
 * 레캉쌤 — 현장 질문에 답하는 도우미의 두뇌 중 '숫자' 쪽.
 *
 * 숫자는 전부 여기서(규칙·예측 함수로) 계산한다. Claude 는 이 결과를 받아 사람 말로
 * 풀어 줄 뿐, 숫자를 새로 만들지 않는다. 시방 수치가 lib/rules.ts 한 곳에만 있어야 하고,
 * LLM 이 "약 10분" 같은 숫자를 지어내면 현장이 그걸 믿고 움직이기 때문이다.
 *
 * API 키가 없으면 templateAnswer() 가 같은 숫자로 정해진 문장을 만든다.
 * 조원이 키 없이 받아도 레캉쌤이 답은 한다.
 *
 * 이 파일은 화면도 네트워크도 모른다. 순수 함수라 테스트로 고정한다.
 */

import { clock } from '../format';
import {
  DeliveryRules,
  MIN,
  ORDER_STATUS_LABEL,
  PHASE_LABEL,
  PourRules,
  RULES,
  SURPLUS,
  specText,
} from '../rules';
import { approximateRoute } from '../services/route';
import { getPosition } from '../services/tracking';
import type { Db } from '../store/shared';
import { offersForSite } from '../surplus';
import type { Site } from '../types';
import { analyzeDelay, monitorPour, recommend } from './predict';
import { estimateSlump } from './slump';

/* ==========================================================================
 * 현장 상황 요약 — Claude 에 그대로 넘기는 JSON
 * ======================================================================== */

export interface DeliveryFact {
  truck: string;
  plant: string;
  spec: string;
  phase: string;
  /** 도착 예정 HH:MM (도착했으면 도착 시각) */
  eta: string;
  /** 도착까지 남은 분. 도착했으면 0 */
  etaInMin: number;
  /** 남은 거리 km. 도착했으면 0 */
  remainingKm: number;
  /** "처음 예상보다 7분 늦음" */
  delay: string;
  /** 처음 예상 대비 늦은 분. 음수면 빠름 */
  delayMin: number;
  delayReason?: string;
  /** 비비기~타설 제한까지 남은 분 (도착 예정 기준). 음수면 초과 예상 */
  limitSlackMin: number;
  limitMinutes: number;
  level: 'ok' | 'warn' | 'bad';
  /** 운반 중 슬럼프 약산 추정. 슬럼프 플로 주문이면 없다 */
  slump?: SlumpFact;
}

export interface SlumpFact {
  /** 공장이 적은 초기 슬럼프 (없으면 주문값) */
  initialMm: number;
  orderedMm: number;
  /** 기사 출발 뒤 지난 분 */
  elapsedMin: number;
  nowMm: number;
  /** 도착 예정 때 추정 — 이미 도착했으면 없다 */
  atArrivalMm: number | null;
  /** 지금 저하 속도 (mm/분) */
  rateNow: number;
  phase: string;
  /** 주문 슬럼프 하한 (KS F 4009 허용차) */
  lowerMm: number;
  belowLower: boolean;
  /** 추정에 쓴 기온 */
  tempC: number;
}

export interface PourFact {
  order: string;
  pouredM3: number;
  remainingM3: number;
  /** 타설 공백(분). 음수면 겹쳐서 안전 */
  gapMinutes: number | null;
  /** 콜드조인트 한도까지 여유(분) */
  jointSlackMin: number | null;
  coldJointLimitMin: number;
  level: 'ok' | 'warn' | 'bad';
  message: string;
  /** 위험할 때 할 일 — 타설 모니터의 권고 그대로 */
  actions: string[];
}

export interface PlantFact {
  name: string;
  travelMin: number;
  availableTrucks: number;
  isOpen: boolean;
  /** 제한시간 안에 도착 가능한가 */
  inTime: boolean;
}

export interface SurplusFact {
  plant: string;
  spec: string;
  volumeM3: number;
  unitPrice: number;
  normalPrice: number;
  discountPct: number;
  arrive: string;
  /** 늦어도 이때까지 현장에 닿아야 한다 HH:MM */
  deadline: string;
  slackMin: number;
  reachable: boolean;
}

export interface OrderFact {
  code: string;
  plant: string;
  /** '수락 대기' 같은 화면 문구 */
  status: string;
  volumeM3: number;
  /** 타설 시작 예정 HH:MM */
  pourStart: string;
}

export interface SiteContext {
  site: string;
  now: string;
  tempC: number | null;
  /** 이 기온의 비비기~타설 제한(분) */
  limitMinutes: number | null;
  /** 아직 끝나지 않은 주문 — 최근 것이 앞에 */
  orders: OrderFact[];
  deliveries: DeliveryFact[];
  pours: PourFact[];
  plants: PlantFact[];
  surplus: SurplusFact[];
}

/** [가정] 레캉쌤에게 보여 줄 근처 공장 수 — 많으면 답이 길어진다 */
const NEARBY_PLANTS = 5;
/** [가정] 레캉쌤에게 보여 줄 급처 매물 수 */
const SURPLUS_SHOWN = 3;
/** [가정] 레캉쌤에게 보여 줄 진행 중 주문 수 */
const ORDERS_SHOWN = 5;

export function buildSiteContext(
  db: Db,
  site: Site,
  now: number,
  tempC: number | null,
): SiteContext {
  const active = db.deliveries
    .filter((d) => d.siteId === site.id && !d.completedAt)
    .sort((a, b) => a.etaCurrentAt - b.etaCurrentAt);

  const deliveries: DeliveryFact[] = active.map((d) => {
    const plant = db.plants.find((p) => p.id === d.plantId);
    const truck = db.trucks.find((t) => t.id === d.truckId);
    const order = db.orders.find((o) => o.id === d.orderId);
    const phase = DeliveryRules.phase(d, now);
    const arrived = phase === 'onsite';
    const pos = arrived ? null : getPosition(d, locationsOf(db, d.id), now);
    const etaAt = arrived ? (d.arriveAt ?? now) : (pos?.etaAt ?? d.etaCurrentAt);
    const delay = analyzeDelay(d);

    // 슬럼프 — 기사 출발부터 잰다. 기온은 지금 현장 기온, 모르면 주문 때 기온
    let slump: SlumpFact | undefined;
    if (order && order.spec.slumpKind === 'slump') {
      const slumpTempC = tempC ?? order.tempC;
      const e = estimateSlump({
        initialMm: d.initialSlumpMm ?? order.spec.slumpMm,
        orderedMm: order.spec.slumpMm,
        departAt: d.departAt,
        arriveAt: etaAt,
        arrived,
        now,
        tempC: slumpTempC,
      });
      slump = {
        initialMm: e.initialMm,
        orderedMm: e.orderedMm,
        elapsedMin: e.elapsedMin,
        nowMm: e.nowMm,
        atArrivalMm: e.atArrivalMm,
        rateNow: e.rateNow,
        phase: e.phase,
        lowerMm: e.lowerMm,
        belowLower: e.belowLower,
        tempC: slumpTempC,
      };
    }

    return {
      slump,
      truck: truck ? `${truck.no}호차` : '차량',
      plant: plant?.name ?? '',
      spec: order ? specText(order.spec) : '',
      phase: PHASE_LABEL[phase],
      eta: clock(etaAt),
      etaInMin: arrived ? 0 : Math.max(0, Math.round((etaAt - now) / MIN)),
      remainingKm: arrived ? 0 : round1(d.distanceKm * (1 - (pos?.progress ?? 0))),
      delay: delay.text,
      delayMin: delay.minutes,
      delayReason: d.delayReason,
      limitSlackMin: Math.round((d.limitAt - Math.max(now, etaAt)) / MIN),
      limitMinutes: d.limitMinutes,
      level: DeliveryRules.limitLevel(d, now),
    };
  });

  // 타설 중인 주문마다 콜드조인트 판정
  const pourOrderIds = [...new Set(active.map((d) => d.orderId))];
  const pours: PourFact[] = pourOrderIds.flatMap((orderId) => {
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return [];
    const m = monitorPour({
      totalVolumeM3: order.volumeM3,
      tempC: order.tempC,
      deliveries: db.deliveries.filter((d) => d.orderId === orderId),
      now,
    });
    return [
      {
        order: order.code,
        pouredM3: round1(m.pouredM3),
        remainingM3: round1(m.remainingM3),
        gapMinutes: m.gapMinutes,
        jointSlackMin: m.jointSlackMin,
        coldJointLimitMin: m.coldJointLimitMin,
        level: m.level,
        message: m.message,
        actions: recommend(
          m,
          db.plants.find((p) => p.id === order.plantId)?.availableTrucks ?? 0,
        ).map((r) => r.action),
      },
    ];
  });

  // 근처 공장 — 길찾기 API 를 부르지 않고 근사로 잰다. 대화 한 번에 공장 수만큼
  // 호출하면 느리고 무료 제공량이 금방 닳는다. 정확한 값은 주문 화면이 낸다.
  const allowed = tempC == null ? null : PourRules.allowedTravelMinutes(tempC);
  const travelOf = (p: { lat: number; lng: number }) => approximateRoute(p, site, now).minutes;
  const plants: PlantFact[] = db.plants
    .map((p) => {
      const travelMin = travelOf(p);
      return {
        name: p.name,
        travelMin,
        availableTrucks: p.availableTrucks,
        isOpen: p.isOpen,
        inTime: allowed == null ? true : travelMin <= allowed,
      };
    })
    .sort((a, b) => a.travelMin - b.travelMin)
    .slice(0, NEARBY_PLANTS);

  const surplus: SurplusFact[] = offersForSite(db.surplus, db.plants, now, travelOf)
    .slice(0, SURPLUS_SHOWN)
    .map((o) => ({
      plant: o.plant.name,
      spec: specText(o.listing.spec),
      volumeM3: o.listing.volumeM3,
      unitPrice: o.unitPrice,
      normalPrice: o.listing.unitPrice,
      discountPct: o.listing.discountPct,
      arrive: clock(o.arriveAt),
      deadline: clock(o.deadlineAt),
      slackMin: o.slackMinutes,
      reachable: o.reachable,
    }));

  const orders: OrderFact[] = db.orders
    .filter((o) => o.siteId === site.id && ['requested', 'accepted', 'delivering'].includes(o.status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, ORDERS_SHOWN)
    .map((o) => ({
      code: o.code,
      plant: db.plants.find((p) => p.id === o.plantId)?.name ?? '',
      status: ORDER_STATUS_LABEL[o.status],
      volumeM3: o.volumeM3,
      pourStart: clock(o.pourStartAt),
    }));

  return {
    site: site.name,
    now: clock(now),
    tempC,
    limitMinutes: tempC == null ? null : PourRules.limitMinutes(tempC),
    orders,
    deliveries,
    pours,
    plants,
    surplus,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const locationsOf = (db: Db, deliveryId: string) =>
  db.truckLocations.filter((l) => l.deliveryId === deliveryId);

/* ==========================================================================
 * 키 없이 답하기 — 질문 종류를 가려 정해진 문장에 숫자를 꽂는다
 *
 * 말을 조금 바꿔도 알아듣도록 같은 뜻의 표현을 넓게 잡는다. 판단 순서가 중요하다:
 * "콜드조인트가 뭐예요"(지식)와 "콜드조인트 괜찮아요?"(내 현장)는 같은 낱말을 쓰지만
 * 묻는 것이 다르다. 그래서 '뭐·뜻·방법' 같은 말이 있으면 지식을 먼저 본다.
 * ======================================================================== */

export type Intent =
  | 'smalltalk'
  | 'faq'
  // 운반 중 슬럼프
  | 'slump'
  // 배송을 더 파고드는 질문
  | 'limitLeft'
  | 'delayWhy'
  | 'nextTruck'
  | 'truck'
  // 주문
  | 'orderTime'
  | 'order'
  | 'delivery'
  // 타설
  | 'pourFix'
  | 'pourRemain'
  | 'pour'
  // 급처
  | 'surplusPrice'
  | 'surplusDeadline'
  | 'surplusHow'
  // 공장
  | 'plantsInTime'
  | 'plantsTrucks'
  | 'surplus'
  | 'plants'
  | 'general';

/** 일반 지식 — 숫자는 lib/rules.ts 의 값만 쓴다 */
interface Faq {
  id: string;
  keys: RegExp;
  answer: () => string;
}

const FAQ: Faq[] = [
  {
    id: 'flow',
    keys: /슬럼프플로|플로/,
    answer: () =>
      '슬럼프 플로는 굳지 않은 콘크리트가 옆으로 퍼진 지름(mm)이에요. 너무 묽어서 슬럼프로 재기 어려운 고유동 콘크리트에 써요.',
  },
  {
    id: 'slump',
    keys: /슬럼프/,
    answer: () =>
      '슬럼프는 굳지 않은 콘크리트가 얼마나 묽은지 재는 값이에요. 원뿔 틀에 채웠다가 틀을 빼면 가라앉은 높이(mm)를 재는데, 클수록 묽어서 붓기 쉽지만 너무 크면 재료가 분리될 수 있어요. 규격 25-24-150의 마지막 숫자가 슬럼프예요.',
  },
  {
    id: 'spec',
    keys: /규격|호칭|25-24|읽는|숫자세개|숫자의미/,
    answer: () =>
      "레미콘 규격은 '굵은골재 최대치수 - 호칭강도 - 슬럼프' 순서예요(KS F 4009). 25-24-150이면 골재 25mm, 강도 24MPa, 슬럼프 150mm라는 뜻이에요.",
  },
  {
    id: 'coldjoint',
    keys: /콜드조인트|콜드|이어치기/,
    answer: () =>
      `콜드조인트는 먼저 부은 콘크리트가 굳기 시작한 뒤에 다음 콘크리트를 이어 부어서 생기는 이음매예요. 물이 새거나 약해질 수 있어서, 이 앱은 다음 차가 늦어 이어치기 허용 간격(외기 ${RULES.HOT_THRESHOLD_C}℃ 이상 ${RULES.COLD_JOINT_LIMIT_HOT_MIN}분, 미만 ${RULES.COLD_JOINT_LIMIT_NORMAL_MIN}분)에 가까워지면 미리 경고해요.`,
  },
  {
    id: 'limit',
    keys: /제한시간|골드타임|시간제한|몇분안에|90분|120분|굳기전|언제까지부어/,
    answer: () =>
      `비비기 시작부터 타설 완료까지 외기 ${RULES.HOT_THRESHOLD_C}℃ 이상이면 ${RULES.LIMIT_HOT_MIN}분, 미만이면 ${RULES.LIMIT_NORMAL_MIN}분 안에 끝내야 해요. 그래서 이 앱은 공장마다 이 시간 안에 올 수 있는지부터 따져서 보여 줘요.`,
  },
  {
    id: 'curing',
    keys: /양생/,
    answer: () =>
      '양생은 부은 콘크리트가 제대로 굳도록 수분과 온도를 지켜 주는 일이에요. 기간과 방법은 기온과 시방서에 따라 달라서, 현장 책임기술자에게 확인해 주세요.',
  },
  {
    id: 'surplus',
    keys: /급처/,
    answer: () =>
      `급처 매물은 주문 취소나 출하 잔량으로 남은, 이미 비빈 레미콘을 공장이 정상가보다 최소 ${SURPLUS.MIN_DISCOUNT_PCT}% 싸게 내놓은 거예요. 이미 비볐기 때문에 제한시간 안에 도착할 수 있을 때만 받을 수 있고, '주문' 화면 맨 위에 떠요.`,
  },
  {
    id: 'allocate',
    keys: /AI배분|ai배분|배분/,
    answer: () =>
      "AI 배분은 한 공장이 다 대기 어려운 물량을 여러 공장에 나눠 주는 기능이에요. 거리·이동시간·시간당 출하 능력을 함께 따져서 중간에 끊기지 않게 공장별 대수와 출하 시각표를 짜요. 'AI 배분' 화면에서 쓸 수 있어요.",
  },
  {
    id: 'urgent',
    keys: /긴급/,
    answer: () =>
      "지금 당장 필요하면 '주문' 화면의 긴급주문을 쓰세요. 사양과 대수만 넣으면 상차 준비시간과 교통을 계산해 가장 빨리 올 수 있는 공장으로 바로 보내요.",
  },
  {
    id: 'note',
    keys: /납품서|송장/,
    answer: () =>
      "납품서는 차 한 대마다 한 장씩 나와요. 하역 완료를 누르면 확정돼서 '납품서' 화면으로 넘어오고, 인쇄하거나 날짜별로 내려받을 수 있어요.",
  },
  {
    id: 'favorite',
    keys: /즐겨찾기/,
    answer: () =>
      "자주 쓰는 배합은 주문을 보낸 뒤 '즐겨찾기에 저장'을 눌러 두세요. 다음부터 '주문' 화면에서 카드 한 번으로 주문서가 채워져요.",
  },
  {
    id: 'howto',
    keys: /주문(은|을)?(어떻게)?(하|해)|주문방법|어떻게주문|주문하려면/,
    answer: () =>
      "'주문' 화면에서 사양·물량·타설 시각을 넣으면 제한시간 안에 올 수 있는 공장만 남아요. 그중 하나를 골라 보내면 되고, 공장이 수락하면 '추적' 화면에서 차가 오는 걸 볼 수 있어요.",
  },
];

/** "~가 뭐예요", "~ 어떻게 해요" 처럼 뜻·방법을 묻는 말 */
const ASKS_MEANING = /뭐|무엇|무슨|뜻|의미|이란|란$|설명|방법|어떻게(하|해)|알려줘|궁금/;

const findFaq = (q: string) => FAQ.find((f) => f.keys.test(q));

/** 띄어쓰기·물음표를 지운 질문 */
const normalize = (question: string) => question.replace(/[\s?!.~,]/g, '');

/** 질문 종류 — 위에서부터 먼저 걸리는 것 */
export function classify(question: string): Intent {
  const q = normalize(question);
  if (/^(안녕|하이|hi|hello|반가)|고마|감사|수고|ㅎㅇ/i.test(q)) return 'smalltalk';
  // "콜드조인트 막으려면?" 은 뜻이 아니라 할 일을 묻는다 — 지식보다 먼저 본다
  if (/(콜드|끊|공백).*(막|대처|피하)/.test(q)) return 'pourFix';
  if (ASKS_MEANING.test(q) && findFaq(q)) return 'faq';
  // "슬럼프가 뭐예요" 는 위에서 지식으로 갔다. 남은 "슬럼프 얼마야" 는 내 차의 지금 값이다
  if (
    /슬럼프(?!플로)/.test(q) &&
    /얼마|지금|현재|몇|떨어|어때|괜찮|도착|호차|확인|변화|예상|빠졌|줄었/.test(q)
  )
    return 'slump';

  // 넓은 질문보다 좁은 질문을 먼저 본다 — "급처 얼마나 싸?" 는 '급처' 이기 전에 '가격' 이다
  if (/급처.*(얼마|가격|싸|싼)|얼마나싸/.test(q)) return 'surplusPrice';
  if (/급처.*(언제까지|몇시까지|시한)/.test(q)) return 'surplusDeadline';
  if (/급처.*(어떻게|받으려면|받는법|받는방법)/.test(q)) return 'surplusHow';
  if (/올수있는공장|시간안에.*공장|제때.*공장/.test(q)) return 'plantsInTime';
  if (/몇대|차몇|남은차/.test(q)) return 'plantsTrucks';
  if (/남은물량|얼마나부었|부은물량|몇루베/.test(q)) return 'pourRemain';
  if (/몇시타설|타설(시간|시작|몇시)/.test(q)) return 'orderTime';
  if (/굳기전까지|여유|얼마나남|몇분남/.test(q)) return 'limitLeft';
  if (/왜늦|늦는이유|늦어|지연/.test(q)) return 'delayWhy';
  if (/다음차|다음트럭/.test(q)) return 'nextTruck';

  if (/\d+호차/.test(q)) return 'truck';
  if (/주문상태|수락|접수|거절|주문.*(됐|됬|확인|들어갔)|받아줬|받았/.test(q)) return 'order';
  if (/콜드|이어치기|공백|끊기|끊길|끊겨|타설.*(괜찮|어때|상황)/.test(q)) return 'pour';
  if (/급처|매물|할인|싸|싼|저렴|남은레미콘/.test(q)) return 'surplus';
  if (/공장|근처|추천|어디서|업체|가까운/.test(q)) return 'plants';
  if (
    /안와|안오|안온|언제|어디|도착|늦|몇분|트럭|차가|차는|차량|배송|기사|오고|오나|오냐|들어와|들어오|위치|어디쯤|eta|레미콘/i.test(
      q,
    )
  )
    return 'delivery';
  if (findFaq(q)) return 'faq';
  return 'general';
}

const km = (v: number) => (v < 1 ? `${Math.round(v * 1000)}m` : `${v}km`);

/** 오는 차 한 대를 한두 문장으로 */
function deliveryLine(d: DeliveryFact): string {
  const where =
    d.etaInMin === 0
      ? `${d.truck}는 현장에 도착해 있어요.`
      : `${d.truck}(${d.plant})가 ${km(d.remainingKm)} 남았고, 약 ${d.etaInMin}분 뒤 ${d.eta}에 도착할 예정이에요.`;
  const late =
    d.delayMin > 0
      ? ` ${d.delayReason ? `${d.delayReason} 때문에 ` : ''}처음 예상보다 ${d.delayMin}분 늦어졌어요.`
      : '';
  const limit =
    d.limitSlackMin >= 0
      ? ` 굳기 전까지 ${d.limitSlackMin}분 여유가 있어요.`
      : ` 제한시간(${d.limitMinutes}분)을 ${-d.limitSlackMin}분 넘길 것 같아요. 공장에 바로 연락해 주세요.`;
  return where + late + limit;
}

const EXAMPLES = '"아까 주문한 거 왜 안 와요?", "근처 공장 어때?", "급처 매물 있어?", "슬럼프가 뭐예요?"';

/* ==========================================================================
 * 이어서 물어볼 질문
 *
 * 답한 뒤 입력칸 위에 띄운다. 여기 적는 질문은 전부 위의 classify 가 알아듣고
 * 키 없이 답할 수 있는 것이어야 한다 — 누른 추천 질문에 "답하기 어려워요"가
 * 나오면 안 된다. 테스트가 그것을 지킨다.
 * ======================================================================== */

export const SITE_STARTERS = ['아까 주문한 거 왜 안 와요?', '지금 근처 공장들 어때?', '급처 매물 있어?'];
export const GENERAL_STARTERS = ['슬럼프가 뭐예요?', '제한시간이 뭐예요?', '콜드조인트가 뭐야?'];

/** 지식 질문 다음에 이어 물을 것 — 내 현장 질문은 현장이 있을 때만 쓴다 */
const FAQ_NEXT: Record<string, { general: string[]; site?: string[] }> = {
  flow: { general: ['슬럼프가 뭐예요?', '규격 읽는 법 알려줘'] },
  slump: { general: ['슬럼프 플로가 뭐야?', '규격 읽는 법 알려줘'], site: ['지금 슬럼프 얼마야?'] },
  spec: { general: ['슬럼프가 뭐예요?', '슬럼프 플로가 뭐야?'], site: ['지금 근처 공장들 어때?'] },
  coldjoint: { general: ['제한시간이 뭐예요?', '양생이 뭐야?'], site: ['콜드조인트 괜찮아?', '콜드조인트 막으려면?'] },
  limit: { general: ['콜드조인트가 뭐야?'], site: ['굳기 전까지 얼마나 남았어?', '제한시간 안에 올 수 있는 공장은?'] },
  curing: { general: ['콜드조인트가 뭐야?'] },
  surplus: { general: ['제한시간이 뭐예요?'], site: ['급처 매물 있어?', '급처 얼마나 싸?'] },
  allocate: { general: ['긴급주문이 뭐야?', '주문은 어떻게 해?'] },
  urgent: { general: ['AI 배분이 뭐야?', '주문은 어떻게 해?'] },
  note: { general: ['즐겨찾기는 어떻게 써?'], site: ['주문 상태 알려줘'] },
  favorite: { general: ['주문은 어떻게 해?'] },
  howto: { general: ['즐겨찾기는 어떻게 써?', '긴급주문이 뭐야?'], site: ['주문 상태 알려줘'] },
};

/**
 * 방금 한 질문에 이어 물을 만한 질문 3개.
 * 같은 질문은 다시 권하지 않는다.
 */
export function followUps(question: string, c: SiteContext | null): string[] {
  const intent = classify(question);
  const q = normalize(question);
  const firstTruck = c?.deliveries[0]?.truck;

  let next: string[];
  if (intent === 'faq') {
    const f = FAQ_NEXT[findFaq(q)!.id];
    next = [...(c && f.site ? f.site : []), ...f.general];
  } else if (!c || intent === 'smalltalk' || intent === 'general') {
    next = c ? SITE_STARTERS : GENERAL_STARTERS;
  } else {
    // 방금 답을 한 단계 더 파고드는 질문 — 같은 주제 안에서만 고른다
    const late = c.deliveries.some((d) => d.delayMin > 0);
    const hasTrucks = c.deliveries.length > 0;
    /** "3호차 어디야" 처럼 차를 콕 집어 물었으면 그 번호 */
    const askedNo = q.match(/(\d+)호차/)?.[1];
    const byIntent: Partial<Record<Intent, string[]>> = {
      delivery: hasTrucks
        ? [`${firstTruck} 어디야?`, late ? '왜 늦어?' : '지금 슬럼프 얼마야?', '굳기 전까지 얼마나 남았어?']
        : ['주문 상태 알려줘', '몇 시 타설이야?'],
      truck: [
        askedNo ? `${askedNo}호차 슬럼프 얼마야?` : '지금 슬럼프 얼마야?',
        late ? '왜 늦어?' : '다음 차는 언제 와?',
        '굳기 전까지 얼마나 남았어?',
      ],
      slump: [
        '슬럼프가 뭐예요?',
        '굳기 전까지 얼마나 남았어?',
        late ? '왜 늦어?' : '다음 차는 언제 와?',
      ],
      limitLeft: [late ? '왜 늦어?' : '다음 차는 언제 와?', '타설 끊길 것 같아?', '제한시간이 뭐예요?'],
      delayWhy: ['굳기 전까지 얼마나 남았어?', '다음 차는 언제 와?', '타설 끊길 것 같아?'],
      nextTruck: [firstTruck ? `${firstTruck} 어디야?` : '주문 상태 알려줘', '굳기 전까지 얼마나 남았어?', '남은 물량 얼마야?'],
      order: ['몇 시 타설이야?', '아까 주문한 거 왜 안 와요?'],
      orderTime: ['주문 상태 알려줘', '아까 주문한 거 왜 안 와요?'],
      pour: ['콜드조인트 막으려면?', '남은 물량 얼마야?', '다음 차는 언제 와?'],
      pourFix: ['다음 차는 언제 와?', '남은 물량 얼마야?', '콜드조인트가 뭐야?'],
      pourRemain: ['다음 차는 언제 와?', '타설 끊길 것 같아?'],
      surplus: ['급처 얼마나 싸?', '급처 몇 시까지 받아야 해?', '급처 어떻게 받아?'],
      surplusPrice: ['급처 몇 시까지 받아야 해?', '급처 어떻게 받아?'],
      surplusDeadline: ['급처 얼마나 싸?', '급처 어떻게 받아?'],
      surplusHow: ['급처 얼마나 싸?', '급처 몇 시까지 받아야 해?'],
      plants: ['제한시간 안에 올 수 있는 공장은?', '공장마다 차 몇 대 남았어?'],
      plantsInTime: ['공장마다 차 몇 대 남았어?', '지금 근처 공장들 어때?'],
      plantsTrucks: ['제한시간 안에 올 수 있는 공장은?', '지금 근처 공장들 어때?'],
    };
    next = byIntent[intent] ?? SITE_STARTERS;
  }

  const asked = normalize(question);
  return next.filter((x) => normalize(x) !== asked).slice(0, 3);
}

/**
 * 키 없이 답한다. 현장이 없으면(첫 화면) 일반 지식만 답한다.
 */
export function offlineAnswer(question: string, c: SiteContext | null): string {
  const intent = classify(question);
  const q = normalize(question);

  if (intent === 'smalltalk') {
    return /고마|감사|수고/.test(q)
      ? '천만에요! 또 궁금한 거 있으면 언제든 물어보세요.'
      : `안녕하세요! 레캉쌤이에요. ${EXAMPLES}처럼 물어보세요.`;
  }
  if (intent === 'faq') return findFaq(q)!.answer();

  if (intent === 'general') {
    return `그건 아직 제가 답하기 어려워요. ${EXAMPLES}처럼 물어봐 주세요.`;
  }

  if (!c) {
    return "내 배송이나 근처 공장은 현장 화면에서 알려 드릴 수 있어요. 위의 '시작하기'에서 현장으로 들어와 다시 물어봐 주세요.";
  }
  return templateAnswer(intent, c, question);
}

const NO_TRUCK = (c: SiteContext) => `지금 ${c.site}로 오고 있는 차가 없어요.`;
const won = (v: number) => `${v.toLocaleString('ko-KR')}원`;

/** 운반 중 슬럼프 한 대분 */
function slumpLine(d: DeliveryFact): string {
  const s = d.slump!;
  const head =
    s.elapsedMin === 0
      ? `${d.truck}는 아직 출발 전이라 슬럼프가 처음 그대로 ${s.initialMm}mm예요.`
      : `${d.truck}는 출발 ${s.elapsedMin}분째(${s.phase})라 슬럼프가 처음 ${s.initialMm}mm에서 약 ${s.nowMm}mm로 떨어졌을 거예요.`;
  const arrival =
    s.atArrivalMm != null ? ` 도착 예정 ${d.eta}에는 약 ${s.atArrivalMm}mm예요.` : '';
  const why = ` 외기 ${s.tempC}℃ 기준으로 지금 분당 ${s.rateNow}mm씩 빠지고 있어요.`;
  const judge = s.belowLower
    ? ` 주문 ${s.orderedMm}mm의 하한 ${s.lowerMm}mm 아래로 떨어질 수 있어요. 받을 때 슬럼프 시험을 꼭 해 보세요.`
    : ` 주문 ${s.orderedMm}mm의 허용 범위(${s.lowerMm}mm 이상) 안이에요.`;
  return head + arrival + why + judge;
}

export function templateAnswer(intent: Intent, c: SiteContext, question = ''): string {
  switch (intent) {
    case 'slump': {
      if (c.deliveries.length === 0) return NO_TRUCK(c);
      const no = normalize(question).match(/(\d+)호차/)?.[1];
      const pick = no ? c.deliveries.filter((d) => d.truck === `${no}호차`) : c.deliveries;
      if (no && pick.length === 0) return `지금 오고 있는 차 중에 ${no}호차는 없어요.`;
      const known = pick.filter((d) => d.slump);
      if (known.length === 0) {
        return '슬럼프 플로 주문이라 운반 중 슬럼프는 추정하지 않아요. 현장에서 플로 시험으로 확인해 주세요.';
      }
      return (
        known.slice(0, 3).map(slumpLine).join('\n') +
        '\n(시간과 기온으로 잰 약산이라, 실제 값은 현장 슬럼프 시험으로 확인해 주세요.)'
      );
    }

    /* ── 배송을 더 파고드는 질문 ── */
    case 'limitLeft': {
      if (c.deliveries.length === 0) return NO_TRUCK(c);
      return c.deliveries
        .slice(0, 3)
        .map((d) =>
          d.limitSlackMin >= 0
            ? `${d.truck}는 굳기 전까지 ${d.limitSlackMin}분 남았어요(비비기부터 ${d.limitMinutes}분 제한).`
            : `${d.truck}는 제한시간(${d.limitMinutes}분)을 ${-d.limitSlackMin}분 넘길 것 같아요. 공장에 바로 연락해 주세요.`,
        )
        .join('\n');
    }

    case 'delayWhy': {
      if (c.deliveries.length === 0) return NO_TRUCK(c);
      const late = c.deliveries.filter((d) => d.delayMin > 0);
      if (late.length === 0) return '지금 늦는 차는 없어요. 모두 처음 예상한 시각대로 오고 있어요.';
      return late
        .slice(0, 3)
        .map(
          (d) =>
            `${d.truck}는 ${d.delayReason ? `${d.delayReason} 때문에 ` : ''}처음 예상보다 ${d.delayMin}분 늦어졌어요. 지금 예상 도착은 ${d.eta}예요.`,
        )
        .join('\n');
    }

    case 'nextTruck': {
      const next = c.deliveries.find((d) => d.etaInMin > 0);
      if (!next) {
        return c.deliveries.length > 0
          ? '오고 있는 차는 모두 현장에 도착해 있어요. 더 올 차는 없어요.'
          : NO_TRUCK(c);
      }
      return `다음 차는 ${next.truck}(${next.plant})예요. 약 ${next.etaInMin}분 뒤 ${next.eta}에 도착할 예정이에요.`;
    }

    /* ── 주문 ── */
    case 'orderTime': {
      if (c.orders.length === 0) return "진행 중인 주문이 없어요. '주문' 화면에서 새로 보낼 수 있어요.";
      return c.orders
        .slice(0, 3)
        .map((o) => `${o.code}(${o.plant})는 ${o.pourStart}에 타설을 시작할 예정이에요.`)
        .join('\n');
    }

    /* ── 타설 ── */
    case 'pourRemain': {
      const p = c.pours[0];
      if (!p) return '지금 타설 중인 주문이 없어요.';
      return `${p.order} 주문은 ${p.pouredM3}m³ 부었고 ${p.remainingM3}m³ 남았어요.`;
    }

    case 'pourFix': {
      const p = c.pours[0];
      if (!p) return '지금 타설 중인 주문이 없어서 막을 콜드조인트가 없어요.';
      if (p.actions.length === 0) {
        return `지금은 다음 차가 제때 와서 끊길 걱정이 없어요. ${p.message}`;
      }
      return `${p.message}\n이렇게 해 보세요: ${p.actions.join(' / ')}.`;
    }

    /* ── 급처 ── */
    case 'surplusPrice': {
      const ok = c.surplus.filter((s) => s.reachable);
      if (ok.length === 0) return '지금 제시간에 받을 수 있는 급처 매물이 없어요.';
      return ok
        .map(
          (s) =>
            `${s.plant}: m³당 ${won(s.normalPrice)} → ${won(s.unitPrice)}(${s.discountPct}% 할인), ${s.volumeM3}m³ 전체 ${won(Math.round(s.unitPrice * s.volumeM3))}이에요.`,
        )
        .join('\n');
    }

    case 'surplusDeadline': {
      const ok = c.surplus.filter((s) => s.reachable);
      if (ok.length === 0) return '지금 제시간에 받을 수 있는 급처 매물이 없어요.';
      return (
        ok
          .map(
            (s) =>
              `${s.plant} 매물은 늦어도 ${s.deadline}까지 현장에 닿아야 해요. 지금 받으면 ${s.arrive} 도착이라 ${s.slackMin}분 여유가 있어요.`,
          )
          .join('\n') + '\n이미 비빈 레미콘이라 시간이 지날수록 여유가 줄어요.'
      );
    }

    case 'surplusHow':
      return "'주문' 화면 맨 위 '급처 매물'에서 '이 매물 받기'를 누르고 한 번 더 확정하면, 그 공장으로 긴급 주문이 바로 가요. 제시간에 못 오는 매물은 버튼이 잠겨 있어요.";

    /* ── 공장 ── */
    case 'plantsInTime': {
      const ok = c.plants.filter((p) => p.isOpen && p.inTime);
      if (ok.length === 0) return '근처에 제한시간 안에 올 수 있는 공장이 없어요.';
      return (
        `제한시간 안에 올 수 있는 공장은 ${ok.map((p) => `${p.name}(${p.travelMin}분)`).join(', ')}이에요.` +
        (c.limitMinutes ? ` 지금 기온이면 비비기부터 ${c.limitMinutes}분 안에 타설을 끝내야 해요.` : '')
      );
    }

    case 'plantsTrucks': {
      const open = c.plants.filter((p) => p.isOpen);
      if (open.length === 0) return '근처에 지금 출하하는 공장이 없어요.';
      return `가까운 순으로 ${open.map((p) => `${p.name} ${p.availableTrucks}대`).join(', ')} 남았어요.`;
    }

    case 'truck': {
      const no = normalize(question).match(/(\d+)호차/)?.[1];
      const d = c.deliveries.find((x) => x.truck === `${no}호차`);
      if (!d) {
        const others = c.deliveries.map((x) => x.truck).join(', ');
        return others
          ? `지금 오고 있는 차 중에 ${no}호차는 없어요. 오는 차는 ${others}예요.`
          : `지금 ${c.site}로 오고 있는 차가 없어요.`;
      }
      return deliveryLine(d);
    }

    case 'order': {
      if (c.orders.length === 0) return "진행 중인 주문이 없어요. '주문' 화면에서 새로 보낼 수 있어요.";
      return c.orders
        .slice(0, 3)
        .map(
          (o) =>
            `${o.code}(${o.plant}, ${o.volumeM3}m³)는 지금 '${o.status}' 상태예요.` +
            (o.status === '수락 대기' ? ' 공장이 확인하면 바로 알려 드려요.' : ''),
        )
        .join('\n');
    }

    case 'delivery': {
      if (c.deliveries.length === 0) {
        const waiting = c.orders.find((o) => o.status === '수락 대기' || o.status === '출하 대기');
        return waiting
          ? `지금 오고 있는 차는 없어요. ${waiting.code} 주문이 '${waiting.status}' 상태라, 공장이 출하하면 '추적' 화면에 차가 떠요.`
          : `지금 ${c.site}로 오고 있는 차가 없어요. '추적' 화면에서 주문 상태를 확인해 보세요.`;
      }
      return c.deliveries.slice(0, 3).map(deliveryLine).join('\n');
    }

    case 'pour': {
      const p = c.pours[0];
      if (!p) return '지금 타설 중인 주문이 없어서 콜드조인트 걱정은 없어요.';
      const head = `${p.order} 주문은 ${p.pouredM3}m³ 부었고 ${p.remainingM3}m³ 남았어요.`;
      return `${head} ${p.message}`;
    }

    case 'surplus': {
      const ok = c.surplus.filter((s) => s.reachable);
      if (ok.length === 0) return '지금 제시간에 받을 수 있는 급처 매물이 없어요.';
      const s = ok[0];
      return (
        `${s.plant}에 ${s.spec} ${s.volumeM3}m³ 급처 매물이 있어요. ` +
        `m³당 ${s.normalPrice.toLocaleString('ko-KR')}원 → ${s.unitPrice.toLocaleString('ko-KR')}원(${s.discountPct}% 할인)이고, ` +
        `지금 받으면 ${s.arrive}에 도착해 ${s.slackMin}분 여유가 있어요. 주문 화면 맨 위에서 받을 수 있어요.`
      );
    }

    case 'plants': {
      const open = c.plants.filter((p) => p.isOpen && p.availableTrucks > 0 && p.inTime);
      if (open.length === 0) return '지금 제한시간 안에 올 수 있으면서 차가 남은 공장이 근처에 없어요.';
      const best = open[0];
      const rest = open
        .slice(1, 3)
        .map((p) => `${p.name}(${p.travelMin}분)`)
        .join(', ');
      return (
        `가장 가까운 건 ${best.name}이에요. 약 ${best.travelMin}분 거리이고 지금 차가 ${best.availableTrucks}대 남았어요.` +
        (rest ? ` 그다음은 ${rest} 순이에요.` : '') +
        (c.limitMinutes ? ` 지금 기온이면 비비기부터 ${c.limitMinutes}분 안에 타설을 끝내야 해서, 가까운 공장이 유리해요.` : '')
      );
    }

    default:
      return `저는 ${c.site}의 배송·타설·근처 공장·급처 매물을 알려 드릴 수 있어요. ${EXAMPLES}처럼 물어보세요.`;
  }
}

/* ==========================================================================
 * Claude 에 줄 지시문
 * ======================================================================== */

export const ASSISTANT_SYSTEM = `당신은 레미콘 매칭 앱 "레미go"의 도우미 "레캉쌤"입니다. 건설 현장 담당자의 질문에 답합니다.

답하는 법:
- 한국어 존댓말, 친근하게. 2~4문장으로 짧게. 운전·작업 중에 흘깃 보는 사람입니다.
- 채팅창은 글자를 그대로 보여 줍니다. 마크다운(**굵게**, #제목, - 목록, 표)을 쓰지 말고 평문으로 씁니다.
- 숫자(시각, 분, km, m³, 원, 기온)는 아래 <context> 에 있는 값만 씁니다. 없는 숫자를 추정하거나 만들지 않습니다. 모르면 모른다고 하고, 어느 화면에서 확인할 수 있는지 알려 줍니다.
- 숫자를 늘어놓지 말고 "그래서 무엇을 하면 되는지"와 "왜 그런지"를 말합니다. 예: 공장을 추천하면 왜 그 공장인지(거리, 남은 차, 제한시간 여유).
- 제한시간(비비기~타설 완료)을 넘길 위험이나 콜드조인트 위험이 있으면 먼저 말합니다.
- 급처 매물은 이미 비빈 레미콘이라 싸지만 시간 여유가 짧다는 점을 함께 말합니다.
- 배송의 slump 값은 출발 뒤 시간과 기온으로 잰 약산 추정입니다. 말할 때 "약"을 붙이고, 하한 아래로 떨어질 수 있으면 현장 슬럼프 시험을 권합니다.
- 레미콘·타설 일반 지식(슬럼프, 이어치기, 양생 등)은 답해도 되지만, 현장 판단이 필요한 것은 책임기술자 확인을 권합니다.
- 앱 화면 이름: 주문, 추적, 납품서, AI 배분, 즐겨찾기.`;

/**
 * 채팅창은 글자를 그대로 보여 준다. 지시해도 마크다운을 섞는 모델이 있어서
 * 굵게·제목·목록 기호를 걷어 낸다.
 */
export function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '· ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** context JSON 을 지시문 뒤에 붙인다. 시각이 바뀌므로 캐시하지 않는 부분이다. */
export const contextBlock = (c: SiteContext | null) =>
  c == null
    ? '<context>현장을 고르지 않은 상태(첫 화면)입니다. 일반 질문에만 답하고, 내 배송 같은 질문에는 현장 화면에서 물어 달라고 안내합니다.</context>'
    : `<context>\n${JSON.stringify(c)}\n</context>`;
