/**
 * AI ① 공장별 배분 추천 — 지시서 6장.
 *
 * 문제: 총 물량 V 를 끊김없이 타설하려면 Δt 분마다 차 한 대가 도착해야 한다.
 *       주변 공장은 저마다 출하 가능 대수·시간당 출하 능력·이동시간이 다르다.
 *       "어느 회차를 어느 공장이 맡을지"를 정한다.
 *
 * 정수계획 모델
 *   변수   x[p][k] = 1 이면 k번째 차를 p공장이 보낸다
 *   목적   Σ 이동시간 최소화
 *   제약 ① 모든 회차는 정확히 한 공장이 맡는다      Σ_p x[p][k] = 1
 *   제약 ② 공장별 배정 합 ≤ 출하 가능 대수           Σ_k x[p][k] ≤ cap_p
 *   제약 ③ 어느 60분 구간에서도 ≤ 시간당 출하 능력   Σ_{k∈W} x[p][k] ≤ rate_p
 *   제약 ④ 이동시간 ≤ 허용 이동시간                  (후보에서 미리 거른다)
 *
 * 푸는 방법 — 솔버 없이 정확해를 얻는다.
 *   목적함수의 계수 c_p 가 회차 k 와 무관하므로, 목적값은 공장별 "대수" n_p 에만 달려 있다.
 *   따라서 ① 대수를 정하고(가까운 공장부터 채우되 제약 ②③의 상한을 지킨다 → LP 최적해와 같다)
 *          ② 그 대수를 만족하는 회차 배정을 고르게 펴서 찾는다(가중 라운드로빈)
 *          ③ 찾은 배정이 제약 ③ 을 지키는지 실제로 검사한다
 *   이 순서로 풀면 CBC·GLPK 같은 외부 솔버 없이도 같은 답이 나오고, 브라우저에서도 즉시 돈다.
 *
 * 핵심은 "가까운 공장부터 순서대로 다 쓰는 것"이 아니라 먼 공장을 처음부터 섞어 쓰는 것이다.
 * 가까운 공장만 먼저 비우면 후반에 먼 공장만 남아 시간당 출하 능력이 모자라 타설이 끊긴다.
 * simulateNaive() 가 바로 그 끊기는 지점을 계산해, 화면에서 두 방식을 나란히 보여 준다.
 */

import {
  DEFAULT_POUR_SETTINGS,
  MIN,
  PourRules,
  TRUCK_CAPACITY_M3,
  type PourSettings,
} from '../rules';

export interface AllocationPlantInput {
  id: string;
  name: string;
  /** 이번 타설에 보낼 수 있는 대수 (회차 수 해석 — 지시서 6장 '팀이 정할 해석') */
  availableTrucks: number;
  /** 이 현장 한 곳으로 시간당 내보낼 수 있는 최대 대수 */
  hourlyRate: number;
  /** 편도 이동시간(분) — 카카오 미래 운행 정보 + 트럭 보정 계수 */
  travelMinutes: number;
}

export interface AllocationInput {
  totalVolumeM3: number;
  /** 펌프 타설 속도 m³/h */
  pumpRate: number;
  pourStartAt: number;
  tempC: number;
  plants: AllocationPlantInput[];
  truckCapacityM3?: number;
  settings?: PourSettings;
}

export interface AllocatedPlant {
  plantId: string;
  plantName: string;
  trucks: number;
  travelMinutes: number;
  /** 배정된 회차 번호 (0부터) */
  rounds: number[];
  /** 회차별 출하(비비기 시작) 예정 시각 */
  mixStartAts: number[];
  /** 회차별 현장 도착 예정 시각 */
  arriveAts: number[];
}

export interface ExcludedPlant {
  plantId: string;
  plantName: string;
  travelMinutes: number;
  reason: string;
}

export interface AllocationAlternative {
  kind: 'pumpRate' | 'safetyMargin' | 'capacity';
  label: string;
  detail: string;
  /** 그 대안으로 다시 풀었을 때의 결과 (capacity 는 계산 불가라 없음) */
  pumpRate?: number;
  pourEndAt?: number;
}

export interface AllocationResult {
  feasible: boolean;
  /** 필요 대수 N */
  trucksNeeded: number;
  /** 도착 간격 Δt (분) */
  intervalMinutes: number;
  /** 비비기~타설 완료 제한 L (분) */
  limitMinutes: number;
  /** 허용 이동시간 T_허용 (분) */
  allowedTravelMinutes: number;
  pourStartAt: number;
  pourEndAt: number;
  items: AllocatedPlant[];
  excluded: ExcludedPlant[];
  /** 목적함수 값 — 이동시간 합(분) */
  totalTravelMinutes: number;
  /** 배정하지 못한 대수 (feasible 이면 0) */
  unassigned: number;
  alternatives: AllocationAlternative[];
  message: string;
}

