/**
 * 시연 시계 — 모든 시각 계산은 Date.now() 대신 simClock.now() 를 쓴다.
 * 배속을 올리면 차량 이동·타이머가 빨라져 5시간짜리 타설을 몇 분 만에 보여 줄 수 있다.
 * 탭 간 공유(localStorage)라 현장 탭과 공장 탭의 시계가 같이 움직인다.
 *
 * 실서비스에서는 speed 를 1 로 두면 그냥 실제 시각이다.
 */

const KEY = 'remicon.clock';

interface ClockState {
  baseReal: number;
  baseSim: number;
  speed: number;
}

const fresh = (): ClockState => ({ baseReal: Date.now(), baseSim: Date.now(), speed: 1 });

function read(): ClockState {
  if (typeof window === 'undefined') return fresh();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fresh();
    const v = JSON.parse(raw) as ClockState;
    return Number.isFinite(v?.baseSim) ? v : fresh();
  } catch {
    return fresh();
  }
}

let state: ClockState = fresh();
let hydrated = false;
const listeners = new Set<() => void>();

function ensureHydrated() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  state = read();
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    state = read();
    listeners.forEach((f) => f());
  });
}

function write(next: ClockState) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 메모리로만 동작 */
  }
  listeners.forEach((f) => f());
}

export const simClock = {
  now(): number {
    ensureHydrated();
    return state.baseSim + (Date.now() - state.baseReal) * state.speed;
  },
  get speed() {
    ensureHydrated();
    return state.speed;
  },
  setSpeed(speed: number) {
    ensureHydrated();
    write({ baseReal: Date.now(), baseSim: this.now(), speed });
  },
  /** 시연 시나리오용 — 시계를 특정 시각으로 옮긴다 */
  jumpTo(at: number) {
    ensureHydrated();
    write({ baseReal: Date.now(), baseSim: at, speed: state.speed });
  },
  reset() {
    write(fresh());
  },
  subscribe(fn: () => void) {
    ensureHydrated();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export const SPEED_OPTIONS = [1, 10, 30, 60, 120];
