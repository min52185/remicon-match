'use client';

/**
 * 긴급 알림 소리.
 *
 * 공장·기사는 화면을 계속 보고 있지 않는다. 긴급주문이 떠도 눈에 안 들어오면
 * 알림이 없는 것과 같다. 짧은 소리 하나를 더한다.
 *
 * 오디오 파일을 쓰지 않고 Web Audio 로 만든다 — 파일을 받는 동안 소리가 늦고,
 * 몇십 KB 라도 현장 데이터를 쓴다. 두 음을 빠르게 올려 치면 "삐빅" 이 된다.
 *
 * ⚠ 브라우저는 사용자가 화면을 한 번이라도 누르기 전에는 소리를 막는다(자동재생
 *   정책). 그래서 소리에만 기대지 않는다 — 배너·배지가 먼저고 소리는 거들 뿐이다.
 */

/** [가정] 현장 소음 속에서도 들리되 거슬리지 않을 만큼 */
const VOLUME = 0.22;

/** 두 음을 빠르게 — 낮은 음 뒤에 높은 음이면 "주의" 로 들린다 */
const NOTES: { hz: number; at: number; dur: number }[] = [
  { hz: 880, at: 0, dur: 0.12 },
  { hz: 1320, at: 0.15, dur: 0.18 },
];

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;

  const C: Ctor | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!C) return null;

  try {
    ctx = new C();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * 긴급 알림음 한 번.
 * 소리를 못 내는 상황(자동재생 차단·오디오 없음)에서는 조용히 넘어간다 —
 * 알림 때문에 화면이 멈추면 안 된다.
 */
export function playUrgentChime() {
  const c = context();
  if (!c) return;

  try {
    // 다른 탭에 있다가 돌아오면 멈춰 있을 수 있다
    if (c.state === 'suspended') void c.resume();

    for (const n of NOTES) {
      const osc = c.createOscillator();
      const gain = c.createGain();

      osc.type = 'sine';
      osc.frequency.value = n.hz;

      // 뚝 끊으면 '틱' 잡음이 난다 — 끝을 부드럽게 줄인다
      const start = c.currentTime + n.at;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(VOLUME, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);

      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + n.dur + 0.02);
    }
  } catch {
    /* 소리는 거들 뿐이다 */
  }
}
