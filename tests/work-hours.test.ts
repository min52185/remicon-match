/**
 * 8·5제 — 레미콘 운송 근무시간.
 *
 * 오전 8시 상차 ~ 오후 5시 하차, 점심 1시간을 빼고 하루 8시간.
 * 건설사는 양생 때문에 60~90분 안에 일괄 타설을 끝내야 하는데, 기사가 5시에
 * 퇴근하면 타설이 그 자리에서 끊긴다 — 콜드조인트가 생긴다.
 *
 * 그래서 막지 않고 알린다. 야간 타설이나 협의 연장은 실제로 있어서, 화면이
 * 주문을 거부하면 쓸 수 없는 앱이 된다.
 */

import { describe, expect, it } from 'vitest';
import { MIN, WORK_HOURS, checkWorkHours, isWorkingHour, workWindow } from '../lib/rules';

/** 2026-09-29(화) */
const day = (h: number, m = 0) => new Date(2026, 8, 29, h, m, 0).getTime();

describe('workWindow — 그날의 8·5제 구간', () => {
  it('상차 8시, 하차 17시, 점심 12~13시', () => {
    const w = workWindow(day(10));
    expect(new Date(w.start).getHours()).toBe(8);
    expect(new Date(w.end).getHours()).toBe(17);
    expect(new Date(w.lunchStart).getHours()).toBe(12);
    expect(new Date(w.lunchEnd).getHours()).toBe(13);
  });

  it('점심을 뺀 실근무가 8시간이다', () => {
    const w = workWindow(day(10));
    const worked = w.end - w.start - (w.lunchEnd - w.lunchStart);
    expect(worked / (60 * MIN)).toBe(8);
  });
});

describe('isWorkingHour', () => {
  it('8시 전과 17시 후는 근무시간이 아니다', () => {
    expect(isWorkingHour(day(7, 59))).toBe(false);
    expect(isWorkingHour(day(8))).toBe(true);
    expect(isWorkingHour(day(16, 59))).toBe(true);
    expect(isWorkingHour(day(17))).toBe(false);
  });

  it('점심시간은 뺀다', () => {
    expect(isWorkingHour(day(11, 59))).toBe(true);
    expect(isWorkingHour(day(12))).toBe(false);
    expect(isWorkingHour(day(12, 59))).toBe(false);
    expect(isWorkingHour(day(13))).toBe(true);
  });
});

describe('checkWorkHours — 넘기면 알린다', () => {
  it('근무시간 안에서 끝나면 문제없다', () => {
    const r = checkWorkHours(day(9), day(11));
    expect(r.level).toBe('ok');
    expect(r.overMin).toBe(0);
  });

  it('17시를 넘기면 몇 분 넘는지 알려 준다', () => {
    const r = checkWorkHours(day(14), day(18, 30));
    expect(r.level).toBe('bad');
    expect(r.overMin).toBe(90);
    expect(r.message).toContain('90분');
    expect(r.message).toContain('끊길');
  });

  it('17시 정각에 끝나면 넘긴 것이 아니다', () => {
    expect(checkWorkHours(day(14), day(17)).overMin).toBe(0);
  });

  it('8시 전에 시작하면 막는다 — 그 시각부터 상차한다', () => {
    const r = checkWorkHours(day(6, 30), day(9));
    expect(r.level).toBe('bad');
    expect(r.message).toContain('90분 빠릅니다');
  });

  it('퇴근까지 여유가 적으면 미리 경고한다', () => {
    const margin = WORK_HOURS.END_WARN_MIN;
    // 여유 = margin − 1 → 경고
    const tight = checkWorkHours(day(14), day(17, 0) - (margin - 1) * MIN);
    expect(tight.level).toBe('warn');
    expect(tight.message).toContain('퇴근시간');

    // 여유 = margin → 아직 경고 아님
    const okish = checkWorkHours(day(14), day(17, 0) - margin * MIN);
    expect(okish.level).not.toBe('warn');
  });
});

describe('checkWorkHours — 점심시간', () => {
  it('점심과 겹치면 알린다', () => {
    const r = checkWorkHours(day(11), day(14));
    expect(r.hitsLunch).toBe(true);
  });

  it('점심 전에 끝나면 안 겹친다', () => {
    expect(checkWorkHours(day(9), day(12)).hitsLunch).toBe(false);
  });

  it('점심 후에 시작하면 안 겹친다', () => {
    expect(checkWorkHours(day(13), day(15)).hitsLunch).toBe(false);
  });

  it('퇴근시간을 넘기는 것이 점심보다 급하다 — 그쪽 문구가 나온다', () => {
    const r = checkWorkHours(day(11), day(19));
    expect(r.hitsLunch).toBe(true);
    expect(r.level).toBe('bad');
    expect(r.message).toContain('넘깁니다');
  });
});
