/**
 * 외기온도 — 기상청 시각 계산.
 *
 * 이 파일이 있는 이유: 배포본이 내 컴퓨터보다 10도 낮은 기온을 내놓은 적이 있다.
 * 내 컴퓨터는 KST, Vercel 은 UTC 라 getHours() 가 9시간 어긋난 예보를 집어 왔다.
 * 오후 21℃ 자리에 새벽 11℃ 가 들어오는 식이었고, 여름이면 25℃ 경계를 넘나들어
 * 제한시간이 90분/120분으로 뒤바뀐다.
 *
 * 그래서 아래 검사는 전부 "서버가 어느 시간대에 있든 같은 답이 나오는가" 를 본다.
 */

import { describe, expect, it } from 'vitest';
import {
  approximateTemperature,
  BASE_TIMES,
  kstEpoch,
  kstHhmm,
  kstParts,
  kstYmd,
  latestBase,
} from '../lib/services/weather';

/** 2026-10-03 14:30 KST = 05:30 UTC */
const OCT3_1430_KST = Date.UTC(2026, 9, 3, 5, 30);

describe('kstParts — epoch 을 한국시각으로', () => {
  it('UTC 05:30 은 한국시각 14:30 이다', () => {
    const p = kstParts(OCT3_1430_KST);
    expect(p).toMatchObject({ year: 2026, month: 10, day: 3, hour: 14, minute: 30 });
  });

  it('UTC 자정 직전은 한국시각으로 이미 다음 날 아침이다', () => {
    // 2026-10-03 23:00 UTC = 2026-10-04 08:00 KST
    const p = kstParts(Date.UTC(2026, 9, 3, 23, 0));
    expect(p).toMatchObject({ year: 2026, month: 10, day: 4, hour: 8 });
  });

  it('한국시각 자정은 0시로 나온다 (24시가 아니라)', () => {
    // 2026-10-02 15:00 UTC = 2026-10-03 00:00 KST
    const p = kstParts(Date.UTC(2026, 9, 2, 15, 0));
    expect(p.hour).toBe(0);
    expect(p.day).toBe(3);
  });

  it('연말을 넘어가도 맞다', () => {
    // 2026-12-31 16:00 UTC = 2027-01-01 01:00 KST
    const p = kstParts(Date.UTC(2026, 11, 31, 16, 0));
    expect(p).toMatchObject({ year: 2027, month: 1, day: 1, hour: 1 });
  });
});

describe('kstYmd · kstHhmm — 기상청에 보낼 문자열', () => {
  it('YYYYMMDD · HHMM 으로 0 을 채워 만든다', () => {
    expect(kstYmd(OCT3_1430_KST)).toBe('20261003');
    expect(kstHhmm(OCT3_1430_KST)).toBe('1430');
  });

  it('한 자리 월·일·시도 두 자리로 채운다', () => {
    // 2026-01-04 23:05 UTC = 2026-01-05 08:05 KST
    const t = Date.UTC(2026, 0, 4, 23, 5);
    expect(kstYmd(t)).toBe('20260105');
    expect(kstHhmm(t)).toBe('0805');
  });
});

describe('kstEpoch — 기상청이 준 시각을 되돌리기', () => {
  it('왕복해도 같은 값이다', () => {
    const back = kstEpoch('20261003', 14);
    expect(kstYmd(back)).toBe('20261003');
    expect(kstParts(back).hour).toBe(14);
  });

  it('한국시각 14시는 UTC 05시다', () => {
    expect(kstEpoch('20261003', 14)).toBe(Date.UTC(2026, 9, 3, 5));
  });
});

describe('latestBase — 쓸 수 있는 가장 최근 발표분', () => {
  it('한국시각 15:00 이면 14시 발표분을 쓴다', () => {
    // 14시 발표 + 45분 여유 = 14:45 부터 쓸 수 있다
    const t = Date.UTC(2026, 9, 3, 6, 0);
    expect(latestBase(t)).toEqual({ baseDate: '20261003', baseTime: '1400' });
  });

  it('발표 직후에는 아직 한 단계 전 발표분을 쓴다', () => {
    // 한국시각 14:30 — 발표는 14시지만 값이 올라오기 전이라 11시분
    expect(latestBase(OCT3_1430_KST)).toEqual({ baseDate: '20261003', baseTime: '1100' });
  });

  it('한국시각 새벽 1시면 어제 23시 발표분을 쓴다', () => {
    // 2026-10-02 16:00 UTC = 2026-10-03 01:00 KST
    const t = Date.UTC(2026, 9, 2, 16, 0);
    expect(latestBase(t)).toEqual({ baseDate: '20261002', baseTime: '2300' });
  });

  it('고르는 발표시각은 언제나 기상청이 정한 8개 중 하나다', () => {
    for (let h = 0; h < 24; h++) {
      const t = Date.UTC(2026, 9, 3, h, 17);
      expect(BASE_TIMES).toContain(latestBase(t).baseTime);
    }
  });

  it('하루 내내 돌려도 날짜가 오늘이거나 어제다 — 미래 발표분을 달라고 하지 않는다', () => {
    for (let h = 0; h < 24; h++) {
      const t = Date.UTC(2026, 9, 3, h, 40);
      const { baseDate } = latestBase(t);
      expect(['20261002', '20261003', '20261004']).toContain(baseDate);
      // 지금보다 미래의 발표분이면 안 된다
      const asked = kstEpoch(baseDate, Number(latestBase(t).baseTime.slice(0, 2)));
      expect(asked).toBeLessThanOrEqual(t);
    }
  });
});

describe('approximateTemperature — 키가 없을 때의 평년값', () => {
  const SEOUL = { lat: 37.5665, lng: 126.978 };

  it('서버 시간대와 무관하게 같은 값이 나온다', () => {
    // 같은 순간을 두 번 재면 당연히 같아야 하고, 그 값은 한국시각 기준이라야 한다.
    // 한국시각 15시(일 최고)가 같은 날 새벽 3시보다 따뜻해야 맞다.
    const hot = approximateTemperature(SEOUL, Date.UTC(2026, 6, 3, 6)); // 15시 KST
    const cold = approximateTemperature(SEOUL, Date.UTC(2026, 6, 2, 18)); // 03시 KST
    expect(hot.tempC).toBeGreaterThan(cold.tempC);
  });

  it('여름이 겨울보다 따뜻하다', () => {
    const summer = approximateTemperature(SEOUL, Date.UTC(2026, 6, 3, 6));
    const winter = approximateTemperature(SEOUL, Date.UTC(2026, 0, 3, 6));
    expect(summer.tempC).toBeGreaterThan(winter.tempC + 15);
  });

  it('출처를 숨기지 않는다', () => {
    expect(approximateTemperature(SEOUL, OCT3_1430_KST).source).toBe('approx');
  });
});
