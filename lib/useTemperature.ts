'use client';

/**
 * 지금 현장 기온.
 *
 * 주문할 때 기록한 외기온도(order.tempC)는 그 시점의 값이고, 그 값으로
 * 비비기~타설 제한이 90분이냐 120분이냐가 정해져 굳는다. 그런데 타설은 몇 시간씩
 * 이어진다. 그 사이 기온이 25℃ 경계를 넘으면 처음에 받은 제한이 더 이상 안전하지
 * 않다 — 그래서 "지금 몇 도인가" 를 따로 들고 있어야 한다.
 *
 * 기상청 예보는 1시간 단위라 자주 부를 이유가 없다. 10분마다만 다시 받는다.
 */

import { useEffect, useState } from 'react';
import { getTemperature, type Temperature } from './services/weather';
import type { LatLng } from './types';

/** [가정] 다시 받는 주기 — 예보가 1시간 단위라 이보다 자주 부를 이유가 없다 */
const REFRESH_MS = 10 * 60_000;

export function useTemperature(at: LatLng | null | undefined, when?: number): Temperature | null {
  const [temp, setTemp] = useState<Temperature | null>(null);

  // 좌표 객체는 렌더마다 새로 만들어지는 경우가 많아, 값으로 의존성을 잡는다
  const lat = at?.lat;
  const lng = at?.lng;

  useEffect(() => {
    if (lat == null || lng == null) {
      setTemp(null);
      return;
    }
    let alive = true;

    const pull = () => {
      void getTemperature({ lat, lng }, when ?? Date.now()).then((t) => {
        if (alive) setTemp(t);
      });
    };

    pull();
    const id = window.setInterval(pull, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [lat, lng, when]);

  return temp;
}
