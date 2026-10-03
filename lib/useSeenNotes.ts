'use client';

/**
 * 현장이 어느 납품서를 봤는지 기억한다.
 *
 * 기사가 하역 완료를 누르면 그 장이 확정돼 현장으로 넘어온다. 현장은 하루에
 * 열 장씩 받으므로, 어느 것이 새로 온 것인지 표시가 없으면 매번 전부 훑어야 한다.
 *
 * 읽음 표시는 브라우저에만 둔다. 사람마다 다른 값이고, 틀려도 숫자 배지가
 * 잠깐 어긋날 뿐이라 DB 까지 갈 일이 아니다. 시크릿 창이나 다른 기기에서는
 * 전부 새 것으로 보이는데, 그 편이 못 보고 넘어가는 것보다 낫다.
 */

import { useCallback, useEffect, useState } from 'react';
import { unseenNotes, type DeliveryNote } from './delivery-note';

const key = (siteId: string) => `remicon.seen-notes.${siteId}`;

/** 저장된 읽음 목록. 서버에서는 빈 집합이다 */
export function readSeen(siteId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(key(siteId));
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    // 시크릿 창이나 저장소를 막아 둔 브라우저 — 전부 새 것으로 본다
    return new Set();
  }
}

function writeSeen(siteId: string, codes: Iterable<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key(siteId), JSON.stringify([...codes]));
  } catch {
    /* 못 적어도 화면은 돈다 */
  }
}

/**
 * 납품서 화면이 쓴다.
 *
 * 화면을 연 순간을 기준으로 "이번에 새로 온 것" 을 한 번 찍어 두고, 저장소에는
 * 바로 읽음으로 적는다. 그래야 배지는 사라지면서 화면에는 어느 것이 새로 왔는지
 * 남는다. 적자마자 목록이 비면 무엇을 봐야 할지 알 수 없다.
 */
export function useSeenNotes(siteId: string, notes: DeliveryNote[]) {
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const seen = readSeen(siteId);
    setFresh(new Set(unseenNotes(notes, seen).map((n) => n.code)));
    // 의존성에 notes 를 넣으면 새 장이 올 때마다 '새로 옴' 표시가 갈아엎인다.
    // 화면을 연 시점으로 한 번만 찍는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // 확정된 장은 본 것으로 적는다. 화면에 떠 있으면 본 것이다.
  useEffect(() => {
    const seen = readSeen(siteId);
    let added = false;
    for (const n of notes) {
      if (n.issued && !seen.has(n.code)) {
        seen.add(n.code);
        added = true;
      }
    }
    if (added) writeSeen(siteId, seen);
  }, [siteId, notes]);

  const isFresh = useCallback((code: string) => fresh.has(code), [fresh]);

  return { freshCount: fresh.size, isFresh };
}
