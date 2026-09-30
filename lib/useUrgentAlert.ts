'use client';

/**
 * 긴급주문이 새로 들어왔는지 지켜본다 — 공장과 기사가 같이 쓴다.
 *
 * 화면에 이미 떠 있던 것과 방금 들어온 것을 구분해야 한다. 열자마자 "새 긴급주문!"
 * 이 뜨면 알림을 믿지 않게 된다. 그래서 처음 잠깐은 기준만 잡고 알리지 않는다.
 *
 * 서버 렌더에서는 저장소가 비어 있고 브라우저에서 한 박자 뒤에 채워진다. 첫 렌더만
 * 건너뛰면 그 사이에 들어온 것을 전부 '새 것' 으로 읽는다 — 기사 화면의 배차 변경
 * 알림에서 겪은 문제와 같다. SETTLE_MS 동안은 기준만 갱신한다.
 */

import { useEffect, useRef, useState } from 'react';
import { playUrgentChime } from './services/alarm';

/** [가정] 저장소가 채워질 때까지 기다리는 시간 */
const SETTLE_MS = 700;

export interface UrgentAlert {
  /** 아직 확인하지 않은 긴급 건수 — 탭 배지에 쓴다 */
  count: number;
  /** 방금 들어온 것이 있는가 — 배너를 띄울지 */
  fresh: boolean;
  /** 확인했다고 표시 */
  dismiss: () => void;
}

/**
 * @param ids 지금 긴급인 것들의 id. 화면에서 걸러 넣는다
 *            (공장: 수락 대기 중인 긴급주문 / 기사: 긴급주문에서 온 배송)
 * @param sound 새로 들어왔을 때 소리를 낼지
 */
export function useUrgentAlert(ids: string[], sound = true): UrgentAlert {
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  const settled = useRef(false);
  const latest = useRef(ids);
  latest.current = ids;

  useEffect(() => {
    const t = window.setTimeout(() => {
      // 기다리는 동안 들어온 것은 '원래 있던 것' 으로 친다
      seen.current = new Set(latest.current);
      settled.current = true;
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, []);

  // 목록이 실제로 바뀔 때만 돈다 — 배열은 렌더마다 새로 만들어지기 때문이다
  const signature = ids.join('|');

  useEffect(() => {
    const now = latest.current;

    if (!settled.current) {
      seen.current = new Set(now);
      return;
    }

    const added = now.filter((id) => !seen.current.has(id));
    seen.current = new Set(now);

    if (added.length === 0) {
      // 처리돼서 사라진 것은 배너에서도 지운다
      setFresh((prev) => new Set([...prev].filter((id) => now.includes(id))));
      return;
    }

    setFresh((prev) => new Set([...prev, ...added].filter((id) => now.includes(id))));
    if (sound) playUrgentChime();
  }, [signature, sound]);

  return {
    count: ids.length,
    fresh: fresh.size > 0,
    dismiss: () => setFresh(new Set()),
  };
}