/* ==========================================================================
 * 1. 기본량 — 지시서 6장 '계산 순서' 1
 * ======================================================================== */

/** N = ⌈V / q⌉ */
export const trucksNeeded = (totalVolumeM3: number, q = TRUCK_CAPACITY_M3) =>
  Math.ceil(totalVolumeM3 / q);

/** Δt = (q / R) × 60 — 차 한 대분을 타설하는 데 걸리는 시간 */
export const intervalMinutes = (pumpRate: number, q = TRUCK_CAPACITY_M3) => (q / pumpRate) * 60;

/* ==========================================================================
 * 2. 대수 정하기 — 제약 ②③ 상한 안에서 이동시간이 짧은 공장부터
 * ======================================================================== */

/**
 * 한 공장이 이번 타설 전체(spanMinutes) 동안 제약 ③ 을 지키며 낼 수 있는 최대 대수.
 * 60분 구간마다 rate 대가 상한이므로, 전체 구간 수만큼 곱한다.
 */
function rateCap(hourlyRate: number, spanMinutes: number) {
  return Math.floor((hourlyRate * spanMinutes) / 60);
}

interface CountSolution {
  counts: Map<string, number>;
  unassigned: number;
}

function solveCounts(
  candidates: AllocationPlantInput[],
  need: number,
  spanMinutes: number,
): CountSolution {
  // 이동시간 오름차순. 같으면 출하 여력이 큰 쪽을 먼저 써서 뒤에 여유를 남긴다.
  const sorted = [...candidates].sort(
    (a, b) => a.travelMinutes - b.travelMinutes || b.availableTrucks - a.availableTrucks,
  );
  const counts = new Map<string, number>();
  let remaining = need;
  for (const p of sorted) {
    if (remaining <= 0) break;
    const cap = Math.min(p.availableTrucks, rateCap(p.hourlyRate, spanMinutes));
    const take = Math.min(cap, remaining);
    if (take > 0) {
      counts.set(p.id, take);
      remaining -= take;
    }
  }
  return { counts, unassigned: remaining };
}

/* ==========================================================================
 * 3. 회차 배정 — 정해진 대수를 전체 회차에 고르게 편다
 * ======================================================================== */

/**
 * 가중 라운드로빈(최대 잔여 우선). 회차마다 "남은 대수 ÷ 남은 회차"가 가장 큰 공장을 고른다.
 * 그러면 각 공장의 회차가 전체에 n_p/N 밀도로 흩어져, 어느 60분 구간에도 몰리지 않는다.
 * 같은 값이면 이동시간이 짧은 공장을 먼저 — 결과가 실행할 때마다 달라지지 않게 한다.
 */
function scheduleRounds(
  candidates: AllocationPlantInput[],
  counts: Map<string, number>,
  total: number,
  windowSize: number,
): Map<string, number[]> | null {
  const active = candidates.filter((p) => (counts.get(p.id) ?? 0) > 0);
  const remaining = new Map(active.map((p) => [p.id, counts.get(p.id)!]));
  const assigned = new Map<string, number[]>(active.map((p) => [p.id, []]));

  /** 이 공장이 round 를 맡으면 어떤 60분 구간에서도 rate 를 넘지 않는가 */
  const fitsWindow = (p: AllocationPlantInput, round: number) => {
    const mine = assigned.get(p.id)!;
    // round 를 포함하는 모든 windowSize 크기 구간을 본다
    for (let start = round - windowSize + 1; start <= round; start++) {
      const end = start + windowSize - 1;
      let inWindow = 1; // round 본인
      for (const r of mine) if (r >= start && r <= end) inWindow++;
      if (inWindow > p.hourlyRate) return false;
    }
    return true;
  };

  for (let k = 0; k < total; k++) {
    const roundsLeft = total - k;
    let best: AllocationPlantInput | null = null;
    let bestScore = -Infinity;

    for (const p of active) {
      const left = remaining.get(p.id)!;
      if (left <= 0) continue;
      if (!fitsWindow(p, k)) continue;
      // 남은 회차 대비 아직 보내야 할 비율이 큰 공장이 급하다
      const score = left / roundsLeft;
      if (
        score > bestScore + 1e-9 ||
        (Math.abs(score - bestScore) < 1e-9 && best && p.travelMinutes < best.travelMinutes)
      ) {
        bestScore = score;
        best = p;
      }
    }

    if (!best) return null; // 어떤 공장도 이 회차를 맡을 수 없다
    assigned.get(best.id)!.push(k);
    remaining.set(best.id, remaining.get(best.id)! - 1);
  }

  return assigned;
}

