/**
 * 시연 시계 — 모든 시각 계산은 Date.now() 대신 simClock.now() 를 쓴다.
 *
 * 배속을 올리면 차량 이동·타이머가 빨라져 5시간짜리 타설을 몇 분 만에 보여 줄 수 있다.
 * 실서비스에서는 speed 를 1 로 두면 그냥 실제 시각이다.
 *
 * ── 왜 서버에 두는가 ─────────────────────────────────────────────────────
 * 전에는 localStorage 에만 뒀다. storage 이벤트는 **같은 브라우저의 탭끼리만**
 * 통하므로, 노트북·휴대폰 두 대로 시연하면 각자 다른 시계를 보게 된다.
 * 한쪽만 ×60 으로 올리면 1분 만에 1시간이 벌어진다.
 *
 * 이게 표시만의 문제가 아니다. 공장이 누른 '출하 지시'의 비비기 시작 시각은
 * 공장 기기 시계로 찍히고, 현장이 보는 '타설 기한 남은 시간'은 현장 기기 시계로
 * 계산된다. 시계가 갈라지면 기한이 이미 지난 것처럼 보인다.
 *
 * 그래서 Supabase 에 한 줄을 두고 Realtime 으로 공유한다. 어느 기기에서 배속을
 * 바꾸든 세 대가 같이 움직인다. 키가 없으면(조원 환경) 예전처럼 localStorage 로 돈다.
 *
 * ⚠ baseReal 은 배속을 바꾼 기기의 Date.now() 다. 기기 시계가 서로 많이 어긋나 있으면
 *   그 차이가 배속만큼 커진다(×60 이면 1초 차이 → 1분). 요즘 기기는 자동으로 시각을
 *   맞추므로 보통 문제가 안 되고, 어긋나 보이면 '지금 시각' 버튼으로 되돌리면 된다.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase/client';

const KEY = 'remicon.clock';

/** 시연 시계는 한 줄뿐이다 */
const ROW_ID = 1;

interface ClockState {
  /** 이 상태를 만든 기기의 실제 시각 */
  baseReal: number;
  /** 그때의 시연 시각 */
  baseSim: number;
  speed: number;
}

const fresh = (): ClockState => ({ baseReal: Date.now(), baseSim: Date.now(), speed: 1 });

let state: ClockState = fresh();
let hydrated = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((f) => f());

function apply(next: ClockState) {
  state = next;
  emit();
}

/* ==========================================================================
 * 브라우저 저장소 (키가 없을 때)
 * ======================================================================== */

function readLocal(): ClockState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fresh();
    const v = JSON.parse(raw) as ClockState;
    return Number.isFinite(v?.baseSim) ? v : fresh();
  } catch {
    return fresh();
  }
}

function writeLocal(next: ClockState) {
  apply(next);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 메모리로만 동작 */
  }
}

function startLocal() {
  apply(readLocal());
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) apply(readLocal());
  });
}

/* ==========================================================================
 * Supabase 공유
 * ======================================================================== */

interface ClockRow {
  base_real: string;
  base_sim: string;
  speed: number;
}

const fromRow = (r: ClockRow): ClockState => ({
  baseReal: new Date(r.base_real).getTime(),
  baseSim: new Date(r.base_sim).getTime(),
  speed: Number(r.speed),
});

async function startRemote() {
  const sb = getSupabase();
  if (!sb) return startLocal();

  const { data, error } = await sb
    .from('demo_clock')
    .select('base_real, base_sim, speed')
    .eq('id', ROW_ID)
    .maybeSingle<ClockRow>();

  // 표가 없으면(마이그레이션 전) 조용히 브라우저 저장소로 떨어진다 — 시계 때문에
  // 앱 전체가 멈추면 안 된다
  if (error) {
    console.warn('[clock] 공유 시계를 읽지 못했습니다. 이 기기에서만 동작합니다.', error.message);
    return startLocal();
  }
  if (data) apply(fromRow(data));

  sb.channel('demo-clock')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'demo_clock' },
      (payload) => {
        const row = payload.new as ClockRow | null;
        if (row?.base_sim) apply(fromRow(row));
      },
    )
    .subscribe();
}

async function writeRemote(next: ClockState) {
  // 먼저 내 화면에 반영하고(기다리면 버튼이 굼뜨다), 그다음 서버에 올린다
  apply(next);

  const sb = getSupabase();
  if (!sb) return;

  const { error } = await sb.from('demo_clock').upsert({
    id: ROW_ID,
    base_real: new Date(next.baseReal).toISOString(),
    base_sim: new Date(next.baseSim).toISOString(),
    speed: next.speed,
    updated_at: new Date().toISOString(),
  });
  if (error) console.warn('[clock] 공유 시계를 저장하지 못했습니다.', error.message);
}

/* ==========================================================================
 * 진입점
 * ======================================================================== */

function ensureHydrated() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  if (isSupabaseConfigured) void startRemote();
  else startLocal();
}

const write = (next: ClockState) => {
  if (isSupabaseConfigured) void writeRemote(next);
  else writeLocal(next);
};

export const simClock = {
  now(): number {
    ensureHydrated();
    return state.baseSim + (Date.now() - state.baseReal) * state.speed;
  },

  get speed() {
    ensureHydrated();
    return state.speed;
  },

  /** 지금 보고 있는 시연 시각을 유지한 채 배속만 바꾼다 */
  setSpeed(speed: number) {
    ensureHydrated();
    write({ baseReal: Date.now(), baseSim: this.now(), speed });
  },

  /** 시연 시나리오용 — 시계를 특정 시각으로 옮긴다 */
  jumpTo(at: number) {
    ensureHydrated();
    write({ baseReal: Date.now(), baseSim: at, speed: state.speed });
  },

  /**
   * 지금 시각으로 되돌린다 (배속도 ×1).
   * 배속을 올려 두면 시연 시각이 실제와 몇 시간씩 벌어진다. 리허설이 끝나고
   * 다시 시작할 때 이걸 누르면 모든 기기가 한 번에 제자리로 온다.
   */
  reset() {
    ensureHydrated();
    write(fresh());
  },

  /** 시연 시각이 실제 시각과 얼마나 벌어졌는지(분). 화면에 알려 주려고 둔다. */
  driftMinutes(): number {
    ensureHydrated();
    return Math.round((this.now() - Date.now()) / 60_000);
  },

  subscribe(fn: () => void) {
    ensureHydrated();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export const SPEED_OPTIONS = [1, 10, 30, 60, 120];
