/**
 * 이어치기 시간간격 판정을 KCS 14 20 10:2024-12-30 표 3.3-1 에 고정한다.
 *
 *   외기온도 25 ℃ 초과 → 2.0시간(120분)
 *   외기온도 25 ℃ 이하 → 2.5시간(150분)
 *   주) 하층 콘크리트 비비기 시작 ~ 상층 콘크리트가 타설되기까지
 *
 * 마지막 주석이 핵심이다. 타설이 멈춰 있는 시간(공백)이 아니라
 * 비비기 시작부터 재므로, 운반·하역 시간이 전부 이 간격에 들어간다.
 */

import { describe, expect, it } from 'vitest';
import { monitorPour } from '../lib/ai/predict';
import { MIN, RULES, UNLOAD_EST_MIN, coldJointLimitMinutes } from '../lib/rules';
import type { Delivery } from '../lib/types';

/** 2026-09-26 09:00 (로컬) */
const T0 = new Date(2026, 8, 26, 9, 0, 0).getTime();
const at = (min: number) => T0 + min * MIN;

let seq = 0;
function delivery(p: Partial<Delivery> & { mixStartAt: number }): Delivery {
  seq += 1;
  return {
    id: `d${seq}`,
    orderId: 'o1',
    truckId: `t${seq}`,
    plantId: 'p1',
    siteId: 's1',
    volumeM3: 6,
    departAt: p.mixStartAt + 10 * MIN,
    etaInitialAt: p.mixStartAt + 40 * MIN,
    etaCurrentAt: p.mixStartAt + 40 * MIN,
    limitMinutes: 120,
    limitAt: p.mixStartAt + 120 * MIN,
    travelMinutes: 30,
    path: [],
    distanceKm: 20,
    ...p,
  };
}

describe('coldJointLimitMinutes — 표 3.3-1 의 경계', () => {
  it('25℃ 이하는 150분, 초과는 120분 (경계가 이하/초과)', () => {
    expect(coldJointLimitMinutes(24)).toBe(150);
    expect(coldJointLimitMinutes(25)).toBe(150); // 25 는 '이하' 쪽
    expect(coldJointLimitMinutes(26)).toBe(120);
  });

  it('비비기~타설 제한과 25℃ 에서 갈린다 (한쪽은 이상/미만)', () => {
    // 이어치기는 25℃ 를 '이하'(= 넉넉한 150분)로, 비비기~타설은 '이상'(= 빡빡한 90분)으로 본다
    expect(coldJointLimitMinutes(25)).toBe(RULES.COLD_JOINT_LIMIT_NORMAL_MIN);
    expect(25 >= RULES.HOT_THRESHOLD_C).toBe(true);
  });
});