/* ==========================================================================
 * 4. 본체
 * ======================================================================== */

export function allocate(input: AllocationInput): AllocationResult {
  const q = input.truckCapacityM3 ?? TRUCK_CAPACITY_M3;
  const settings = input.settings ?? DEFAULT_POUR_SETTINGS;

  const N = trucksNeeded(input.totalVolumeM3, q);
  const dt = intervalMinutes(input.pumpRate, q);
  const limit = PourRules.limitMinutes(input.tempC);
  const allowed = PourRules.allowedTravelMinutes(input.tempC, settings);

  // 타설은 총 물량 ÷ 펌프 속도 만큼 걸린다
  const pourDurationMin = (input.totalVolumeM3 / input.pumpRate) * 60;
  const pourEndAt = input.pourStartAt + pourDurationMin * MIN;
  // 첫 차 도착부터 마지막 차 도착까지
  const spanMinutes = (N - 1) * dt + dt;
  // 60분 구간이 회차 몇 개에 해당하는가
  const windowSize = Math.max(1, Math.round(60 / dt));

  // ── 제약 ④ : 허용 이동시간을 넘는 공장은 후보에서 뺀다 ──
  const excluded: ExcludedPlant[] = [];
  const candidates: AllocationPlantInput[] = [];
  for (const p of input.plants) {
    if (p.travelMinutes > allowed) {
      excluded.push({
        plantId: p.id,
        plantName: p.name,
        travelMinutes: p.travelMinutes,
        reason: `이동 ${Math.round(p.travelMinutes)}분 > 허용 ${allowed}분`,
      });
    } else if (p.availableTrucks <= 0) {
      excluded.push({
        plantId: p.id,
        plantName: p.name,
        travelMinutes: p.travelMinutes,
        reason: '출하 가능 차량 없음',
      });
    } else {
      candidates.push(p);
    }
  }

  const base = {
    trucksNeeded: N,
    intervalMinutes: dt,
    limitMinutes: limit,
    allowedTravelMinutes: allowed,
    pourStartAt: input.pourStartAt,
    pourEndAt,
    excluded,
  };

  const { counts, unassigned } = solveCounts(candidates, N, spanMinutes);
  const schedule = unassigned > 0 ? null : scheduleRounds(candidates, counts, N, windowSize);

  if (unassigned > 0 || !schedule) {
    const shortfall = unassigned > 0 ? unassigned : N;
    return {
      ...base,
      feasible: false,
      items: [],
      totalTravelMinutes: 0,
      unassigned: shortfall,
      alternatives: buildAlternatives(input, q, settings, allowed),
      message:
        unassigned > 0
          ? `${N}대 중 ${shortfall}대를 배정할 공장이 없습니다. 허용 이동시간 ${allowed}분 안에 있는 공장의 출하 여력이 모자랍니다.`
          : `공장별 출하 능력(시간당 대수) 때문에 ${dt.toFixed(1)}분 간격을 맞출 수 없습니다.`,
    };
  }

  const items: AllocatedPlant[] = candidates
    .filter((p) => (counts.get(p.id) ?? 0) > 0)
    .map((p) => {
      const rounds = schedule.get(p.id)!;
      const arriveAts = rounds.map((k) => input.pourStartAt + k * dt * MIN);
      const mixStartAts = arriveAts.map(
        (at) => at - p.travelMinutes * MIN - settings.prepMinutes * MIN,
      );
      return {
        plantId: p.id,
        plantName: p.name,
        trucks: rounds.length,
        travelMinutes: p.travelMinutes,
        rounds,
        arriveAts,
        mixStartAts,
      };
    })
    .sort((a, b) => a.travelMinutes - b.travelMinutes);

  const totalTravelMinutes = items.reduce((s, it) => s + it.trucks * it.travelMinutes, 0);

  return {
    ...base,
    feasible: true,
    items,
    totalTravelMinutes,
    unassigned: 0,
    alternatives: [],
    message: `${items.length}개 공장에서 ${N}대를 ${dt.toFixed(1)}분 간격으로 받으면 끊김없이 타설됩니다.`,
  };
}

/* ==========================================================================
 * 5. 배분이 불가능할 때의 대안 — 지시서 6장
 *    "불가"만 말하지 않고 같이 내놓는다.
 * ======================================================================== */