describe('monitorPour — 이어치기 간격과 타설 공백은 다른 숫자다', () => {
  /** 하층: 09:00 비비기 → 09:40 도착 → 10:00 타설 종료 예상 */
  const lower = () => delivery({ mixStartAt: at(0), arriveAt: at(40) });

  it('공백은 타설 종료부터, 이어치기 간격은 비비기 시작부터 잰다', () => {
    const m = monitorPour({
      totalVolumeM3: 12,
      tempC: 20,
      now: at(45),
      deliveries: [lower(), delivery({ mixStartAt: at(30), etaCurrentAt: at(70) })],
    });

    // 타설 종료 10:00(=60분) → 다음 차 도착 10:10(=70분)
    expect(m.gapMinutes).toBe(70 - (40 + UNLOAD_EST_MIN));
    expect(m.gapMinutes).toBe(10);

    // 하층 비비기 09:00(=0분) → 다음 차 도착 10:10(=70분)
    expect(m.jointIntervalMin).toBe(70);

    // 간격이 공백보다 훨씬 크다 — 이게 원문 확인으로 잡은 차이다
    expect(m.jointIntervalMin!).toBeGreaterThan(m.gapMinutes!);
    expect(m.jointSlackMin).toBe(150 - 70);
    expect(m.level).toBe('ok');
  });

  it('공백은 짧아도 이어치기 간격이 한도를 넘으면 위험으로 잡는다', () => {
    // 다음 차 도착 11:35(=155분) — 공백은 95분이지만 간격은 155분으로 한도 150분 초과
    const m = monitorPour({
      totalVolumeM3: 12,
      tempC: 20,
      now: at(45),
      deliveries: [lower(), delivery({ mixStartAt: at(110), etaCurrentAt: at(155) })],
    });

    expect(m.jointIntervalMin).toBe(155);
    expect(m.jointSlackMin).toBe(-5);
    expect(m.level).toBe('bad');
    expect(m.message).toContain('콜드조인트');
  });

  it('한도까지 여유가 COLD_JOINT_MARGIN_MIN 미만이면 미리 경고한다', () => {
    const margin = RULES.COLD_JOINT_MARGIN_MIN;

    // 여유 = margin − 1 → 경고
    const tight = monitorPour({
      totalVolumeM3: 12,
      tempC: 20,
      now: at(45),
      deliveries: [lower(), delivery({ mixStartAt: at(100), etaCurrentAt: at(150 - margin + 1) })],
    });
    expect(tight.jointSlackMin).toBe(margin - 1);
    expect(tight.level).toBe('bad');

    // 여유 = margin → 아직 경고 아님
    const okish = monitorPour({
      totalVolumeM3: 12,
      tempC: 20,
      now: at(45),
      deliveries: [lower(), delivery({ mixStartAt: at(100), etaCurrentAt: at(150 - margin) })],
    });
    expect(okish.jointSlackMin).toBe(margin);
    expect(okish.level).not.toBe('bad');
  });

  it('더운 날은 한도가 120분으로 줄어 같은 상황이 위험이 된다', () => {
    const deliveries = [lower(), delivery({ mixStartAt: at(85), etaCurrentAt: at(125) })];

    const cool = monitorPour({ totalVolumeM3: 12, tempC: 20, now: at(45), deliveries });
    expect(cool.jointIntervalMin).toBe(125);
    expect(cool.jointSlackMin).toBe(25); // 150 − 125
    expect(cool.level).not.toBe('bad');

    const hot = monitorPour({ totalVolumeM3: 12, tempC: 30, now: at(45), deliveries });
    expect(hot.jointIntervalMin).toBe(125);
    expect(hot.jointSlackMin).toBe(-5); // 120 − 125
    expect(hot.level).toBe('bad');
  });
});

describe('monitorPour — 이어칠 하층이 없을 때', () => {
  it('첫 차 도착 전에는 간격을 재지 않는다', () => {
    const m = monitorPour({
      totalVolumeM3: 12,
      tempC: 20,
      now: at(5),
      deliveries: [delivery({ mixStartAt: at(0), etaCurrentAt: at(40) })],
    });
    expect(m.jointIntervalMin).toBeNull();
    expect(m.gapMinutes).toBeNull();
    expect(m.level).toBe('ok');
    expect(m.message).toContain('첫 차');
  });

  it('배차된 차가 하나도 없으면 물량 부족으로 잡는다', () => {
    const m = monitorPour({
      totalVolumeM3: 12,
      tempC: 20,
      now: at(80),
      deliveries: [delivery({ mixStartAt: at(0), arriveAt: at(40), completedAt: at(60) })],
    });
    expect(m.nextArrivalAt).toBeNull();
    expect(m.level).toBe('bad');
    expect(m.message).toContain('추가 주문');
  });

  it('전 물량이 끝나면 더 볼 것이 없다', () => {
    const m = monitorPour({
      totalVolumeM3: 6,
      tempC: 20,
      now: at(80),
      deliveries: [delivery({ mixStartAt: at(0), arriveAt: at(40), completedAt: at(60) })],
    });
    expect(m.remainingM3).toBe(0);
    expect(m.level).toBe('ok');
  });
});

describe('monitorPour — 다음 차를 화면에서 찾을 수 있어야 한다', () => {
  it('가장 빨리 도착하는 차의 id 를 돌려준다', () => {
    const late = delivery({ mixStartAt: at(60), etaCurrentAt: at(100) });
    const soon = delivery({ mixStartAt: at(30), etaCurrentAt: at(70) });
    const m = monitorPour({
      totalVolumeM3: 18,
      tempC: 20,
      now: at(45),
      deliveries: [delivery({ mixStartAt: at(0), arriveAt: at(40) }), late, soon],
    });
    expect(m.nextDeliveryId).toBe(soon.id);
    expect(m.nextArrivalAt).toBe(at(70));
  });
});