function buildAlternatives(
  input: AllocationInput,
  q: number,
  settings: PourSettings,
  allowed: number,
): AllocationAlternative[] {
  const out: AllocationAlternative[] = [];

  // ① 펌프 속도를 낮추면 간격이 늘어 같은 공장으로도 맞출 수 있다
  for (let rate = input.pumpRate - 5; rate >= 20; rate -= 5) {
    const trial = allocate({ ...input, pumpRate: rate, truckCapacityM3: q, settings });
    if (trial.feasible) {
      out.push({
        kind: 'pumpRate',
        label: `펌프 속도를 ${rate}m³/h 로 낮추기`,
        detail: `도착 간격 ${trial.intervalMinutes.toFixed(1)}분, 타설 종료 ${fmtClock(trial.pourEndAt)}`,
        pumpRate: rate,
        pourEndAt: trial.pourEndAt,
      });
      break;
    }
  }

  // ② 안전 여유를 줄이면 먼 공장도 후보가 된다 (지시서: 교통이 막히면 바로 제한 초과)
  if (settings.safetyMarginMinutes > 0) {
    const relaxed = { ...settings, safetyMarginMinutes: 0 };
    const trial = allocate({ ...input, truckCapacityM3: q, settings: relaxed });
    if (trial.feasible) {
      out.push({
        kind: 'safetyMargin',
        label: `안전 여유 ${settings.safetyMarginMinutes}분을 0으로 두기`,
        detail: `허용 이동시간이 ${allowed}분 → ${trial.allowedTravelMinutes}분으로 늘어 공장이 추가됩니다. 다만 교통이 조금만 막혀도 제한시간을 넘습니다.`,
      });
    }
  }

  // ③ 사람이 해야 하는 일
  out.push({
    kind: 'capacity',
    label: '공장에 출하 능력 상향 요청 또는 응결지연제 협의',
    detail:
      '시간당 출하 대수를 올려 줄 수 있는지 공장에 확인하고, 책임기술자와 응결지연제 사용을 협의하면 제한시간 자체가 늘어납니다.',
  });

  return out;
}

const fmtClock = (at: number) =>
  new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

/* ==========================================================================
 * 6. 비교용 — 가까운 공장부터 채우는 단순 방식
 *    이 방식이 중간에 끊긴다는 것이 AI 배분을 쓰는 이유다 (지시서 6장).
 * ======================================================================== */

export interface NaiveResult {
  /** 끊김없이 채운 회차 수 */
  filled: number;
  /** 끊긴 회차 번호 (0부터). 끝까지 채웠으면 null */
  brokeAtRound: number | null;
  brokeAtTime: number | null;
  counts: { plantId: string; plantName: string; trucks: number }[];
}

export function simulateNaive(input: AllocationInput): NaiveResult {
  const q = input.truckCapacityM3 ?? TRUCK_CAPACITY_M3;
  const settings = input.settings ?? DEFAULT_POUR_SETTINGS;
  const N = trucksNeeded(input.totalVolumeM3, q);
  const dt = intervalMinutes(input.pumpRate, q);
  const allowed = PourRules.allowedTravelMinutes(input.tempC, settings);
  const windowSize = Math.max(1, Math.round(60 / dt));

  const pool = input.plants
    .filter((p) => p.travelMinutes <= allowed && p.availableTrucks > 0)
    .sort((a, b) => a.travelMinutes - b.travelMinutes);

  const left = new Map(pool.map((p) => [p.id, p.availableTrucks]));
  const used = new Map<string, number[]>(pool.map((p) => [p.id, []]));

  const fitsWindow = (p: AllocationPlantInput, round: number) => {
    const mine = used.get(p.id)!;
    for (let start = round - windowSize + 1; start <= round; start++) {
      const end = start + windowSize - 1;
      let inWindow = 1;
      for (const r of mine) if (r >= start && r <= end) inWindow++;
      if (inWindow > p.hourlyRate) return false;
    }
    return true;
  };

  for (let k = 0; k < N; k++) {
    // 가까운 공장부터 — 남아 있고 구간 제약에 걸리지 않는 첫 공장
    const pick = pool.find((p) => (left.get(p.id) ?? 0) > 0 && fitsWindow(p, k));
    if (!pick) {
      return {
        filled: k,
        brokeAtRound: k,
        brokeAtTime: input.pourStartAt + k * dt * MIN,
        counts: countsOf(pool, used),
      };
    }
    used.get(pick.id)!.push(k);
    left.set(pick.id, left.get(pick.id)! - 1);
  }

  return { filled: N, brokeAtRound: null, brokeAtTime: null, counts: countsOf(pool, used) };
}

const countsOf = (pool: AllocationPlantInput[], used: Map<string, number[]>) =>
  pool
    .map((p) => ({ plantId: p.id, plantName: p.name, trucks: used.get(p.id)?.length ?? 0 }))
    .filter((c) => c.trucks > 0);
